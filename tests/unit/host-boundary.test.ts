// Where the host's tool may reach and who may reach it (ADR 0033): src/host/ imports only
// itself and the order of versions; only the serve command loads it, and only on demand; it
// reads one environment variable and three flags, so nothing can replace the verification.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const imports = (source: string) =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*["'`]([^"'`]+)["'`]/g)].map(
    (match) => match[1] as string,
  );
const staticImports = (source: string) =>
  [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map(
    (match) => match[1] as string,
  );
const resolve = (from: string, path: string) => relative(ROOT, join(ROOT, dirname(from), path));
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return name === "dist" ? [] : walk(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}
const HOST = walk("src/host");

describe("the host tool's boundary", () => {
  test("src/host/ imports, transitively, only its own files and src/util/version.ts", () => {
    expect(HOST.length).toBeGreaterThanOrEqual(10);
    const seen = new Set<string>();
    const queue = [...HOST];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      // Every import of src/host/ is a static one; a sentence that says "from" is not an import.
      expect(read(file)).not.toMatch(/\bimport\s*\(/);
      for (const path of staticImports(read(file))) {
        if (path.startsWith("node:")) continue;
        expect({ file, path, relativeTs: path.startsWith(".") && path.endsWith(".ts") }).toEqual({
          file,
          path,
          relativeTs: true,
        });
        queue.push(resolve(file, path));
      }
    }
    const outside = [...seen].filter((file) => !file.startsWith("src/host/")).sort();
    expect(outside).toEqual(["src/util/version.ts"]);
  });

  test("only src/cli/commands/serve.ts reaches src/host/, and never by a static import", () => {
    const reaching = walk("src")
      .filter((file) => !file.startsWith("src/host/"))
      .filter((file) => imports(read(file)).some((path) => /(^|\/)host\//.test(path)))
      .sort();
    expect(reaching).toEqual(["src/cli/commands/serve.ts"]);
    const serve = read("src/cli/commands/serve.ts");
    expect(staticImports(serve).filter((path) => /(^|\/)host\//.test(path))).toEqual([]);
    // Loaded on demand, inside the `host` case: `await Promise.all([import(…), import(…)])`.
    expect(serve).toMatch(/await Promise\.all\(\[\s*import\("\.\.\/\.\.\/host\/command\.ts"\)/);
    // scripts/release/ reaches the signer's leaf only; nothing else of the tool.
    const scripts = walk("scripts").flatMap((file) =>
      imports(read(file)).map((p) => resolve(file, p)),
    );
    expect([...new Set(scripts.filter((file) => file.startsWith("src/host/")))]).toEqual([
      "src/host/signature.ts",
    ]);
  });

  test("it reads no environment variable but the lock's marker", () => {
    for (const file of HOST) {
      const source = read(file);
      expect({ file, processEnv: /process\.env/.test(source) }).toEqual({
        file,
        processEnv: false,
      });
    }
    const named = new Set(
      HOST.flatMap((file) => read(file).match(/WIZARDINGCODE_MEM_[A-Z_]+/g) ?? []),
    );
    // WIZARDINGCODE_MEM_VERSION is .env's key and one of the variables kept from Docker's children.
    expect([...named].sort()).toEqual([
      "WIZARDINGCODE_MEM_HOST_LOCKED",
      "WIZARDINGCODE_MEM_VERSION",
    ]);
    const lookups = HOST.flatMap((file) => read(file).match(/\benv\.[A-Z_]+/g) ?? []);
    expect([...new Set(lookups)]).toEqual(["env.WIZARDINGCODE_MEM_HOST_LOCKED"]);
  });

  test("serve host takes no flag but --dir, --dry-run and --lock", () => {
    const flags = new Set(read("src/host/command.ts").match(/"--[a-z-]+"/g) ?? []);
    expect([...flags].sort()).toEqual(['"--dir"', '"--dry-run"', '"--lock"']);
    const others = HOST.filter((file) => !file.endsWith("/command.ts")).flatMap(
      (file) => read(file).match(/argv/g) ?? [],
    );
    expect(others).toEqual([]);
  });
});
