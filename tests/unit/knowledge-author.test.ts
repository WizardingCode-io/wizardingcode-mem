import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentWriter, identityOf, personAuthor } from "../../src/modules/knowledge/author.ts";
import { KnowledgeError } from "../../src/modules/knowledge/errors.ts";
import { resetGitCaches } from "../../src/modules/knowledge/repo.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import { loadSettings, publicSettings, validatePatch } from "../../src/settings/settings.ts";
import { type Db, openDb } from "../../src/store/db.ts";

let dir: string;
let home: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-author-"));
  home = join(dir, "home");
  mkdirSync(home);
  db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
  resetGitCaches();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const storeWith = (env: Record<string, string | undefined>) =>
  openStore({ db, dataDir: dir, env: { PATH: process.env.PATH, HOME: home, ...env } });

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    return error instanceof KnowledgeError ? error.code : `other: ${String(error)}`;
  }
  return null;
}

describe("the person's author name", () => {
  test("the setting comes first", () => {
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = First Writer\n");
    expect(personAuthor(storeWith({ WIZARDINGCODE_MEM_AUTHOR: "Zoë" }))).toEqual({
      kind: "person",
      name: "Zoë",
      source: "setting",
    });
  });

  test("then the global git user.name", () => {
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = First Writer\n");
    expect(personAuthor(storeWith({}))).toEqual({
      kind: "person",
      name: "First Writer",
      source: "git",
    });
  });

  test("then the word you, named as the default", () => {
    expect(personAuthor(storeWith({}))).toEqual({ kind: "person", name: "you", source: "default" });
  });

  test("the git name is looked up once per home", () => {
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = First Writer\n");
    const store = storeWith({});
    expect(personAuthor(store).name).toBe("First Writer");
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Second Writer\n");
    expect(personAuthor(store).name).toBe("First Writer");
    resetGitCaches();
    expect(personAuthor(store).name).toBe("Second Writer");
  });

  test("a setting that names an agent is dropped and the author falls through", () => {
    expect(loadSettings({ WIZARDINGCODE_MEM_AUTHOR: "agent:x" }, dir).author).toBeNull();
    expect(loadSettings({ WIZARDINGCODE_MEM_AUTHOR: "Zoë" }, dir).author).toBe("Zoë");
    expect(loadSettings({}, dir).author).toBeNull();
    expect(personAuthor(storeWith({ WIZARDINGCODE_MEM_AUTHOR: "agent:x" }))).toEqual({
      kind: "person",
      name: "you",
      source: "default",
    });
  });

  test("a git name that could pass for an agent is not taken", () => {
    writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = agent:codex\n");
    expect(personAuthor(storeWith({})).source).toBe("default");
  });

  test("with no git at all the author is still the default", () => {
    const empty = join(dir, "empty-bin");
    mkdirSync(empty);
    expect(personAuthor(storeWith({ PATH: empty }))).toEqual({
      kind: "person",
      name: "you",
      source: "default",
    });
  });
});

describe("the settings key", () => {
  test("validatePatch refuses an agent, a long name and a newline; accepts a name", () => {
    expect(validatePatch({ WIZARDINGCODE_MEM_AUTHOR: "agent:x" }).ok).toBe(false);
    expect(validatePatch({ WIZARDINGCODE_MEM_AUTHOR: "n".repeat(81) }).ok).toBe(false);
    expect(validatePatch({ WIZARDINGCODE_MEM_AUTHOR: "a\nb" }).ok).toBe(false);
    expect(validatePatch({ WIZARDINGCODE_MEM_AUTHOR: "n".repeat(80) }).ok).toBe(true);
    expect(validatePatch({ WIZARDINGCODE_MEM_AUTHOR: "Zoë" })).toEqual({
      ok: true,
      changes: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" },
    });
  });

  test("publicSettings lists the key with its source", () => {
    expect(
      publicSettings({ WIZARDINGCODE_MEM_AUTHOR: "Zoë" }, dir).WIZARDINGCODE_MEM_AUTHOR,
    ).toEqual({
      value: "Zoë",
      source: "env",
    });
    expect(publicSettings({}, dir).WIZARDINGCODE_MEM_AUTHOR).toEqual({
      value: null,
      source: "default",
    });
  });
});

describe("writers and identities", () => {
  test("an agent id follows the host ids' pattern", () => {
    expect(agentWriter("claude-code")).toEqual({ kind: "agent", id: "claude-code" });
    expect(codeOf(() => agentWriter("Claude Code"))).toBe("invalid");
    expect(codeOf(() => agentWriter(""))).toBe("invalid");
  });

  test("a person's e-mail comes from the name, at the .invalid domain", () => {
    const hex = createHash("sha256").update("Zoë Writer").digest("hex").slice(0, 8);
    expect(identityOf({ kind: "person", name: "Zoë Writer", source: "setting" })).toEqual({
      name: "Zoë Writer",
      email: `zoe-writer.${hex}@people.wizardingcode.invalid`,
    });
    const other = identityOf({ kind: "person", name: "Zoe Writer", source: "git" });
    expect(other.email).not.toBe(`zoe-writer.${hex}@people.wizardingcode.invalid`);
    expect(other.email).toEndWith("@people.wizardingcode.invalid");
  });

  test("an agent's identity names the agent", () => {
    expect(identityOf({ kind: "agent", id: "codex" })).toEqual({
      name: "agent:codex",
      email: "codex@agents.wizardingcode.invalid",
    });
  });
});
