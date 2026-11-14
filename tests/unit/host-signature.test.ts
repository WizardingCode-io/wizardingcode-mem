// The signer's constants live in one leaf, src/host/signature.ts, which both the release's
// scripts and the host's tool read (ADR 0033). scripts/release/ runs with no `bun install`,
// so what it reaches of src/ must import nothing.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as lib from "../../scripts/release/lib.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
/** Every module a file names in an import or a re-export, static or dynamic. */
const imports = (source: string) =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*["'`]([^"'`]+)["'`]/g)].map(
    (match) => match[1] as string,
  );
/** Every repository file reachable from `start` through relative imports. */
function closure(start: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...start];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const path of imports(read(file))) {
      if (!path.startsWith(".") || !path.endsWith(".ts")) continue;
      queue.push(relative(ROOT, join(ROOT, dirname(file), path)));
    }
  }
  return seen;
}

const NAMES = [
  "IMAGE",
  "COSIGN_VERSION",
  "COSIGN_IMAGE",
  "SIGNER_IDENTITY",
  "OIDC_ISSUER",
  "DIGEST",
  "verifyArgs",
] as const;

describe("the signer's constants", () => {
  test("scripts/release/lib.ts exports the very values of src/host/signature.ts", async () => {
    const leaf = (await import("../../src/host/signature.ts")) as Record<string, unknown>;
    for (const name of NAMES) {
      expect({ name, same: (lib as Record<string, unknown>)[name] === leaf[name] }).toEqual({
        name,
        same: true,
      });
      expect(leaf[name]).toBeDefined();
    }
  });

  test("the two files of src/ that scripts/release/ reaches import nothing", () => {
    for (const file of ["src/host/signature.ts", "src/util/version.ts"])
      expect({ file, imports: imports(read(file)) }).toEqual({ file, imports: [] });
  });

  test("scripts/release/ reaches, of src/, only those two", () => {
    const scripts = readdirSync(join(ROOT, "scripts/release"))
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `scripts/release/${name}`);
    expect(scripts.length).toBeGreaterThanOrEqual(6);
    const reached = [...closure(scripts)].filter((file) => file.startsWith("src/")).sort();
    expect(reached).toEqual(["src/host/signature.ts", "src/util/version.ts"]);
  });
});
