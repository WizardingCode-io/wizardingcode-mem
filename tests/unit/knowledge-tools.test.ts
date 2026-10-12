import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import { knowledgeDir, readEntries } from "../../src/modules/knowledge/files.ts";
import { knowledge } from "../../src/modules/knowledge/index.ts";
import { searchKnowledge } from "../../src/modules/knowledge/index-store.ts";
import {
  getEntries,
  type KnowledgeContext,
  saveEntry,
  searchEntries,
  updateEntry,
} from "../../src/modules/knowledge/tools.ts";
import { checkSlug } from "../../src/modules/knowledge/write.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { runCliWith } from "../helpers/cli.ts";

// The agent's knowledge tools: search and read the project's entries (word forms and
// prefixes found), write a new one (never over an existing file, never outside the folder,
// atomically) and change an existing one (unknown keys and the body kept).

const NOW = new Date(2026, 9, 12, 15, 30).getTime();
const TODAY = "2026-10-12";

let base: string;
let repo: string;
let dir: string;
let db: Db;
let ctx: KnowledgeContext;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-tools-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  dir = knowledgeDir(repo);
  db = openDb({ dataDir: join(base, "store"), busyTimeoutMs: 2000 });
  const project = resolveProject(db, repo, NOW);
  ctx = { db, projectId: project.id, root: project.root, now: NOW };
});
afterEach(() => {
  db.close();
  try {
    chmodSync(dir, 0o755);
  } catch {
    // never made, or already open
  }
  rmSync(base, { recursive: true, force: true });
});

function handWritten(slug: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${slug}.md`), text);
}

/** Every file under the temp base, relative, so a write outside the folder shows up. */
function allFiles(at = base, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...allFiles(join(at, entry.name), rel));
    else found.push(rel);
  }
  return found;
}
const outsideStore = () => allFiles().filter((file) => !file.startsWith("store/"));

describe("knowledge_save", () => {
  test("writes the entry with its frontmatter, indexes it and answers with the path", () => {
    const answer = saveEntry(ctx, {
      title: "Orders are never deleted, only cancelled",
      kind: "rule",
      body: "Cancelling keeps the invoice. See src/orders/cancel.ts.",
      essential: true,
      tags: ["Orders", "billing"],
    });
    const path = join(dir, "orders-are-never-deleted-only-cancelled.md");
    expect(answer).toContain(path);
    const text = readFileSync(path, "utf8");
    expect(text).toBe(
      [
        "---",
        'title: "Orders are never deleted, only cancelled"',
        "kind: rule",
        "essential: true",
        "status: active",
        "tags: [orders, billing]",
        `updated: ${TODAY}`,
        "---",
        "Cancelling keeps the invoice. See src/orders/cancel.ts.",
        "",
      ].join("\n"),
    );
    // Read back by the parser exactly as written.
    const [entry] = readEntries(dir);
    expect(entry).toMatchObject({
      slug: "orders-are-never-deleted-only-cancelled",
      title: "Orders are never deleted, only cancelled",
      kind: "rule",
      essential: true,
      status: "active",
      tags: ["orders", "billing"],
      updated: TODAY,
      problem: null,
    });
    // Indexed at once: the next search finds it without a refresh.
    expect(searchKnowledge(db, ctx.projectId, "invoice", 5).map((found) => found.slug)).toEqual([
      "orders-are-never-deleted-only-cancelled",
    ]);
  });

  test("a title with quotes, colons, hashes and new lines reads back as written", () => {
    const title = 'Use "busy_timeout": 2000 # always\nnever less';
    saveEntry(ctx, { title, kind: "decision", body: "Body." });
    const [entry] = readEntries(dir);
    expect(entry?.title).toBe('Use "busy_timeout": 2000 # always never less');
    expect(entry?.problem).toBeNull();
    expect(entry?.essential).toBe(false);
  });

  test("tags that would break the list are cleaned, not written as they are", () => {
    saveEntry(ctx, {
      title: "Tagged",
      kind: "howto",
      body: "B.",
      tags: ["a, b", "[x]", " ", "#c"],
    });
    const [entry] = readEntries(dir);
    expect(entry?.problem).toBeNull();
    expect(entry?.tags).toEqual(["a b", "x", "c"]);
  });

  test("an existing slug is refused, the file untouched, knowledge_update suggested", () => {
    handWritten("orders", "---\ntitle: Orders\nkind: rule\n---\nBy hand.\n");
    const answer = saveEntry(ctx, { title: "Orders", kind: "decision", body: "Other." });
    expect(answer).toContain("knowledge_update");
    expect(answer).toContain("orders");
    expect(readFileSync(join(dir, "orders.md"), "utf8")).toBe(
      "---\ntitle: Orders\nkind: rule\n---\nBy hand.\n",
    );
    expect(readdirSync(dir)).toEqual(["orders.md"]);
  });

  test("an existing slug in another case is refused too (case-insensitive disks)", () => {
    handWritten("Orders", "---\ntitle: Orders\nkind: rule\n---\nBy hand.\n");
    const answer = saveEntry(ctx, { title: "orders", kind: "rule", body: "Other." });
    expect(answer).toContain("knowledge_update");
    expect(readFileSync(join(dir, "Orders.md"), "utf8")).toContain("By hand.");
  });

  test("creates the folder when the project has none", () => {
    expect(existsSync(dir)).toBe(false);
    saveEntry(ctx, { title: "First", kind: "glossary", body: "The first entry." });
    expect(readdirSync(dir)).toEqual(["first.md"]);
  });

  test("leaves no temporary file behind", () => {
    saveEntry(ctx, { title: "One", kind: "rule", body: "1." });
    saveEntry(ctx, { title: "One", kind: "rule", body: "again" });
    expect(readdirSync(dir)).toEqual(["one.md"]);
  });

  test.skipIf(process.getuid?.() === 0)(
    "a folder that is not writable is a clear refusal, and nothing is half-written",
    () => {
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o555);
      const answer = saveEntry(ctx, { title: "Locked", kind: "rule", body: "B." });
      expect(answer).toContain("not writable");
      chmodSync(dir, 0o755);
      expect(readdirSync(dir)).toEqual([]);
    },
  );
});

describe("slugs never leave the knowledge folder (Review Focus 2)", () => {
  const hostile = [
    "../escape",
    "../../outside",
    "..",
    ".",
    "a/b",
    "a\\b",
    "/etc/passwd",
    "C:\\temp\\x",
    "a:b",
    "a*b",
    "a?b",
    'a"b',
    "a<b>",
    "a|b",
    "con",
    "LPT1",
    "nul",
    ".hidden",
    "trailing.",
    "trailing ",
    "",
    "tab\there",
    "x".repeat(81),
  ];

  test.each(hostile)("an explicit slug %p is refused and nothing is written", (slug) => {
    const answer = saveEntry(ctx, { title: "Escape", kind: "rule", body: "B.", slug });
    expect(answer).toMatch(/slug/i);
    expect(outsideStore()).toEqual([]);
  });

  test.each(hostile)("checkSlug refuses %p", (slug) => {
    expect("refused" in checkSlug(slug)).toBe(true);
  });

  test("a plain slug is taken as given", () => {
    saveEntry(ctx, { title: "Anything", kind: "rule", body: "B.", slug: "orders-rule" });
    expect(readdirSync(dir)).toEqual(["orders-rule.md"]);
  });

  test("a slug with capitals or underscores (as people name files) is accepted", () => {
    expect(checkSlug("Orders_Rule")).toEqual({ slug: "Orders_Rule" });
  });

  test("hostile titles are normalised into a name inside the folder", () => {
    const titles = [
      "../../etc/passwd",
      "C:\\Windows\\System32",
      'What? <x>|y*"z":',
      "con",
      "..",
      "a/../../b",
    ];
    for (const title of titles) saveEntry(ctx, { title, kind: "rule", body: "B." });
    expect(outsideStore().every((file) => file.startsWith("repo/.wizardingcode/knowledge/"))).toBe(
      true,
    );
    expect(readdirSync(dir).sort()).toEqual([
      "a-b.md",
      "c-windows-system32.md",
      "con-entry.md",
      "entry.md",
      "etc-passwd.md",
      "what-x-y-z.md",
    ]);
  });

  test("update refuses a slug that would leave the folder, and touches nothing", () => {
    writeFileSync(join(repo, "outside.md"), "---\ntitle: Outside\n---\nKeep.\n");
    handWritten("inside", "---\ntitle: Inside\nkind: rule\n---\nB.\n");
    for (const slug of ["../../outside", "../outside", "a/b", ".."]) {
      expect(updateEntry(ctx, { slug, title: "Changed" })).toMatch(/slug/i);
    }
    expect(readFileSync(join(repo, "outside.md"), "utf8")).toBe(
      "---\ntitle: Outside\n---\nKeep.\n",
    );
  });

  test("update refuses an entry that is a link, and leaves its target alone", () => {
    writeFileSync(join(base, "target.md"), "---\ntitle: Target\nkind: rule\n---\nKeep.\n");
    mkdirSync(dir, { recursive: true });
    symlinkSync(join(base, "target.md"), join(dir, "linked.md"));
    const answer = updateEntry(ctx, { slug: "linked", title: "Changed" });
    expect(answer).toContain("link");
    expect(readFileSync(join(base, "target.md"), "utf8")).toContain("title: Target");
  });
});

describe("knowledge_update", () => {
  const original = [
    "---",
    "title: Jobs retry",
    "kind: decision",
    "owner: team-a   # who to ask",
    "status: active",
    "tags:",
    "  - jobs",
    "  - queue",
    "updated: 2026-01-02",
    "reviewers: [ana, rui]",
    "---",
    "Five times, with backoff.",
    "",
    "Then the dead queue.",
    "",
  ].join("\n");

  test("changes the given fields, keeps unknown keys and the body, dates it today", () => {
    handWritten("jobs-retry", original);
    const answer = updateEntry(ctx, {
      slug: "jobs-retry",
      title: "Jobs retry five times",
      essential: true,
      tags: ["jobs", "retries"],
    });
    expect(answer).toContain(join(dir, "jobs-retry.md"));
    expect(readFileSync(join(dir, "jobs-retry.md"), "utf8")).toBe(
      [
        "---",
        'title: "Jobs retry five times"',
        "kind: decision",
        "owner: team-a   # who to ask",
        "status: active",
        "tags: [jobs, retries]",
        `updated: ${TODAY}`,
        "reviewers: [ana, rui]",
        "essential: true",
        "---",
        "Five times, with backoff.",
        "",
        "Then the dead queue.",
        "",
      ].join("\n"),
    );
    // Re-indexed: the new title is searchable at once.
    expect(searchKnowledge(db, ctx.projectId, "retries", 5).map((e) => e.slug)).toEqual([
      "jobs-retry",
    ]);
  });

  test("replaces the body when one is given, and can supersede an entry", () => {
    handWritten("jobs-retry", original);
    updateEntry(ctx, { slug: "jobs-retry", body: "Three times now.", status: "superseded" });
    const [entry] = readEntries(dir);
    expect(entry).toMatchObject({
      title: "Jobs retry",
      status: "superseded",
      body: "Three times now.",
      tags: ["jobs", "queue"],
    });
    expect(readFileSync(join(dir, "jobs-retry.md"), "utf8")).toContain("owner: team-a");
  });

  test("an entry without frontmatter gets one, its text kept as the body", () => {
    handWritten("plain", "Just a note written by hand.\n");
    updateEntry(ctx, { slug: "plain", kind: "howto" });
    const [entry] = readEntries(dir);
    expect(entry).toMatchObject({ kind: "howto", body: "Just a note written by hand." });
    expect(entry?.updated).toBe(TODAY);
  });

  test("an entry that does not exist is refused, and knowledge_save suggested", () => {
    const answer = updateEntry(ctx, { slug: "nothing-here", title: "X" });
    expect(answer).toContain("knowledge_save");
    expect(existsSync(join(dir, "nothing-here.md"))).toBe(false);
  });

  test("leaves no temporary file behind", () => {
    handWritten("jobs-retry", original);
    updateEntry(ctx, { slug: "jobs-retry", title: "Again" });
    expect(readdirSync(dir)).toEqual(["jobs-retry.md"]);
  });
});

describe("knowledge_search and knowledge_get", () => {
  beforeEach(() => {
    handWritten(
      "orders",
      "---\ntitle: Orders are never deleted\nkind: rule\nessential: true\n---\nThey are cancelled; the invoice stays.\n",
    );
    handWritten(
      "policies",
      "---\ntitle: Retention policies\nkind: decision\nstatus: draft\n---\nLogs are kept ninety days.\n",
    );
    handWritten(
      "caching",
      "---\ntitle: Caching the catalogue\nkind: architecture\n---\nThe catalogue is cached for an hour.\n",
    );
  });

  test("finds word forms and prefixes: order, cancelling, policy, cache", () => {
    expect(searchEntries(ctx, { query: "order" })).toContain("orders");
    expect(searchEntries(ctx, { query: "cancelling" })).toContain("orders");
    expect(searchEntries(ctx, { query: "policy" })).toContain("policies");
    expect(searchEntries(ctx, { query: "cache" })).toContain("caching");
  });

  test("the injection's search is unchanged: a whole word only", () => {
    searchEntries(ctx, { query: "x" }); // indexes the folder
    expect(searchKnowledge(db, ctx.projectId, "order", 5)).toEqual([]);
  });

  test("answers one heading per entry, with its kind and status, drafts included", () => {
    const answer = searchEntries(ctx, { query: "policy" });
    expect(answer).toContain("policies");
    expect(answer).toContain("Retention policies");
    expect(answer).toContain("draft");
    expect(answer).toContain("decision");
  });

  test("nothing found says so", () => {
    expect(searchEntries(ctx, { query: "zebra" })).toMatch(/no knowledge/i);
  });

  test("an empty query lists the entries", () => {
    const answer = searchEntries(ctx, { query: "" });
    for (const slug of ["orders", "policies", "caching"]) expect(answer).toContain(slug);
  });

  test("respects the limit", () => {
    const answer = searchEntries(ctx, { query: "", limit: 1 });
    expect(answer.split("\n").filter((line) => line.startsWith("- ")).length).toBe(1);
  });

  test("a file added by hand is found by the next search (the index is refreshed first)", () => {
    expect(searchEntries(ctx, { query: "webhook" })).toMatch(/no knowledge/i);
    handWritten("webhooks", "---\ntitle: Webhooks are signed\nkind: rule\n---\nHMAC.\n");
    expect(searchEntries(ctx, { query: "webhook" })).toContain("webhooks");
  });

  test("get reads entries in full by slug, and says which are unknown", () => {
    const answer = getEntries(ctx, { slugs: ["orders", "nope"] });
    expect(answer).toContain("Orders are never deleted");
    expect(answer).toContain("They are cancelled; the invoice stays.");
    expect(answer).toContain("rule");
    expect(answer).toContain("essential");
    expect(answer).toContain(join(dir, "orders.md"));
    expect(answer).toContain('No entry "nope"');
  });

  test("get sees an edit made by hand since the last search", () => {
    searchEntries(ctx, { query: "order" });
    handWritten(
      "orders",
      "---\ntitle: Orders are never deleted\nkind: rule\n---\nEdited by hand, much longer now.\n",
    );
    expect(getEntries(ctx, { slugs: ["orders"] })).toContain("Edited by hand");
  });
});

describe("the module's tools", () => {
  test("inside a project: the four tools, in order; with no project folder, none", async () => {
    const project = await knowledge.tools?.("project");
    expect(project?.map((tool) => tool.name)).toEqual([
      "knowledge_search",
      "knowledge_get",
      "knowledge_save",
      "knowledge_update",
    ]);
    expect(await knowledge.tools?.("global")).toEqual([]);
  });

  test("the schemas take the spec's arguments", async () => {
    const tools = (await knowledge.tools?.("project")) ?? [];
    const schema = (name: string) => tools.find((tool) => tool.name === name)?.inputSchema;
    expect(schema("knowledge_search")?.safeParse({ query: "x", limit: 5 }).success).toBe(true);
    expect(schema("knowledge_get")?.safeParse({ slugs: ["a"] }).success).toBe(true);
    expect(schema("knowledge_get")?.safeParse({ slugs: [] }).success).toBe(false);
    expect(
      schema("knowledge_save")?.safeParse({ title: "T", kind: "rule", body: "B" }).success,
    ).toBe(true);
    expect(
      schema("knowledge_save")?.safeParse({ title: "T", kind: "note", body: "B" }).success,
    ).toBe(false);
    expect(schema("knowledge_update")?.safeParse({ slug: "a", status: "draft" }).success).toBe(
      true,
    );
    const save = tools.find((tool) => tool.name === "knowledge_save");
    expect(save?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === "knowledge_search")?.annotations?.readOnlyHint).toBe(
      true,
    );
  });

  test("through the bridge, a save lands in the call's project and a search finds it", async () => {
    const env = {
      WIZARDINGCODE_MEM_DATA_DIR: join(base, "data"),
      WIZARDINGCODE_HOME: join(base, "home"),
      WIZARDINGCODE_MEM_STORE_DIR: join(base, "bridge-store"),
      WIZARDINGCODE_MEM_MIGRATE: "off",
      WIZARDINGCODE_MODULES: "",
      HOME: join(base, "home"),
      USERPROFILE: join(base, "home"),
    };
    const saved = await runCliWith(
      {
        input: JSON.stringify({ title: "Bridged entry", kind: "howto", body: "Run it." }),
        env,
      },
      "tool",
      "knowledge_save",
      "--project",
      repo,
    );
    expect(saved.exitCode).toBe(0);
    expect(readdirSync(dir)).toEqual(["bridged-entry.md"]);
    const found = await runCliWith(
      { input: JSON.stringify({ query: "bridge" }), env },
      "tool",
      "knowledge_search",
      "--project",
      repo,
    );
    expect(found.stdout).toContain("bridged-entry");
  }, 20_000);
});
