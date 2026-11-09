import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSlug,
  DEFAULT_AREAS,
  ENTRY_MAX_BYTES,
  nowIso,
  parseEntry,
  parseFrontmatter,
  parseProposal,
  parseTaxonomy,
  renderEntry,
  renderProposal,
  renderTaxonomy,
  slugify,
} from "../../src/modules/knowledge/entry.ts";
import { KnowledgeError } from "../../src/modules/knowledge/errors.ts";
import { openStore } from "../../src/modules/knowledge/store-open.ts";
import type { KnowledgeEntry, Taxonomy } from "../../src/modules/knowledge/types.ts";
import { openDb } from "../../src/store/db.ts";

const ID = "7d0c2b8e-4f0a-4c2e-9a0b-1b2c3d4e5f60";
const SLUG = "discovery-call-script-for-agency-clients";

const EXAMPLE = `---
id: ${ID}
title: "Discovery call script for agency clients"
kind: strategy
area: sales
context: "agency clients"
subject: "discovery call"
status: active
author: "Zoë"
version: 3
created: 2026-11-08T23:10:00.000Z
updated: 2026-11-09T08:00:00.000Z
---
The body.
`;

const NINE: Taxonomy = {
  version: 1,
  updated: "2026-11-08T23:10:00.000Z",
  areas: DEFAULT_AREAS.map((area) => ({ ...area })),
};

/** The example with one frontmatter line replaced, removed (`null`) or added. */
function withLine(key: string, line: string | null): string {
  const lines = EXAMPLE.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (at === -1) lines.splice(1, 0, line ?? "");
  else if (line === null) lines.splice(at, 1);
  else lines[at] = line;
  return lines.join("\n");
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
  } catch (error) {
    return error instanceof KnowledgeError ? error.code : `other: ${String(error)}`;
  }
  return null;
}

describe("parseEntry", () => {
  test("reads the spec's example into its fields", () => {
    expect(parseEntry(EXAMPLE, SLUG, NINE)).toEqual({
      id: ID,
      slug: SLUG,
      title: "Discovery call script for agency clients",
      kind: "strategy",
      area: "sales",
      context: "agency clients",
      subject: "discovery call",
      status: "active",
      author: "Zoë",
      version: 3,
      created: "2026-11-08T23:10:00.000Z",
      updated: "2026-11-09T08:00:00.000Z",
      supersedes: null,
      pinned: false,
      body: "The body.",
      extra: [],
      problem: null,
    });
  });

  test("round-trips quotes, backslashes, an empty context, a --- line and an unknown key", () => {
    const entry: KnowledgeEntry = {
      ...parseEntry(EXAMPLE, SLUG, NINE),
      title: 'A "quoted" title with a \\ backslash',
      context: "",
      body: "First paragraph.\n---\nAfter a rule.",
      extra: ["source: memory:12"],
    };
    const text = renderEntry(entry);
    expect(parseEntry(text, SLUG, NINE)).toEqual(entry);
    // Unknown keys are written after the known ones.
    const lines = text.split("\n");
    expect(lines.indexOf("source: memory:12")).toBeGreaterThan(
      lines.findIndex((l) => l.startsWith("updated:")),
    );
    expect(renderEntry(parseEntry(text, SLUG, NINE))).toBe(text);
  });

  test("keeps supersedes and an unknown block list through a rewrite", () => {
    const text = withLine(
      "version",
      "version: 3\nsupersedes: 3f2a9c6e-7b1d-4e0f-8a2b-9c1d2e3f4a5b",
    ).replace("---\nThe body.", "tags:\n  - one\n  - two\n---\nThe body.");
    const entry = parseEntry(text, SLUG, NINE);
    expect(entry.problem).toBeNull();
    expect(entry.supersedes).toBe("3f2a9c6e-7b1d-4e0f-8a2b-9c1d2e3f4a5b");
    expect(entry.extra).toEqual(["tags:", "  - one", "  - two"]);
    expect(parseEntry(renderEntry(entry), SLUG, NINE)).toEqual(entry);
  });

  test("a file with no closing --- is a draft with a problem and nothing parsed", () => {
    const entry = parseEntry("---\ntitle: x\nno end", "my-entry", NINE);
    expect(entry.problem).toContain("---");
    expect(entry).toMatchObject({
      status: "draft",
      kind: "knowledge",
      area: "",
      author: "",
      version: 0,
      body: "",
      title: "my entry",
    });
  });

  test("a line that is neither key: value, a list item nor a comment is a problem", () => {
    const entry = parseEntry(withLine("kind", "just text"), SLUG, NINE);
    expect(entry.problem).toContain("just text");
    expect(entry.status).toBe("draft");
  });

  test("a comment line is ignored", () => {
    const entry = parseEntry(withLine("kind", "# a comment\nkind: strategy"), SLUG, NINE);
    expect(entry.problem).toBeNull();
    expect(entry.kind).toBe("strategy");
  });

  test("an unknown kind or status is a problem", () => {
    const kind = parseEntry(withLine("kind", "kind: rule"), SLUG, NINE);
    expect(kind.problem).toContain("kind");
    expect(kind.status).toBe("draft");
    expect(kind.kind).toBe("knowledge");
    const status = parseEntry(withLine("status", "status: gone"), SLUG, NINE);
    expect(status.problem).toContain("status");
    expect(status.status).toBe("draft");
  });

  test("a version that is not a whole number from 1 is a problem", () => {
    for (const value of ["0", "2.5", "abc"]) {
      const entry = parseEntry(withLine("version", `version: ${value}`), SLUG, NINE);
      expect(entry.problem).toContain("version");
      expect(entry.status).toBe("draft");
      expect(entry.version).toBe(0);
    }
  });

  test("a missing or an empty title is a problem and the title comes from the slug", () => {
    for (const line of [null, 'title: ""']) {
      const entry = parseEntry(withLine("title", line), "my-entry", NINE);
      expect(entry.problem).toContain("title");
      expect(entry.title).toBe("my entry");
      expect(entry.status).toBe("draft");
    }
  });

  test("the title and the free fields have their limits", () => {
    const title = (n: number) => withLine("title", `title: "${"t".repeat(n)}"`);
    expect(parseEntry(title(200), SLUG, NINE).problem).toBeNull();
    expect(parseEntry(title(201), SLUG, NINE).problem).toContain("title");
    const context = (n: number) => withLine("context", `context: "${"c".repeat(n)}"`);
    expect(parseEntry(context(120), SLUG, NINE).problem).toBeNull();
    expect(parseEntry(context(121), SLUG, NINE).problem).toContain("context");
  });

  test("a missing or malformed id is a problem", () => {
    const missing = parseEntry(withLine("id", null), SLUG, NINE);
    expect(missing.problem).toContain("id");
    expect(missing.id).toBe("");
    const bad = parseEntry(withLine("id", "id: not-a-uuid"), SLUG, NINE);
    expect(bad.problem).toContain("id");
    expect(bad.id).toBe("");
    expect(bad.status).toBe("draft");
  });

  test("the area is checked against the taxonomy it is given", () => {
    const text = withLine("area", "area: legal");
    expect(parseEntry(text, SLUG, NINE).problem).toContain("area");
    const ten: Taxonomy = { ...NINE, areas: [...NINE.areas, { id: "legal", label: "Legal" }] };
    expect(parseEntry(text, SLUG, ten).problem).toBeNull();
    expect(parseEntry(text, SLUG, null).problem).toBeNull();
  });

  test("CRLF line endings and a BOM read the same as LF", () => {
    const expected = parseEntry(EXAMPLE, SLUG, NINE);
    expect(parseEntry(EXAMPLE.replaceAll("\n", "\r\n"), SLUG, NINE)).toEqual(expected);
    expect(parseEntry(`﻿${EXAMPLE}`, SLUG, NINE)).toEqual(expected);
  });

  test("a text over the cap is a problem naming the cap, not parsed", () => {
    const entry = parseEntry(`${EXAMPLE}${"x".repeat(ENTRY_MAX_BYTES)}`, SLUG, NINE);
    expect(entry.problem).toContain("256 KiB");
    expect(entry).toMatchObject({ status: "draft", kind: "knowledge", version: 0, body: "" });
  });
});

describe("parseFrontmatter", () => {
  test("reads scalars, quoted strings, whole numbers and block lists in order", () => {
    const parsed = parseFrontmatter(
      '---\na: plain text\nb: "q \\" \\\\"\nn: 12\nlist:\n  - x\n  - k: v\n---\nbody\n',
    );
    if ("problem" in parsed) throw new Error(parsed.problem);
    expect(parsed.order).toEqual(["a", "b", "n", "list"]);
    expect(parsed.map.get("a")).toBe("plain text");
    expect(parsed.map.get("b")).toBe('q " \\');
    expect(parsed.map.get("n")).toBe(12);
    expect(parsed.map.get("list")).toEqual(["x", { key: "k", value: "v" }]);
    expect(parsed.body).toBe("body");
  });

  test("a text with no frontmatter is a problem", () => {
    expect(parseFrontmatter("just a note\n")).toHaveProperty("problem");
  });
});

describe("the taxonomy file", () => {
  const text = renderTaxonomy(NINE);

  test("the nine starting areas, in order", () => {
    expect(DEFAULT_AREAS.map((area) => area.id)).toEqual([
      "code",
      "management",
      "marketing",
      "sales",
      "video",
      "design",
      "operations",
      "finance",
      "people",
    ]);
  });

  test("reads - id: Label items and round-trips", () => {
    expect(text).toContain("  - code: Code\n");
    expect(parseTaxonomy(text)).toEqual(NINE);
    expect(renderTaxonomy(parseTaxonomy(text) as Taxonomy)).toBe(text);
  });

  test("refuses an item without a label, a bad id and values over their limits", () => {
    const withItem = (item: string) => text.replace("  - code: Code\n", `  - ${item}\n`);
    expect(parseTaxonomy(withItem("code"))).toHaveProperty("problem");
    expect(parseTaxonomy(withItem("Legal!: Legal"))).toHaveProperty("problem");
    expect(parseTaxonomy(withItem(`${"a".repeat(41)}: Long`))).toHaveProperty("problem");
    expect(parseTaxonomy(withItem(`long: ${"L".repeat(61)}`))).toHaveProperty("problem");
    expect(parseTaxonomy(withItem(`${"a".repeat(40)}: ${"L".repeat(60)}`))).not.toHaveProperty(
      "problem",
    );
  });
});

describe("parseProposal", () => {
  const PROPOSAL_ID = "3f2a9c6e-7b1d-4e0f-8a2b-9c1d2e3f4a5b";
  const OPEN = `---
id: ${PROPOSAL_ID}
entry: ${ID}
slug: ${SLUG}
base_version: 2
base_hash: 9f1c2d3e4a5b6c7d
proposed_by: agent:claude-code
proposed_at: 2026-11-09T08:10:00.000Z
title: "Discovery call script for agency clients"
kind: strategy
area: sales
context: "agency clients"
subject: "discovery call"
status: active
---
The proposed body.
`;

  test("reads an open proposal", () => {
    expect(parseProposal(OPEN, `${PROPOSAL_ID}.md`, NINE)).toEqual({
      id: PROPOSAL_ID,
      entryId: ID,
      slug: SLUG,
      baseVersion: 2,
      baseHash: "9f1c2d3e4a5b6c7d",
      proposedBy: "agent:claude-code",
      proposedAt: "2026-11-09T08:10:00.000Z",
      title: "Discovery call script for agency clients",
      kind: "strategy",
      area: "sales",
      context: "agency clients",
      subject: "discovery call",
      status: "active",
      body: "The proposed body.",
      decision: null,
      decidedBy: null,
      decidedAt: null,
      decidedVersion: null,
      contradicts: [],
      onBehalfOf: null,
      judgedBy: null,
      judgeVersion: null,
      extra: [],
      problem: null,
    });
  });

  test("reads a decided proposal and round-trips it", () => {
    const decided = OPEN.replace(
      "status: active\n",
      'status: active\ndecision: accepted\ndecided_by: "Zoë"\ndecided_at: 2026-11-09T09:00:00.000Z\ndecided_version: 3\n',
    );
    const proposal = parseProposal(decided, `${PROPOSAL_ID}.md`, NINE);
    expect(proposal).toMatchObject({
      decision: "accepted",
      decidedBy: "Zoë",
      decidedAt: "2026-11-09T09:00:00.000Z",
      decidedVersion: 3,
      problem: null,
    });
    expect(parseProposal(renderProposal(proposal), `${PROPOSAL_ID}.md`, NINE)).toEqual(proposal);
  });

  test("a new-entry proposal has base version 0 and an empty base hash", () => {
    const fresh = OPEN.replace("base_version: 2", "base_version: 0").replace(
      "base_hash: 9f1c2d3e4a5b6c7d",
      'base_hash: ""',
    );
    const proposal = parseProposal(fresh, `${PROPOSAL_ID}.md`, NINE);
    expect(proposal).toMatchObject({ baseVersion: 0, baseHash: "", problem: null });
    expect(parseProposal(renderProposal(proposal), `${PROPOSAL_ID}.md`, NINE)).toEqual(proposal);
  });

  test("a proposal with no id or an unknown decision is a problem", () => {
    const noId = parseProposal(OPEN.replace(`id: ${PROPOSAL_ID}\n`, ""), "x.md", NINE);
    expect(noId.problem).toContain("id");
    expect(noId.id).toBe("");
    const odd = parseProposal(
      OPEN.replace("status: active\n", "status: active\ndecision: maybe\n"),
      `${PROPOSAL_ID}.md`,
      NINE,
    );
    expect(odd.problem).toContain("decision");
  });
});

describe("slugs", () => {
  test("slugify", () => {
    expect(slugify("Discovery call: agency clients!")).toBe("discovery-call-agency-clients");
    expect(slugify("Reunião de descoberta")).toBe("reuniao-de-descoberta");
    expect(slugify("   ")).toBe("entry");
    expect(slugify("con")).toBe("con-entry");
    expect(slugify("a".repeat(100))).toBe("a".repeat(80));
    expect(
      slugify(
        "alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet-kilo-lima-mike-november",
      ),
    ).toBe("alpha-bravo-charlie-delta-echo-foxtrot-golf-hotel-india-juliet-kilo-lima-mike");
  });

  test("checkSlug refuses and never normalises", () => {
    expect(checkSlug("discovery-call")).toBe("discovery-call");
    expect(codeOf(() => checkSlug("A b"))).toBe("invalid");
    expect(codeOf(() => checkSlug("../x"))).toBe("invalid");
    expect(codeOf(() => checkSlug("nul"))).toBe("invalid");
    expect(codeOf(() => checkSlug("a".repeat(81)))).toBe("invalid");
    expect(codeOf(() => checkSlug("a".repeat(80)))).toBeNull();
  });
});

describe("openStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-entry-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("fills the defaults", () => {
    const db = openDb({ dataDir: dir, busyTimeoutMs: 2000 });
    try {
      const store = openStore({ db, dataDir: dir });
      expect(typeof store.now()).toBe("number");
      expect(store.gitTimeoutMs).toBe(15000);
      expect(store.renew).toBeNull();
      expect(store.dataDir).toBe(dir);
      expect(store.settings.modules).toBeNull();
      const fixed = openStore({ db, dataDir: dir, env: {}, now: () => 5, gitTimeoutMs: 50 });
      expect(fixed.now()).toBe(5);
      expect(fixed.gitTimeoutMs).toBe(50);
      expect(fixed.env).toEqual({});
    } finally {
      db.close();
    }
  });

  test("nowIso renders UTC with milliseconds", () => {
    expect(nowIso(Date.UTC(2026, 10, 8, 23, 10, 0, 0))).toBe("2026-11-08T23:10:00.000Z");
  });
});
