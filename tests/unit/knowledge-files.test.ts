import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fingerprint,
  KNOWLEDGE_FILE_MAX_BYTES,
  knowledgeDir,
  readEntries,
  slugify,
} from "../../src/modules/knowledge/files.ts";

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-files-"));
  dir = knowledgeDir(root);
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (name: string, text: string | Uint8Array) => writeFileSync(join(dir, name), text);
const only = () => {
  const entries = readEntries(dir);
  expect(entries).toHaveLength(1);
  return entries[0] as NonNullable<(typeof entries)[0]>;
};

const VALID = `---
title: Orders are never deleted, only cancelled
kind: rule            # decision | rule | glossary | architecture | howto
essential: true       # shown at session start
status: active
tags: [orders, billing]
updated: 2026-10-12
source: memory:1234   # optional
---
Body in Markdown. The why, the consequences, links to code.
`;

describe("knowledge/files", () => {
  test("the folder is .wizardingcode/knowledge under the project root", () => {
    expect(knowledgeDir("/repo")).toBe(join("/repo", ".wizardingcode", "knowledge"));
  });

  test("a valid entry is read with every field", () => {
    write("orders-never-deleted.md", VALID);
    expect(only()).toEqual({
      slug: "orders-never-deleted",
      path: join(dir, "orders-never-deleted.md"),
      title: "Orders are never deleted, only cancelled",
      kind: "rule",
      essential: true,
      status: "active",
      tags: ["orders", "billing"],
      updated: "2026-10-12",
      source: "memory:1234",
      body: "Body in Markdown. The why, the consequences, links to code.",
      problem: null,
    });
  });

  test("quoted values, block lists, CRLF and a BOM", () => {
    write(
      "quoted.md",
      '﻿---\r\ntitle: "Use #hash: carefully"\r\nkind: \'glossary\'\r\ntags:\r\n  - one\r\n  - "two words"\r\nessential: no\r\n---\r\nText.\r\n',
    );
    const entry = only();
    expect(entry.title).toBe("Use #hash: carefully");
    expect(entry.kind).toBe("glossary");
    expect(entry.tags).toEqual(["one", "two words"]);
    expect(entry.essential).toBe(false);
    expect(entry.body).toBe("Text.");
    expect(entry.problem).toBeNull();
  });

  test("defaults: active, not essential, no tags", () => {
    write("plain.md", "---\ntitle: Plain\nkind: howto\n---\nHow to.\n");
    const entry = only();
    expect(entry).toMatchObject({
      status: "active",
      essential: false,
      tags: [],
      updated: null,
      source: null,
      problem: null,
    });
  });

  test("unknown keys are kept out of the way and ignored", () => {
    write(
      "extra.md",
      "---\ntitle: Extra\nkind: decision\nowner: someone\nreviewers: [a, b]\n---\nB\n",
    );
    const entry = only();
    expect(entry.title).toBe("Extra");
    expect(entry.problem).toBeNull();
  });

  test("no frontmatter: indexed by file name and body, flagged", () => {
    write("just-some_notes.md", "# Heading\n\nSome notes.\n");
    const entry = only();
    expect(entry.slug).toBe("just-some_notes");
    expect(entry.title).toBe("just some notes");
    expect(entry.body).toBe("# Heading\n\nSome notes.");
    expect(entry.status).toBe("active");
    expect(entry.problem).toContain("frontmatter");
  });

  test("broken frontmatter: indexed by file name and body, flagged", () => {
    write("broken.md", "---\ntitle: Broken\nthis is not yaml\n---\nThe body.\n");
    const entry = only();
    expect(entry.title).toBe("broken");
    expect(entry.body).toBe("The body.");
    expect(entry.problem).toContain("line 2");
  });

  test("frontmatter never closed: the whole file is the body, flagged", () => {
    write("open.md", "---\ntitle: Open\nkind: rule\nThe body.\n");
    const entry = only();
    expect(entry.title).toBe("open");
    expect(entry.body).toContain("The body.");
    expect(entry.problem).toContain("closed");
  });

  test("frontmatter that cannot be read makes the entry a draft, whatever it said", () => {
    write("open.md", "---\ntitle: Open\nstatus: draft\nkind: rule\nThe body.\n");
    write("block.md", "---\ntitle: Block\nstatus: draft\nsummary: |\n  a block\n---\nB\n");
    write("unread.md", "---\ntitle: Unread\nkind: rule\nnot yaml\n---\nB\n");
    const entries = readEntries(dir);
    expect(entries.map((entry) => [entry.slug, entry.status])).toEqual([
      ["block", "draft"],
      ["open", "draft"],
      ["unread", "draft"],
    ]);
    for (const entry of entries) expect(entry.problem).not.toBeNull();
  });

  test("a missing frontmatter keeps the entry active (nothing was misread)", () => {
    write("plain-notes.md", "Some notes.\n");
    expect(only().status).toBe("active");
  });

  test("booleans: only true, false, yes, no; never a prototype key", () => {
    for (const [name, value] of [
      ["ctor", "constructor"],
      ["proto", "__proto__"],
      ["tostring", "toString"],
    ] as const) {
      write(`${name}.md`, `---\ntitle: T\nkind: rule\nessential: ${value}\n---\nB\n`);
    }
    for (const entry of readEntries(dir)) {
      expect(entry.essential).toBe(false);
      expect(entry.problem).toContain("essential");
    }
  });

  test.skipIf(process.platform === "win32")(
    "a FIFO or a folder named *.md is skipped without blocking",
    () => {
      expect(spawnSync("mkfifo", [join(dir, "pipe.md")]).status).toBe(0);
      mkdirSync(join(dir, "folder.md"));
      write("real.md", "---\ntitle: Real\nkind: rule\n---\nB\n");
      expect(readEntries(dir).map((entry) => entry.slug)).toEqual(["real"]);
    },
    5000,
  );

  test("bad values are flagged; a bad status is never active", () => {
    write(
      "bad.md",
      "---\ntitle: Bad\nkind: opinion\nstatus: maybe\nessential: perhaps\nupdated: yesterday\n---\nB\n",
    );
    const entry = only();
    expect(entry.title).toBe("Bad");
    expect(entry.kind).toBe("decision");
    expect(entry.status).toBe("draft");
    expect(entry.essential).toBe(false);
    expect(entry.updated).toBeNull();
    expect(entry.problem).toContain("kind");
    expect(entry.problem).toContain("status");
  });

  test("a missing title takes the file name, flagged", () => {
    write("no-title.md", "---\nkind: rule\n---\nB\n");
    const entry = only();
    expect(entry.title).toBe("no title");
    expect(entry.problem).toContain("title");
  });

  test("a huge file is not read, only flagged", () => {
    write("huge.md", `---\ntitle: Huge\nkind: rule\n---\n${"x".repeat(KNOWLEDGE_FILE_MAX_BYTES)}`);
    const entry = only();
    expect(KNOWLEDGE_FILE_MAX_BYTES).toBe(256 * 1024);
    expect(entry.slug).toBe("huge");
    expect(entry.body).toBe("");
    expect(entry.status).toBe("draft");
    expect(entry.problem).toContain("256 KiB");
  });

  test("a non-UTF-8 byte is replaced and flagged", () => {
    const text = new TextEncoder().encode("---\ntitle: Bytes\nkind: rule\n---\nCafé ");
    write("bytes.md", new Uint8Array([...text, 0xff, 0x0a]));
    const entry = only();
    expect(entry.title).toBe("Bytes");
    expect(entry.body).toContain("Café");
    expect(entry.problem).toContain("UTF-8");
  });

  test.skipIf(process.platform === "win32")(
    "a symlink outside the folder is never read; one inside is",
    () => {
      const outside = join(root, "secret.md");
      writeFileSync(outside, "---\ntitle: Secret\nkind: rule\n---\nTOP SECRET\n");
      symlinkSync(outside, join(dir, "leak.md"));
      write("real.md", "---\ntitle: Real\nkind: rule\n---\nReal body\n");
      symlinkSync(join(dir, "real.md"), join(dir, "alias.md"));
      const entries = readEntries(dir);
      const leak = entries.find((entry) => entry.slug === "leak");
      expect(leak?.body).toBe("");
      expect(leak?.title).toBe("leak");
      expect(leak?.status).toBe("draft");
      expect(leak?.problem).toContain("outside");
      expect(JSON.stringify(entries)).not.toContain("TOP SECRET");
      expect(entries.find((entry) => entry.slug === "alias")?.body).toBe("Real body");
    },
  );

  test("only visible .md files, in name order; folders and other files are skipped", () => {
    write("b.md", "---\ntitle: B\nkind: rule\n---\nB\n");
    write("a.md", "---\ntitle: A\nkind: rule\n---\nA\n");
    write("notes.txt", "not knowledge");
    write(".a.md.tmp", "temp");
    write(".hidden.md", "hidden");
    mkdirSync(join(dir, "folder.md"));
    expect(readEntries(dir).map((entry) => entry.slug)).toEqual(["a", "b"]);
  });

  test("never throws: a missing folder or a file in its place gives nothing", () => {
    expect(readEntries(join(root, "nowhere"))).toEqual([]);
    const file = join(root, "file");
    writeFileSync(file, "x");
    expect(readEntries(file)).toEqual([]);
  });

  test("slugify gives a safe file name", () => {
    expect(slugify("Orders are never deleted, only cancelled")).toBe(
      "orders-are-never-deleted-only-cancelled",
    );
    expect(slugify("Migração para SQLite!")).toBe("migracao-para-sqlite");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("a\\b:c*d?e")).toBe("a-b-c-d-e");
    expect(slugify("   ")).toBe("entry");
    expect(slugify("!!!")).toBe("entry");
    expect(slugify("CON")).toBe("con-entry");
    const long = slugify("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });

  test("fingerprint: null without the folder; changes on add, edit, rename and delete", () => {
    expect(fingerprint(join(root, "nowhere"))).toBeNull();
    const empty = fingerprint(dir);
    expect(empty).not.toBeNull();
    write("a.md", "---\ntitle: A\nkind: rule\n---\nA\n");
    const one = fingerprint(dir);
    expect(one).not.toBe(empty);
    expect(fingerprint(dir)).toBe(one);
    write("a.md", "---\ntitle: A\nkind: rule\n---\nA, edited at more length\n");
    const edited = fingerprint(dir);
    expect(edited).not.toBe(one);
    rmSync(join(dir, "a.md"));
    expect(fingerprint(dir)).not.toBe(edited);
  });
});
