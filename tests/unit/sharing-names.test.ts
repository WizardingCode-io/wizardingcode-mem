// The name of a project (ADR 0028): the shared name a text makes, the one name a project
// carries, and the change log's line for a name.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatChange } from "../../src/sharing/format.ts";
import { nameOf, sharedNameOf } from "../../src/sharing/names.ts";

describe("sharedNameOf", () => {
  test("slugs a title as the knowledge store does, under name:", () => {
    expect(sharedNameOf("Estratégia de marca")).toEqual({
      ok: true,
      alias: "name:estrategia-de-marca",
    });
    expect(sharedNameOf("wizardingcode")).toEqual({ ok: true, alias: "name:wizardingcode" });
    expect(sharedNameOf("  WizardingCode  ")).toEqual({ ok: true, alias: "name:wizardingcode" });
    // The core of slugify collapses the hyphens: what is no shared slug as typed is one here.
    expect(sharedNameOf("a--b")).toEqual({ ok: true, alias: "name:a-b" });
    expect(sharedNameOf("-x-")).toEqual({ ok: true, alias: "name:x" });
    expect(sharedNameOf("x".repeat(81))).toEqual({ ok: true, alias: `name:${"x".repeat(80)}` });
  });

  test("refuses a text with no letter or digit, with no word", () => {
    expect(sharedNameOf("!!!")).toEqual({ ok: false, reason: "no-name" });
    expect(sharedNameOf("")).toEqual({ ok: false, reason: "no-name" });
    expect(sharedNameOf(" - ")).toEqual({ ok: false, reason: "no-name" });
  });

  test("refuses a reserved file name, naming the word, and appends nothing behind the person's back", () => {
    expect(sharedNameOf("CON")).toEqual({ ok: false, reason: "no-name", word: "con" });
    expect(sharedNameOf("lpt1")).toEqual({ ok: false, reason: "no-name", word: "lpt1" });
    expect(sharedNameOf("console")).toEqual({ ok: true, alias: "name:console" });
  });
});

describe("nameOf", () => {
  test("the one shared name a project carries, or null", () => {
    expect(nameOf(["path:/x", "name:a"])).toBe("name:a");
    expect(nameOf(["name:a", "remote:github.com/a/b"])).toBe("name:a");
    expect(nameOf(["path:/x"])).toBeNull();
    expect(nameOf([])).toBeNull();
    // Only a well-formed shared name counts.
    expect(nameOf(["name:Bad"])).toBeNull();
  });
});

describe("formatChange", () => {
  const names = (id: number) => (id === 3 ? "wizardingcode" : null);

  test("a project's level, the lists and a server as share status renders them today", () => {
    expect(formatChange({ what: "project:3", old: "local", new: "knowledge" }, names)).toBe(
      "project:3 local → knowledge",
    );
    expect(formatChange({ what: "project:3@abc", old: "knowledge", new: "all" }, names)).toBe(
      "project:3@abc knowledge → all",
    );
    expect(formatChange({ what: "roots", old: "none", new: "workspace" }, names)).toBe(
      "roots none → workspace",
    );
    expect(formatChange({ what: "areas@abc", old: "none", new: "workspace:sales" }, names)).toBe(
      "areas@abc none → workspace:sales",
    );
    expect(formatChange({ what: "server:abc", old: "", new: "mem.example" }, names)).toBe(
      "server:abc  → mem.example",
    );
  });

  test("a shared name names the project and says none for an empty side", () => {
    expect(formatChange({ what: "name:3", old: "name:a", new: "" }, names)).toBe(
      "shared name of wizardingcode: name:a → none",
    );
    expect(formatChange({ what: "name:3", old: "", new: "name:wizardingcode" }, names)).toBe(
      "shared name of wizardingcode: none → name:wizardingcode",
    );
    expect(formatChange({ what: "name:3", old: "name:a", new: "name:b" }, names)).toBe(
      "shared name of wizardingcode: name:a → name:b",
    );
    expect(formatChange({ what: "name:9", old: "name:a", new: "" }, names)).toBe(
      "shared name of project 9: name:a → none",
    );
  });

  test("format.ts is a leaf, so the viewer's page and the CLI read one rule", () => {
    const ROOT = join(import.meta.dir, "..", "..");
    expect(readFileSync(join(ROOT, "src/sharing/format.ts"), "utf8")).not.toMatch(/^\s*import\b/m);
  });
});
