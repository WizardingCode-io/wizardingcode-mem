import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TEAM = new URL("../../src/team/", import.meta.url).pathname;
const read = (name: string) => readFileSync(join(TEAM, name), "utf8");
const files = () =>
  existsSync(TEAM) ? readdirSync(TEAM).filter((name) => name.endsWith(".ts")) : [];

/** The import specifiers of a module, as written: static, dynamic and `require`. */
function importsOf(source: string): string[] {
  return [
    ...source.matchAll(/from\s+"([^"]+)"/g),
    ...source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g),
    ...source.matchAll(/\brequire\(\s*"([^"]+)"\s*\)/g),
  ].map((match) => match[1] as string);
}

describe("the store boundary: every SQL statement of the team server lives in store.ts", () => {
  test("store.ts exists, exports transaction and the lease wrappers, and imports only db.ts and errors.ts of the folder", () => {
    expect(files()).toContain("store.ts");
    const source = read("store.ts");
    expect(source).toMatch(/export function transaction\b/);
    for (const name of ["claimLease", "releaseLease", "leaseActive", "getMeta", "setMeta"]) {
      expect(source).toMatch(new RegExp(`export (function|const) ${name}\\b`));
    }
    const own = importsOf(source).filter((spec) => spec.startsWith("./"));
    for (const spec of own) expect(["./db.ts", "./errors.ts"]).toContain(spec);
  });

  test("no other file of the folder reaches the database or the core store", () => {
    const others = files().filter((name) => name !== "store.ts" && name !== "db.ts");
    expect(others.length).toBeGreaterThan(0);
    for (const name of others) {
      const source = read(name);
      for (const spec of importsOf(source)) {
        expect({ name, spec }).not.toEqual({
          name,
          spec: expect.stringMatching(/store\/|bun:sqlite/),
        });
      }
      for (const forbidden of [".query(", ".run(", ".prepare(", "withWrite("]) {
        expect({ name, has: source.includes(forbidden) }).toEqual({ name, has: false });
      }
    }
  });
});
