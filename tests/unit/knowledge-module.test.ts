import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { HookEvent } from "../../src/core/types.ts";
import type { EngineModule, MomentInput } from "../../src/engine/module.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { personAuthor } from "../../src/modules/knowledge/author.ts";
import * as contributeModule from "../../src/modules/knowledge/contribute.ts";
import {
  INTRO,
  PROMPT_INTRO,
  renderRelevant,
  resetKnowledgeLog,
  WRAPPER_CLOSE,
  WRAPPER_OPEN,
} from "../../src/modules/knowledge/contribute.ts";
import { knowledge } from "../../src/modules/knowledge/index.ts";
import { type Hit, rebuildRepo } from "../../src/modules/knowledge/index-store.ts";
import { KNOWLEDGE_SCHEMA_VERSION } from "../../src/modules/knowledge/migrations.ts";
import { ensureRepo } from "../../src/modules/knowledge/repo.ts";
import { writeEntry } from "../../src/modules/knowledge/store.ts";
import type {
  EntryChange,
  KnowledgeStore,
  Repo,
  ScopeRef,
} from "../../src/modules/knowledge/types.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { withoutNotes } from "../../src/retrieve/render.ts";
import { DB_FILE, type Db } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { LEAK, PROBE_ENTRIES, RELEVANT, UNRELATED } from "../fixtures/knowledge-probe.ts";
import { commitEntryFiles, type Fixture, knowledgeFixture } from "../helpers/knowledge.ts";
import { realGit } from "../helpers/stub-git.ts";

// The knowledge module on the hook path: what a prompt is shown, recorded once per context,
// within its share; the silence that leaves memory's text as it was; no file read on a hook.
// At every session start, the pinned entries (D-9 as the person confirmed it on 2026-11-09).

const WORKSPACE = { scope: "workspace" } as const;
const NOW = Date.UTC(2026, 10, 9, 8, 0, 0);
const PROMPT_SHARE = 480;

/** The context exactly as composed, without an adapter's wrapping. */
const raw: AgentAdapter = { ...claudeCode, render: (_event, context) => context ?? "" };

let fx: Fixture;
let store: KnowledgeStore;
let project: string;
let projectId: number;
let clock = NOW;

beforeEach(() => {
  resetKnowledgeLog();
  fx = knowledgeFixture("knowledge-module");
  store = fx.store({ now: () => NOW, env: { WIZARDINGCODE_MEM_AUTHOR: "Zoë" } });
  project = join(fx.dir, "project");
  mkdirSync(project);
  projectId = resolveProject(fx.db, project, NOW).id;
  insertMemory(fx.db, {
    projectId,
    kind: "gotcha",
    title: "The ledger sync must back off before the gateway retries",
    body: "A ledger sync that retries at once trips the gateway's rate limit." as Redacted,
    terms: "",
    importance: 4,
    branch: null,
    commit: null,
    origin: "manual",
    judge: "heuristic",
    judgeVersion: "1",
    sourceTurnId: null,
    files: [],
    now: NOW,
  });
});
afterEach(() => {
  fx.close();
});

const change = (over: Partial<EntryChange>): EntryChange => ({
  title: "Ledger sync",
  kind: "knowledge",
  area: "code",
  context: "",
  subject: "",
  body: "The ledger sync retries the webhook with backoff until the gateway answers.",
  ...over,
});

function write(ref: ScopeRef, over: Partial<EntryChange>): void {
  const result = writeEntry(store, ref, change(over), personAuthor(store));
  if (result.kind !== "written") throw new Error("expected a written entry");
}

/** One hook through the engine, with the given modules. */
function hook(
  event: HookEvent,
  extra: Partial<HookInput> = {},
  modules: readonly EngineModule[] = [memory, knowledge],
  db: Db = fx.db,
): string {
  clock += 1000;
  return handleHook(
    {
      db,
      now: () => clock,
      spawnDistill: () => {},
      modules: () => modules,
      onError: () => {},
    },
    raw,
    {
      agent: "claude-code",
      event,
      sessionId: "s1",
      cwd: project,
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: null,
      toolFile: null,
      toolError: null,
      subagent: false,
      ...extra,
    },
  );
}

let sessions = 0;
/** A prompt in a session of its own: a fresh context. */
const prompt = (text: string, sessionId = `fresh-${++sessions}`) =>
  hook("prompt", { prompt: text, sessionId });

/** The knowledge block of a hook's output; null when there is none. */
function block(output: string): string | null {
  const at = output.indexOf(WRAPPER_OPEN);
  if (at === -1) return null;
  const end = output.indexOf(WRAPPER_CLOSE, at);
  return output.slice(at, end + WRAPPER_CLOSE.length);
}

/** What memory said: the output less knowledge's block and the blank line before it. */
function memoryPart(output: string): string {
  const shown = block(output);
  return shown === null ? output : output.replace(`\n\n${shown}`, "").replace(shown, "");
}

/** The same prompt in a fresh context with memory alone: what memory says without knowledge. */
const alone = (text: string) =>
  hook("prompt", { prompt: text, sessionId: `alone-${++sessions}` }, [memory]);

const shownRows = () =>
  fx.db
    .query<{ entry_id: string; event: string; rule: string | null; slug: string }, []>(
      `SELECT s.entry_id, s.event, s.rule, e.slug FROM knowledge_shown s
         JOIN knowledge_entries e ON e.repo_id = s.repo_id AND e.id = s.entry_id
        ORDER BY s.at, e.slug`,
    )
    .all();

const entryLines = (text: string | null) =>
  (text ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.split(" · ")[0]?.slice(2));

describe("silence", () => {
  test("with no repository, two reads and nothing", () => {
    let statements = 0;
    const counting = new Proxy(fx.db, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        if (key === "query" || key === "prepare" || key === "run" || key === "exec") {
          return (...args: unknown[]) => {
            statements++;
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value.bind(target);
      },
    });
    const session = touchSession(fx.db, {
      agent: "claude-code",
      agentSessionId: "direct",
      projectId,
      cwd: project,
      branch: null,
      now: NOW,
    });
    const input: MomentInput = {
      db: counting,
      moment: "prompt",
      projectId,
      branch: null,
      root: project,
      sessionId: session.id,
      epoch: session.contextEpoch,
      prompt: "should the ledger sync use backoff for the webhook gateway",
      path: null,
      error: null,
      now: NOW,
      budgetChars: PROMPT_SHARE,
    };
    expect(knowledge.contribute?.(input) ?? null).toBeNull();
    expect(statements).toBe(2);
  });

  test("on a file read and on a failed tool it says nothing, with repositories present", () => {
    write(WORKSPACE, {});
    const session = touchSession(fx.db, {
      agent: "claude-code",
      agentSessionId: "direct",
      projectId,
      cwd: project,
      branch: null,
      now: NOW,
    });
    const base: Omit<MomentInput, "moment"> = {
      db: fx.db,
      projectId,
      branch: null,
      root: project,
      sessionId: session.id,
      epoch: session.contextEpoch,
      prompt: "should the ledger sync use backoff for the webhook gateway",
      path: "src/ledger.ts",
      error: "Error: the ledger sync webhook gateway backoff failed",
      now: NOW,
      budgetChars: 1200,
    };
    expect(knowledge.contribute?.({ ...base, moment: "file-read" }) ?? null).toBeNull();
    expect(knowledge.contribute?.({ ...base, moment: "tool-failed" }) ?? null).toBeNull();
  });

  test("tables a newer version wrote keep it silent, logged once per process", () => {
    write(WORKSPACE, {});
    fx.db.run(
      "INSERT INTO module_migrations (module, version, name, applied_at) VALUES (?, ?, 'x', 0)",
      ["knowledge", KNOWLEDGE_SCHEMA_VERSION + 1],
    );
    const saved = process.env.WIZARDINGCODE_MEM_DATA_DIR;
    process.env.WIZARDINGCODE_MEM_DATA_DIR = fx.dataDir;
    try {
      const text = "should the ledger sync use backoff for the webhook gateway";
      const first = prompt(text);
      const second = prompt(text);
      expect(block(first)).toBeNull();
      expect(block(second)).toBeNull();
      expect(memoryPart(first)).toBe(alone(text));
      const log = readFileSync(join(fx.dataDir, "logs", "wizardingcode-mem.log"), "utf8");
      const lines = log
        .split("\n")
        .filter((line) => line.includes("the knowledge tables are at a version"));
      expect(lines).toHaveLength(1);
    } finally {
      if (saved === undefined) delete process.env.WIZARDINGCODE_MEM_DATA_DIR;
      else process.env.WIZARDINGCODE_MEM_DATA_DIR = saved;
    }
  });
});

describe("a prompt", () => {
  test("three distinct non-generic words shared with the body show the entry and its paragraph", () => {
    write(WORKSPACE, { slug: "ledger-sync", title: "Outbound accounting" });
    const text = "should the ledger sync use backoff for the webhook gateway";
    const output = prompt(text);
    const shown = block(output);
    expect(shown).toBe(
      [
        WRAPPER_OPEN,
        PROMPT_INTRO,
        "- workspace/ledger-sync · knowledge · code · Outbound accounting",
        "  The ledger sync retries the webhook with backoff until the gateway answers.",
        WRAPPER_CLOSE,
      ].join("\n"),
    );
    expect(output).toBe(`${alone(text)}\n\n${shown}`);
    expect(shownRows().map(({ slug, event, rule }) => ({ slug, event, rule }))).toEqual([
      { slug: "ledger-sync", event: "prompt", rule: "words" },
    ]);
  });

  test("a code name from the entry shows it, recorded as code", () => {
    write(WORKSPACE, {
      slug: "invoice-totals",
      title: "Invoice totals",
      body: "Totals are summed with sumCents(lines) so that rounding happens once.",
    });
    const text = "why does sumCents drop a line";
    expect(entryLines(block(prompt(text)))).toEqual(["workspace/invoice-totals"]);
    expect(shownRows().map((row) => row.rule)).toEqual(["code"]);
  });

  test("two of the title's words plus a shared generic word show the entry, recorded as title", () => {
    write(WORKSPACE, {
      slug: "feature-flags",
      title: "Feature flags",
      body: "Remove a flag once every client runs the release that made it permanent.",
    });
    expect(entryLines(block(prompt("which feature flags can we remove now?")))).toEqual([
      "workspace/feature-flags",
    ]);
    expect(shownRows().map((row) => row.rule)).toEqual(["title"]);
  });

  test("two of the title's words and nothing else show nothing", () => {
    write(WORKSPACE, { slug: "feature-flags", title: "Feature flags", body: "Kept in the notes." });
    const text = "feature flags in the dashboard";
    const output = prompt(text);
    expect(block(output)).toBeNull();
    expect(output).toBe(alone(text));
    expect(shownRows()).toEqual([]);
  });

  test("one shared word, a host prompt and a one-word prompt show nothing", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    for (const text of [
      "the gateway is down again today",
      "<task-notification>ledger sync backoff webhook gateway</task-notification>",
      "ledger",
    ]) {
      expect(block(prompt(text))).toBeNull();
    }
    expect(shownRows()).toEqual([]);
  });

  test("an entry shown once is not shown again in the context, and again in a new one", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    const text = "should the ledger sync use backoff for the webhook gateway";
    expect(block(prompt(text, "one"))).not.toBeNull();
    expect(block(prompt(text, "one"))).toBeNull();
    expect(block(prompt(text, "two"))).not.toBeNull();
  });

  test("a draft and an entry with a problem are never shown", () => {
    write(WORKSPACE, { slug: "ledger-sync", status: "draft" });
    const repo = ensureRepo(store, WORKSPACE);
    writeFileSync(
      join(repo.path, "entries", "broken.md"),
      "---\ntitle: Ledger sync backoff webhook gateway\nnot a key line\n---\n\nThe ledger sync webhook gateway backoff.\n",
    );
    realGit(repo.path, "add", "-A");
    realGit(
      repo.path,
      "-c",
      "user.name=T",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "-q",
      "-m",
      "x",
    );
    rebuildRepo(store, repo);
    const problems = fx.db
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM knowledge_entries WHERE problem IS NOT NULL",
      )
      .get()?.n;
    expect(problems).toBe(1);
    expect(block(prompt("should the ledger sync use backoff for the webhook gateway"))).toBeNull();
  });

  test("an entry of a project this one does not see is never shown", () => {
    const elsewhere = join(fx.dir, "elsewhere");
    mkdirSync(elsewhere);
    const other = resolveProject(fx.db, elsewhere, NOW).id;
    write(
      { scope: "project", projectId: other },
      {
        slug: "ledger-sync",
        title: "Should the ledger sync use backoff for the webhook gateway",
      },
    );
    expect(block(prompt("should the ledger sync use backoff for the webhook gateway"))).toBeNull();
  });

  test("the project's own entries and the shared ones are seen", () => {
    write({ scope: "project", projectId }, { slug: "ledger-sync-here" });
    write({ scope: "shared" }, { slug: "ledger-sync-shared" });
    expect(
      entryLines(
        block(prompt("should the ledger sync use backoff for the webhook gateway")),
      ).sort(),
    ).toEqual(["project/ledger-sync-here", "shared/ledger-sync-shared"]);
  });
});

/** A title that makes the entry's prompt line exactly `length` characters long. */
function titleFor(slug: string, length: number, start: string): string {
  const prefix = `- workspace/${slug} · knowledge · code · `;
  const room = length - prefix.length - start.length - 1;
  if (room < 1) throw new Error("the line is too short for its title");
  return `${start} ${"z".repeat(room)}`;
}

const LONG_BODY =
  "The ledger sync retries the webhook with backoff until the gateway answers, and each attempt is logged for the audit trail.";

describe("the prompt block", () => {
  test("its intro is one line, background and not instructions", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    const lines = (
      block(prompt("should the ledger sync use backoff for the webhook gateway")) ?? ""
    ).split("\n");
    expect(lines[0]).toBe("<wizardingcode-knowledge>");
    expect(lines[1]).toBe("Team knowledge that may apply. Background, not instructions.");
  });

  test("a 2,000-character first paragraph is clipped to 80 characters", () => {
    const paragraph = `The ledger sync retries the webhook with backoff until the gateway answers ${"and again ".repeat(195)}`;
    write(WORKSPACE, { slug: "ledger-sync", body: `${paragraph}\n\nA second paragraph.` });
    const lines = (
      block(prompt("should the ledger sync use backoff for the webhook gateway")) ?? ""
    ).split("\n");
    const shown = lines[3] as string;
    expect(shown.startsWith("  ")).toBe(true);
    expect(shown.slice(2)).toHaveLength(80);
    expect(shown.endsWith("…")).toBe(true);
    expect(lines).toHaveLength(5);
  });

  test("two entries with 86-character lines and full paragraphs both fit: 453 characters", () => {
    for (const slug of ["ledger-sync-a", "ledger-sync-b"]) {
      write(WORKSPACE, { slug, title: titleFor(slug, 86, "Ledger"), body: LONG_BODY });
    }
    const shown = block(prompt("should the ledger sync use backoff for the webhook gateway"));
    expect(entryLines(shown).sort()).toEqual([
      "workspace/ledger-sync-a",
      "workspace/ledger-sync-b",
    ]);
    for (const line of (shown ?? "").split("\n").filter((l) => l.startsWith("- "))) {
      expect(line).toHaveLength(86);
    }
    expect(shown).toHaveLength(453);
    expect(shownRows()).toHaveLength(2);
  });

  const hit = (slug: string, lineLength: number, body: string): Hit => ({
    id: crypto.randomUUID(),
    slug,
    title: titleFor(slug, lineLength, "Ledger"),
    kind: "knowledge",
    area: "code",
    context: "",
    subject: "",
    status: "active",
    author: "Zoë",
    version: 1,
    created: null,
    updated: null,
    supersedes: null,
    pinned: false,
    body,
    extra: [],
    problem: null,
    repoId: 1,
    scope: "workspace",
    hash: "",
    bm25: 0,
  });

  test("an entry that does not fit what is left is skipped, and the next candidate is tried", () => {
    const first = hit("first", 114, LONG_BODY);
    const second = hit("second", 86, LONG_BODY);
    const third = hit("third", 86, "This paragraph is forty characters long.");
    expect(third.body).toHaveLength(40);
    const { text, shown } = renderRelevant([first, second, third], PROMPT_SHARE);
    expect(shown.map((h) => h.slug)).toEqual(["first", "third"]);
    expect(text.length).toBeLessThanOrEqual(PROMPT_SHARE);
    // With the second, the block would be 481 characters.
    expect(renderRelevant([first, second], 481).shown.map((h) => h.slug)).toEqual([
      "first",
      "second",
    ]);
    expect(renderRelevant([first, second], 481).text).toHaveLength(481);
  });

  test("a third matching entry is never shown, whatever room is left", () => {
    const small = ["a", "b", "c"].map((slug) => hit(slug, 60, "Short."));
    expect(renderRelevant(small, 10_000).shown.map((h) => h.slug)).toEqual(["a", "b"]);
  });
});

describe("the probe", () => {
  function probeWorld(): void {
    const repo = ensureRepo(store, WORKSPACE);
    commitEntryFiles(
      repo.path,
      PROBE_ENTRIES.map((entry) => ({ ...entry, updated: "2026-11-01T08:00:00.000Z" })),
    );
    rebuildRepo(store, repo);
  }

  test("every entry's line fits a prompt alone with a full paragraph", () => {
    for (const entry of PROBE_ENTRIES) {
      const line = `- workspace/${entry.slug} · ${entry.kind} · ${entry.area} · ${entry.title}`;
      expect(line.length).toBeLessThanOrEqual(283);
    }
    expect(PROBE_ENTRIES).toHaveLength(18);
    expect(RELEVANT).toHaveLength(12);
    expect(UNRELATED).toHaveLength(28);
  });

  test("every relevant prompt brings its entry first", () => {
    probeWorld();
    for (const { prompt: text, slug } of RELEVANT) {
      expect({ text, first: entryLines(block(prompt(text)))[0] }).toEqual({
        text,
        first: `workspace/${slug}`,
      });
    }
  });

  test("at most one unrelated prompt injects: the known leak", () => {
    probeWorld();
    const injected = UNRELATED.filter((text) => block(prompt(text)) !== null);
    expect(injected.filter((text) => text !== LEAK)).toEqual([]);
    expect(injected.length).toBeLessThanOrEqual(1);
  });
});

describe("session start", () => {
  const SESSION_START_SHARE = 840;
  const start = (sessionId: string, extra: Partial<HookInput> = {}) =>
    hook("session-start", { sessionId, source: "startup", ...extra });
  /** The same start with memory alone, in a session of its own. */
  const startAlone = () =>
    hook("session-start", { sessionId: `alone-${++sessions}`, source: "startup" }, [memory]);

  /** Two pinned workspace entries and one pinned shared entry. */
  function threePins(): void {
    write(WORKSPACE, { slug: "ledger-sync", title: "Ledger sync", pinned: true });
    write(WORKSPACE, {
      slug: "pricing-rules",
      kind: "strategy",
      area: "sales",
      title: "Pricing rules for agencies",
      body: "Agencies get the volume ladder, never a flat discount.",
      pinned: true,
    });
    write(
      { scope: "shared" },
      {
        slug: "brand-voice",
        kind: "strategy",
        area: "marketing",
        title: "Brand voice",
        body: "Plain words, short sentences, no superlatives.",
        pinned: true,
      },
    );
  }
  const THREE_LINES = [
    "- shared/brand-voice · strategy · marketing · Brand voice",
    "- workspace/ledger-sync · knowledge · code · Ledger sync",
    "- workspace/pricing-rules · strategy · sales · Pricing rules for agencies",
  ];
  const pinLines = (text: string | null) =>
    (text ?? "")
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .sort();

  test("with no pinned entry it shows nothing of knowledge", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    const output = start("s1");
    expect(block(output)).toBeNull();
    expect(output).toBe(startAlone());
    expect(shownRows()).toEqual([]);
  });

  test("a project's first start shows the three lines after memory's brief, under the intro", () => {
    threePins();
    const output = start("s1");
    const shown = block(output);
    expect(shown).not.toBeNull();
    const lines = (shown ?? "").split("\n");
    expect(lines[0]).toBe(WRAPPER_OPEN);
    expect(lines[1]).toBe(INTRO);
    expect(lines.at(-1)).toBe(WRAPPER_CLOSE);
    expect(lines).toHaveLength(6);
    expect(pinLines(shown)).toEqual(THREE_LINES);
    expect(output).toBe(`${startAlone()}\n\n${shown}`);
    expect(output.indexOf(WRAPPER_OPEN)).toBeGreaterThan(0);
    const rows = shownRows();
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.event).toBe("session-start");
      expect(row.rule).toBeNull();
    }
  });

  test("the next prompt in the context shows none of them; a clear start shows them again", () => {
    threePins();
    expect(pinLines(block(start("s1")))).toEqual(THREE_LINES);
    expect(
      block(
        hook("prompt", {
          sessionId: "s1",
          prompt: "should the ledger sync use backoff for the webhook gateway",
        }),
      ),
    ).toBeNull();
    // In a fresh context the same prompt brings the entry: the start is what hid it.
    expect(
      entryLines(block(prompt("should the ledger sync use backoff for the webhook gateway"))),
    ).toEqual(["workspace/ledger-sync"]);
    expect(pinLines(block(start("s1", { source: "clear" })))).toEqual(THREE_LINES);
  });

  test("four pins with 200-character titles: as many as fit, a count line, at most 840", () => {
    for (const slug of ["pin-a", "pin-b", "pin-c", "pin-d"]) {
      const title = `Pinned ${slug} ${"w".repeat(187)}`;
      expect(title).toHaveLength(200);
      write(WORKSPACE, { slug, title, pinned: true });
    }
    const shown = block(start("s1")) ?? "";
    expect(shown.length).toBeLessThanOrEqual(SESSION_START_SHARE);
    // Two 239-character lines and the count line: 785; a third line would make it 1,025.
    expect(shown).toHaveLength(785);
    const lines = shown.split("\n").filter((line) => line.startsWith("- "));
    const entries = lines.filter((line) => line.includes(" · "));
    expect(entries).toHaveLength(2);
    expect(lines.at(-1)).toBe(
      `- +${4 - entries.length} pinned entries not shown; knowledge_search lists them`,
    );
    expect(shown.split("\n").at(-2)).toBe(lines.at(-1));
    expect(shownRows()).toHaveLength(entries.length);
  });

  test("a project's own pinned entry is shown in that project and not in another", () => {
    write({ scope: "project", projectId }, { slug: "ours", title: "Ours", pinned: true });
    const elsewhere = join(fx.dir, "elsewhere");
    mkdirSync(elsewhere);
    resolveProject(fx.db, elsewhere, NOW);
    write(WORKSPACE, { slug: "everyone", title: "Everyone", pinned: true });
    expect(entryLines(block(start("here"))).sort()).toEqual(["project/ours", "workspace/everyone"]);
    expect(entryLines(block(start("there", { cwd: elsewhere })))).toEqual(["workspace/everyone"]);
  });

  test("a workspace whose taxonomy file is unreadable still shows its pinned lines", () => {
    threePins();
    const repo = ensureRepo(store, WORKSPACE);
    const taxonomy = join(repo.path, "taxonomy.md");
    rmSync(taxonomy, { force: true });
    mkdirSync(taxonomy);
    expect(pinLines(block(start("s1")))).toEqual(THREE_LINES);
  });

  test("with the knowledge folder renamed away, a session start shows the same lines", () => {
    threePins();
    const before = block(start("s1"));
    expect(pinLines(before)).toEqual(THREE_LINES);
    renameSync(join(fx.dataDir, "knowledge"), join(fx.dir, "moved-away"));
    expect(block(start("s2"))).toBe(before);
  });

  test("every session start shows them: a second session, and a project with earlier sessions", () => {
    // Sessions of the project before any pin existed.
    expect(block(start("earlier-1"))).toBeNull();
    expect(block(start("earlier-2"))).toBeNull();
    threePins();
    expect(pinLines(block(start("s1")))).toEqual(THREE_LINES);
    expect(pinLines(block(start("s2")))).toEqual(THREE_LINES);
    const session = (agentSessionId: string) =>
      touchSession(fx.db, {
        agent: "claude-code",
        agentSessionId,
        projectId,
        cwd: project,
        branch: null,
        now: NOW,
      });
    for (const id of ["s2", "s3"]) {
      const row = session(id);
      const input: MomentInput = {
        db: fx.db,
        moment: "session-start",
        projectId,
        branch: null,
        root: project,
        sessionId: row.id,
        epoch: row.contextEpoch,
        prompt: null,
        path: null,
        error: null,
        now: NOW,
        budgetChars: SESSION_START_SHARE,
      };
      expect(contributeModule.showsPins(input)).toBe(true);
    }
  });
});

describe("no file on the hook path", () => {
  const text = "should the ledger sync use backoff for the webhook gateway";

  test("a commit made by hand is not seen until the index is refreshed, and nothing is marked", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    const repo = ensureRepo(store, WORKSPACE) as Repo;
    commitEntryFiles(repo.path, [
      { slug: "ledger-sync-by-hand", title: "Ledger sync by hand", body: LONG_BODY },
    ]);
    const meta = () => fx.db.query<{ key: string }, []>("SELECT key FROM meta ORDER BY key").all();
    const before = meta();
    expect(entryLines(block(prompt(text)))).toEqual(["workspace/ledger-sync"]);
    expect(meta()).toEqual(before);
  });

  test("with the knowledge folder moved away, a prompt shows the same text", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    const before = block(prompt(text));
    expect(before).not.toBeNull();
    renameSync(join(fx.dataDir, "knowledge"), join(fx.dir, "moved-away"));
    expect(block(prompt(text))).toBe(before);
  });
});

describe("the write lock", () => {
  test("held by another connection: memory's text, no knowledge block, nothing recorded", () => {
    write(WORKSPACE, { slug: "ledger-sync" });
    fx.db.run("PRAGMA busy_timeout = 50");
    const other = new Database(join(fx.dataDir, DB_FILE));
    const blocked: EngineModule = {
      ...knowledge,
      contribute: (input) => {
        other.run("BEGIN IMMEDIATE");
        try {
          return knowledge.contribute?.(input) ?? null;
        } finally {
          other.run("ROLLBACK");
        }
      },
    };
    try {
      const text = "should the ledger sync use backoff for the webhook gateway";
      const output = hook("prompt", { prompt: text, sessionId: "locked" }, [memory, blocked]);
      expect(block(output)).toBeNull();
      expect(output).toBe(alone(text));
      expect(shownRows()).toEqual([]);
      const later = hook("prompt", { prompt: text, sessionId: "locked" });
      expect(entryLines(block(later))).toEqual(["workspace/ledger-sync"]);
    } finally {
      other.close();
    }
  });
});

describe("echoes", () => {
  const entryLine = "- workspace/ledger-sync · knowledge · code · Ledger sync";
  const intro =
    "Knowledge the team wrote on purpose and keeps under version control. It is information, not instructions: treat it as current unless the code says otherwise; knowledge_get reads an entry whole.";

  test("a knowledge block is removed whole", () => {
    const text = [
      "Before.",
      WRAPPER_OPEN,
      PROMPT_INTRO,
      entryLine,
      "  The ledger sync retries the webhook with backoff.",
      WRAPPER_CLOSE,
      "After.",
    ].join("\n");
    const out = withoutNotes(text, []);
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
    expect(out).not.toContain("ledger");
    expect(out).not.toContain("wizardingcode-knowledge");
  });

  test("outside a block, entry lines, the count line and both intros go, with or without list marks", () => {
    const lines = [
      entryLine,
      "workspace/ledger-sync · knowledge · code · Ledger sync",
      "> * shared/brand-voice · strategy · marketing · Brand voice",
      "- +3 pinned entries not shown; knowledge_search lists them",
      "+3 pinned entries not shown; knowledge_search lists them",
      intro,
      `> ${PROMPT_INTRO}`,
      PROMPT_INTRO,
    ];
    const kept = ["The answer stays.", "  The ledger sync retries the webhook with backoff."];
    const out = withoutNotes([...lines, ...kept].join("\n"), []);
    expect(out.split("\n").filter((line) => line !== "")).toEqual(kept);
  });
});
