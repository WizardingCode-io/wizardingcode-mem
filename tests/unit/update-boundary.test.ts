// Where the release notice may reach: it stays outside the store and off the hooks' path,
// and the suite never asks github.com.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** Every module a file names in an import or a re-export, static or dynamic. */
const imports = (source: string) =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] as string,
  );
/** Only the static ones: what loading the file loads. */
const staticImports = (source: string) =>
  [...source.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/gm)].map(
    (match) => match[1] as string,
  );

describe("the update folder's boundary", () => {
  test("no file of it reaches the store, the modules, the engine, the sync, the status or the doctor", () => {
    const files = readdirSync(join(ROOT, "src/update")).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      for (const path of imports(read(`src/update/${file}`))) {
        expect({
          file,
          path,
          allowed: !/\/(store|modules|engine|sync|status|doctor)\//.test(path),
        }).toEqual({ file, path, allowed: true });
      }
    }
  });

  test("loading the CLI loads none of it, and the leaf loads nothing", () => {
    const main = staticImports(read("src/cli/main.ts"));
    expect(main).toContain("./reconciled.ts");
    for (const path of main)
      expect({ path, allowed: !/update\/|install\/binary/.test(path) }).toEqual({
        path,
        allowed: true,
      });
    const leaf = read("src/cli/reconciled.ts");
    expect(staticImports(leaf)).toEqual([]);
    expect(leaf).not.toMatch(/\bimport\s*\(/);
  });
});

describe("the viewer loads no code that asks for a release", () => {
  /** The file a relative import names, from the file that names it. */
  const resolve = (from: string, path: string) =>
    join(from, "..", path).replace(`${ROOT}/`, "").replace(/^\//, "");
  /** Every repository file reachable from `start` through static and dynamic imports. */
  function closure(start: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...start];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const path of imports(read(file))) {
        if (!path.startsWith(".") || !path.endsWith(".ts")) continue;
        queue.push(resolve(file, path));
      }
    }
    return seen;
  }

  test("no file of src/ui reaches src/update/check.ts, at any depth", () => {
    const files = readdirSync(join(ROOT, "src/ui"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `src/ui/${name}`);
    expect(files).toContain("src/ui/update.ts");
    const reached = closure(files);
    // The walk is real: it follows the viewer into the report and the report into its leaf.
    expect(reached.has("src/update/report.ts")).toBe(true);
    expect(reached.has("src/update/mode.ts")).toBe(true);
    expect(reached.has("src/update/check.ts")).toBe(false);
  });

  test("the rule of the mode lives in the leaf, which loads nothing", () => {
    expect(staticImports(read("src/update/mode.ts"))).toEqual([]);
    expect(read("src/update/check.ts")).not.toMatch(/export (function|type) (mode|Mode)\b/);
  });
});

describe("the suite makes no request", () => {
  test("the preload turns the check off, whatever the shell exports", () => {
    expect(process.env.WIZARDINGCODE_MEM_UPDATE).toBe("off");
    expect(read("tests/preload.ts")).toMatch(/process\.env\.WIZARDINGCODE_MEM_UPDATE = "off";/);
  });
});
