import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { HookEvent } from "../../src/core/types.ts";
import type { EngineModule } from "../../src/engine/module.ts";
import { BUILT_IN, enabledModules } from "../../src/engine/modules.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { knowledgeDir } from "../../src/modules/knowledge/files.ts";
import { knowledge } from "../../src/modules/knowledge/index.ts";
import { refreshIndex } from "../../src/modules/knowledge/index-store.ts";
import { KNOWLEDGE_MIGRATIONS } from "../../src/modules/knowledge/migrations.ts";
import { refreshActiveProjects } from "../../src/modules/knowledge/refresh.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { DEFAULTS } from "../../src/settings/settings.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";

// Knowledge as a module: the essential entries at session start, the relevant ones on a
// prompt, each within its fifth of the budget, never twice in one context, never a draft;
// and with no knowledge folder, memory exactly as it was.

const NOW = Date.UTC(2026, 9, 12, 12);
const START_SHARE = 840;
const PROMPT_SHARE = 480;
const adapter = ADAPTERS["claude-code"] as AgentAdapter;

let base: string;
let repo: string;
let dir: string;
let stores: Db[] = [];
let clock: number;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-module-")));
  repo = join(base, "repo");
  mkdirSync(repo);
  dir = knowledgeDir(repo);
  clock = NOW;
});
afterEach(() => {
  for (const db of stores) db.close();
  stores = [];
  rmSync(base, { recursive: true, force: true });
});

function store(name = "store"): Db {
  const db = openDb({ dataDir: join(base, name), busyTimeoutMs: 2000 });
  stores.push(db);
  return db;
}

/** A few memories about the same things the prompts ask, so memory has something to say. */
function seedMemories(db: Db): void {
  const projectId = resolveProject(db, repo, NOW).id;
  const notes = [
    ["gotcha", "Cancelling an order must keep its invoice", "The invoice is still owed."],
    ["fix", "Order totals were off by a cent", "Rounding happened twice; now once."],
    [
      "decision",
      "Background jobs retry five times",
      "With backoff, then they go to the dead queue.",
    ],
  ] as const;
  for (const [i, [kind, title, body]] of notes.entries()) {
    insertMemory(db, {
      projectId,
      kind,
      title,
      body: body as Redacted,
      terms: "",
      importance: 4,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: NOW - (i + 1) * 3_600_000,
    });
  }
}

function entry(
  slug: string,
  fields: {
    title: string;
    kind?: string;
    essential?: boolean;
    status?: string;
    tags?: string[];
    updated?: string;
  },
  body: string,
  folder = dir,
): void {
  mkdirSync(folder, { recursive: true });
  const lines = [
    "---",
    `title: ${fields.title}`,
    `kind: ${fields.kind ?? "rule"}`,
    ...(fields.essential === undefined ? [] : [`essential: ${fields.essential}`]),
    ...(fields.status === undefined ? [] : [`status: ${fields.status}`]),
    ...(fields.tags === undefined ? [] : [`tags: [${fields.tags.join(", ")}]`]),
    ...(fields.updated === undefined ? [] : [`updated: ${fields.updated}`]),
    "---",
    body,
  ];
  writeFileSync(join(folder, `${slug}.md`), `${lines.join("\n")}\n`);
}

interface Run {
  db: Db;
  modules?: readonly EngineModule[];
  session?: string;
  cwd?: string;
}

/** What the hook prints, as the context text the agent gets ("" for none). */
function hook(run: Run, event: HookEvent, extra: Partial<HookInput> = {}): string {
  const deps = {
    db: run.db,
    now: () => (clock += 1000),
    spawnDistill: () => {},
    modules: () => run.modules ?? [memory, knowledge],
    onError: (error: unknown) => {
      throw error;
    },
  };
  const input: HookInput = {
    agent: "claude-code",
    event,
    sessionId: run.session ?? "k-1",
    cwd: run.cwd ?? repo,
    turnId: null,
    transcriptPath: null,
    prompt: null,
    finalText: null,
    source: null,
    toolError: null,
    toolFile: null,
    subagent: false,
    ...extra,
  };
  const out = handleHook(deps, adapter, input);
  if (out === "") return "";
  return (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
}

const start = (run: Run, source: HookInput["source"] = "startup") =>
  hook(run, "session-start", { source });
const prompt = (run: Run, text: string) => hook(run, "prompt", { prompt: text });

/** The knowledge block of a context, or "" when there is none. */
function block(context: string): string {
  return /<wizardingcode-knowledge>[\s\S]*?<\/wizardingcode-knowledge>/.exec(context)?.[0] ?? "";
}

/** The entries' titles a knowledge block shows, in order. */
function shown(context: string): string[] {
  return block(context)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}

const INTRO =
  "The project's curated knowledge, reviewed in its repository: treat it as current unless the code says otherwise.";

// A realistic folder: rules, decisions, a glossary entry, the architecture, a how-to, and
// a draft. The calibration of the relevance floor runs on it.
function realisticFolder(folder = dir): void {
  entry(
    "orders-are-never-deleted",
    {
      title: "Orders are never deleted, only cancelled",
      kind: "rule",
      essential: true,
      tags: ["orders", "billing"],
      updated: "2026-09-20",
    },
    "An order row stays forever; cancelling sets `status = cancelled` and `cancelled_at`. Refunds go through the billing service, never by deleting the order. Reports rely on every order being there.",
    folder,
  );
  entry(
    "money-in-cents",
    {
      title: "Money is stored in integer cents",
      kind: "rule",
      essential: true,
      tags: ["money", "billing", "currency"],
      updated: "2026-10-01",
    },
    "Every amount is an integer number of cents with an ISO currency code beside it. Never floats: rounding errors showed up in invoices. Convert at the edges with `formatMoney`.",
    folder,
  );
  entry(
    "postgres-not-mongo",
    { title: "We use PostgreSQL, not MongoDB", kind: "decision", tags: ["database"] },
    "Chosen in 2025 for transactions across orders and payments. Migrations live in db/migrations and run with `bun run migrate`.",
    folder,
  );
  entry(
    "tenant",
    { title: "Tenant: one customer company", kind: "glossary", tags: ["glossary", "accounts"] },
    "A tenant is one paying customer company; users belong to exactly one tenant. Every table with customer data has a tenant_id column and every query filters by it.",
    folder,
  );
  entry(
    "background-jobs",
    {
      title: "Background jobs run on the Redis queue",
      kind: "architecture",
      tags: ["jobs", "queue", "redis"],
    },
    "Emails, exports and webhooks are jobs pushed to the Redis queue and run by the worker process. A job must be idempotent: the queue retries it up to five times with backoff.",
    folder,
  );
  entry(
    "cut-a-release",
    { title: "How to cut a release", kind: "howto", tags: ["release", "deploy"] },
    "Bump the version in package.json, run `bun run check`, tag vX.Y.Z and push the tag; CI builds and publishes the binaries.",
    folder,
  );
  entry(
    "access-tokens",
    {
      title: "Access tokens are JWTs that expire after 15 minutes",
      kind: "decision",
      tags: ["auth", "security"],
    },
    "Access tokens are short-lived JWTs signed with the rotating key; refresh tokens live in an httpOnly cookie for 30 days.",
    folder,
  );
  entry(
    "queue-on-sqs",
    { title: "Move the queue to SQS", kind: "decision", status: "draft", tags: ["queue", "sqs"] },
    "Under discussion: moving background jobs from the Redis queue to SQS, for retries and dead letters.",
    folder,
  );
}

describe("the knowledge module", () => {
  test("is built in, on by default, takes a fifth of start and prompt, and owns its tables", () => {
    expect(BUILT_IN.map((module) => module.id)).toEqual(["memory", "knowledge"]);
    expect(DEFAULTS.modules).toBe("memory,knowledge");
    expect(enabledModules(undefined).map((module) => module.id)).toEqual(["memory", "knowledge"]);
    expect(knowledge.id).toBe("knowledge");
    expect(knowledge.name).toBe("Knowledge");
    expect(knowledge.share).toBe(0.2);
    expect(knowledge.migrations).toBe(KNOWLEDGE_MIGRATIONS);
  });
});

describe("with no knowledge folder", () => {
  test("memory says exactly what it says alone, and knowledge writes nothing", () => {
    const alone = store("alone");
    const both = store("both");
    seedMemories(alone);
    seedMemories(both);
    const steps = (run: Run) => {
      clock = NOW;
      return [
        start(run),
        prompt(run, "can I delete an order when the customer cancels it and wants a refund?"),
        prompt(run, "the invoice total is off by a cent after rounding"),
        hook(run, "file-read", { toolFile: join(repo, "src/orders.ts") }),
        start(run, "compact"),
        prompt(run, "how many times do background jobs retry?"),
      ];
    };
    const memoryOnly = steps({ db: alone, modules: [memory] });
    const withKnowledge = steps({ db: both });
    expect(withKnowledge).toEqual(memoryOnly);
    // Memory did speak: the comparison is not between two silences.
    expect(memoryOnly.filter((out) => out !== "").length).toBeGreaterThanOrEqual(3);
    expect(withKnowledge.some((out) => out.includes("wizardingcode-knowledge"))).toBe(false);
    const count = (table: string) =>
      both.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;
    expect(count("knowledge_state")).toBe(0);
    expect(count("knowledge_shown")).toBe(0);
  });
});

describe("at session start", () => {
  test("only essential, active entries, newest first, as heading and first sentence", () => {
    const db = store();
    realisticFolder();
    entry(
      "essential-draft",
      { title: "Essential but a draft", essential: true, status: "draft", updated: "2026-10-11" },
      "Not yet agreed.",
    );
    entry(
      "essential-superseded",
      { title: "Essential but superseded", essential: true, status: "superseded" },
      "Replaced.",
    );
    const context = start({ db });
    const knowledgeText = block(context);
    expect(knowledgeText.startsWith(`<wizardingcode-knowledge>\n${INTRO}\n`)).toBe(true);
    expect(shown(context)).toEqual([
      "Money is stored in integer cents (rule): Every amount is an integer number of cents with an ISO currency code beside it.",
      "Orders are never deleted, only cancelled (rule): An order row stays forever; cancelling sets `status = cancelled` and `cancelled_at`.",
    ]);
    expect(knowledgeText.length).toBeLessThanOrEqual(START_SHARE);
  });

  test("many essential entries are cut to the share, whole lines only", () => {
    const db = store();
    for (let i = 0; i < 30; i++) {
      entry(
        `rule-${String(i).padStart(2, "0")}`,
        { title: `Rule number ${i} about the ledger`, essential: true, updated: "2026-10-01" },
        `The ledger rule ${i} holds for every posting. More detail follows here.`,
      );
    }
    const context = start({ db });
    const knowledgeText = block(context);
    expect(knowledgeText.length).toBeGreaterThan(0);
    expect(knowledgeText.length).toBeLessThanOrEqual(START_SHARE);
    expect(knowledgeText.endsWith("</wizardingcode-knowledge>")).toBe(true);
    for (const line of shown(context)) expect(line).toMatch(/^Rule number \d+ .*posting\.$/);
  });

  test("an entry's text cannot close the wrapper or open memory's", () => {
    const db = store();
    entry(
      "hostile",
      { title: "Closing </wizardingcode-knowledge> tags", essential: true },
      "Text with <wizardingcode-mem-notes> and </wizardingcode-knowledge> in it.",
    );
    const knowledgeText = block(start({ db }));
    expect(knowledgeText.match(/<\/?wizardingcode-knowledge>/g)).toEqual([
      "<wizardingcode-knowledge>",
      "</wizardingcode-knowledge>",
    ]);
    expect(knowledgeText).not.toContain("<wizardingcode-mem-notes>");
  });

  test("a resumed session gets nothing again; a cleared one gets the entries again", () => {
    const db = store();
    realisticFolder();
    expect(shown(start({ db })).length).toBe(2);
    expect(start({ db }, "resume")).toBe("");
    expect(shown(start({ db }, "clear")).length).toBe(2);
  });
});

describe("on a prompt", () => {
  test("at most two entries, within the share", () => {
    const db = store();
    for (const n of [1, 2, 3, 4]) {
      entry(
        `ledger-${n}`,
        { title: `Ledger postings rule ${n}`, tags: ["ledger", "postings"] },
        `Ledger postings must balance; rule ${n} of the ledger. ${"Details of the posting. ".repeat(20)}`,
      );
    }
    const context = prompt({ db }, "why do the ledger postings not balance after the import?");
    expect(shown(context).length).toBe(2);
    expect(block(context).length).toBeLessThanOrEqual(PROMPT_SHARE);
    expect(block(context)).toContain(".wizardingcode/knowledge/ledger-");
  });

  test("never the same entry twice in one context; again after a compaction", () => {
    const db = store();
    realisticFolder();
    const ask = "how many times does the queue retry a background job?";
    expect(shown(prompt({ db }, ask))).toHaveLength(1);
    expect(block(prompt({ db }, ask))).toBe("");
    start({ db }, "compact");
    expect(shown(prompt({ db }, ask))).toHaveLength(1);
  });

  test("an essential entry shown at start is not repeated by a prompt in the same context", () => {
    const db = store();
    realisticFolder();
    expect(block(start({ db }))).toContain("Orders are never deleted");
    expect(block(prompt({ db }, "can I delete an order when the customer wants a refund?"))).toBe(
      "",
    );
  });

  test("a draft or superseded entry is never injected, however well it matches", () => {
    const db = store();
    entry(
      "draft-sqs",
      { title: "Move the jobs queue to SQS", status: "draft", tags: ["sqs", "queue"] },
      "Moving the jobs queue to SQS for dead letters.",
    );
    entry(
      "old-sqs",
      { title: "The jobs queue stays on SQS", status: "superseded", tags: ["sqs", "queue"] },
      "The jobs queue stays on SQS with dead letters.",
    );
    expect(block(prompt({ db }, "should the jobs queue move to SQS for dead letters?"))).toBe("");
  });

  test("an entry added or edited between prompts is seen at once in a small folder", () => {
    const db = store();
    realisticFolder();
    const ask = "which webhook signing secret rotation schedule do we follow?";
    expect(block(prompt({ db }, ask))).toBe("");
    entry(
      "webhook-secrets",
      { title: "Webhook signing secrets rotate monthly", tags: ["webhook", "secrets"] },
      "The webhook signing secret rotates on the first of each month; both keys verify for a day.",
    );
    expect(shown(prompt({ db }, ask))[0]).toContain("Webhook signing secrets rotate monthly");
    entry(
      "webhook-secrets",
      { title: "Webhook signing secrets rotate weekly", tags: ["webhook", "secrets"] },
      "The webhook signing secret rotates every Monday; both keys verify for a day.",
    );
    start({ db }, "clear");
    expect(shown(prompt({ db }, ask))[0]).toContain("rotate weekly");
  });

  test("an entry deleted or renamed between prompts is never shown under its old name", () => {
    const db = store();
    realisticFolder();
    const ask = "how many times does the queue retry a background job?";
    expect(block(prompt({ db }, ask))).toContain("background-jobs.md");
    renameSync(join(dir, "background-jobs.md"), join(dir, "jobs-on-redis.md"));
    start({ db }, "clear");
    const renamed = block(prompt({ db }, ask));
    expect(renamed).toContain("jobs-on-redis.md");
    expect(renamed).not.toContain("background-jobs.md");
    rmSync(join(dir, "jobs-on-redis.md"));
    start({ db }, "clear");
    expect(block(prompt({ db }, ask))).toBe("");
  });

  test("a large folder uses the index it has; the background drain brings it up to date", () => {
    const db = store();
    for (let i = 0; i < 500; i++) {
      entry(
        `filler-${String(i).padStart(3, "0")}`,
        { title: `Filler entry ${i} about component ${i}`, tags: ["filler"] },
        `Component ${i} has its own notes. Nothing else to say about component ${i}.`,
      );
    }
    // The first session: nothing indexed yet, and too many files to index inline.
    const ask = "which webhook signing secret rotation schedule do we follow?";
    expect(block(prompt({ db }, ask))).toBe("");
    expect(refreshActiveProjects(db, clock).refreshed).toBe(1);
    entry(
      "webhook-secrets",
      { title: "Webhook signing secrets rotate monthly", tags: ["webhook", "secrets"] },
      "The webhook signing secret rotates on the first of each month.",
    );
    start({ db }, "clear");
    // Changed, but over the inline limit: the stale index is used.
    expect(block(prompt({ db }, ask))).toBe("");
    refreshActiveProjects(db, clock);
    start({ db }, "clear");
    expect(shown(prompt({ db }, ask))[0]).toContain("Webhook signing secrets rotate monthly");
  });
});

describe("file reads and tool failures", () => {
  test("knowledge adds nothing to them", () => {
    const alone = store("alone");
    const both = store("both");
    seedMemories(alone);
    seedMemories(both);
    realisticFolder();
    const steps = (run: Run) => {
      clock = NOW;
      return [
        hook(run, "file-read", { toolFile: join(repo, "src/orders.ts") }),
        hook(run, "tool-failed", { toolError: "Exit code 1\nError: order total off by a cent" }),
      ];
    };
    expect(steps({ db: both })).toEqual(steps({ db: alone, modules: [memory] }));
  });
});

describe("failing open", () => {
  test("a broken knowledge index leaves memory's output whole", () => {
    const alone = store("alone");
    const broken = store("broken");
    seedMemories(alone);
    seedMemories(broken);
    realisticFolder();
    broken.run("DROP TABLE knowledge_state");
    const errors: unknown[] = [];
    const steps = (db: Db, modules?: readonly EngineModule[]) => {
      clock = NOW;
      const run = (event: HookEvent, extra: Partial<HookInput>) => {
        const out = handleHook(
          {
            db,
            now: () => (clock += 1000),
            spawnDistill: () => {},
            modules: () => modules ?? [memory, knowledge],
            onError: (error) => errors.push(error),
          },
          adapter,
          {
            agent: "claude-code",
            event,
            sessionId: "k-1",
            cwd: repo,
            turnId: null,
            transcriptPath: null,
            prompt: null,
            finalText: null,
            source: null,
            toolError: null,
            toolFile: null,
            subagent: false,
            ...extra,
          },
        );
        return out;
      };
      return [
        run("session-start", { source: "startup" }),
        run("prompt", { prompt: "can I delete an order when the customer wants a refund?" }),
      ];
    };
    const memoryOnly = steps(alone, [memory]);
    expect(errors).toEqual([]);
    const withBroken = steps(broken);
    expect(withBroken).toEqual(memoryOnly);
    expect(memoryOnly[0]).not.toBe("");
    // Told, not thrown.
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("the relevance floor", () => {
  // Prompts an agent would get in this project, and the entry each should bring.
  const RELEVANT: [string, string][] = [
    ["can I delete an order when the customer asks for a refund?", "Orders are never deleted"],
    ["the invoice total is off by a cent, are we using floats somewhere?", "Money is stored"],
    ["should we move the orders database from PostgreSQL to MongoDB?", "We use PostgreSQL"],
    ["can a user belong to two tenants at once?", "Tenant: one customer company"],
    ["how many times does the queue retry a background job?", "Background jobs run"],
    ["send the export email from a background job", "Background jobs run"],
    ["how do I tag and publish a new release?", "How to cut a release"],
    ["how long do access tokens last before they expire?", "Access tokens are JWTs"],
    ["where does `formatMoney` round the amount?", "Money is stored"],
  ];
  // Prompts with nothing to do with any entry, some sharing a stray word with one.
  const UNRELATED = [
    "fix the CSS of the login button on mobile",
    "rename this variable to camelCase everywhere",
    "sort the list of results in reverse order",
    "why is the build so slow?",
    "write a unit test for the date parser",
    "how many users signed up last week?",
    "explain how React hooks work",
    "update the README with the install steps",
    "the cancel button in the modal does nothing",
    "add a dark mode toggle to the settings page",
    "the tests time out on the worker",
    "should the queue move to SQS?",
  ];

  test("the realistic folder: the right entry for each prompt, nothing for the others", () => {
    const db = store();
    realisticFolder();
    shortTitleFolder();
    for (const [i, [ask, title]] of RELEVANT.entries()) {
      const titles = shown(prompt({ db, session: `relevant-${i}` }, ask));
      expect({ ask, first: titles[0] ?? "" }).toEqual({
        ask,
        first: expect.stringContaining(title) as unknown as string,
      });
    }
    for (const [i, ask] of UNRELATED.entries()) {
      expect({ ask, block: block(prompt({ db, session: `unrelated-${i}` }, ask)) }).toEqual({
        ask,
        block: "",
      });
    }
  });

  test("a folder of one entry: found when asked about, silent otherwise", () => {
    const db = store();
    entry(
      "orders-are-never-deleted",
      { title: "Orders are never deleted, only cancelled", tags: ["orders", "billing"] },
      "An order row stays forever; cancelling sets `status = cancelled`. Refunds go through the billing service.",
    );
    const found = prompt({ db, session: "one-a" }, RELEVANT[0]?.[0] as string);
    expect(shown(found)[0]).toContain("Orders are never deleted");
    for (const [i, ask] of UNRELATED.entries()) {
      expect({ ask, block: block(prompt({ db, session: `one-${i}` }, ask)) }).toEqual({
        ask,
        block: "",
      });
    }
  });
});

// Short titles, of one or two words of their own, as curated folders often have. A title
// this short shares its one word with many unrelated prompts: it must not be a back door.
const SHORT_TITLES: [string, string, string, string][] = [
  [
    "order-lifecycle",
    "Order lifecycle",
    "architecture",
    "An order goes from draft to paid to shipped. A paid order can only be cancelled, never edited.",
  ],
  [
    "user-roles",
    "User roles",
    "glossary",
    "Admins manage the billing and the members; members see only their own projects.",
  ],
  [
    "config-loading",
    "Config loading",
    "architecture",
    "Settings come from config.toml, then the environment, then flags; the last one wins.",
  ],
  [
    "logging",
    "Logging",
    "rule",
    "Log through the shared logger with a request id; never console.log in production code.",
  ],
  [
    "caching",
    "Caching",
    "architecture",
    "Product pages are cached in Redis for five minutes; prices are never cached.",
  ],
  [
    "date-handling",
    "Date handling",
    "rule",
    "Dates are stored in UTC and shown in the customer's time zone; parse them with Temporal.",
  ],
  [
    "feature-flags",
    "Feature flags",
    "howto",
    "Flags live in flags.yaml; remove a flag within two releases of turning it on for everyone.",
  ],
  [
    "error-codes",
    "Error codes",
    "rule",
    "API errors carry a stable code like ORDER_NOT_FOUND; the message may change, the code never does.",
  ],
];

function shortTitleFolder(folder = dir): void {
  for (const [slug, title, kind, body] of SHORT_TITLES) entry(slug, { title, kind }, body, folder);
}

describe("the relevance floor with short titles", () => {
  const RELEVANT: [string, string][] = [
    ["can a shipped order still go back to draft?", "Order lifecycle"],
    ["which feature flags can we remove now?", "Feature flags"],
    ["are product prices cached?", "Caching"],
    ["what time zone should dates be shown in?", "Date handling"],
    ["can I use `console.log` for debugging here?", "Logging"],
    ["what can admins see that members cannot?", "User roles"],
    ["what does ORDER_NOT_FOUND mean?", "Error codes"],
  ];
  // Each shares one common word with a short title, and nothing else.
  const UNRELATED = [
    "sort the list of results in reverse order",
    "how many users signed up last week?",
    "the user avatar is blurry on retina screens",
    "update the eslint config to allow unused vars",
    "add a log line when the export starts",
    "clear the npm cache and reinstall",
    "the date picker looks broken on mobile",
    "rename the feature branch before merging",
    "in what order should I run the migrations?",
    "the build fails with a TypeScript error",
    "why does this test hang?",
    "show an error toast when the upload fails",
    "move the user menu to the right",
    "the config file is missing after install",
    "add a loading spinner to the dashboard",
    "which roles does the Helm chart define?",
  ];

  test("beside the realistic folder: the right entry for each prompt, nothing for the others", () => {
    const db = store();
    realisticFolder();
    shortTitleFolder();
    for (const [i, [ask, title]] of RELEVANT.entries()) {
      // Among the two shown: a longer entry may share as much with the prompt.
      const titles = shown(prompt({ db, session: `short-relevant-${i}` }, ask));
      expect({ ask, found: titles.some((line) => line.startsWith(title)) }).toEqual({
        ask,
        found: true,
      });
    }
    for (const [i, ask] of UNRELATED.entries()) {
      expect({ ask, block: block(prompt({ db, session: `short-unrelated-${i}` }, ask)) }).toEqual({
        ask,
        block: "",
      });
    }
  });

  test("each short title alone in its folder: still nothing for the unrelated prompts", () => {
    for (const [slug, title, kind, body] of SHORT_TITLES) {
      rmSync(dir, { recursive: true, force: true });
      entry(slug, { title, kind }, body);
      const db = store(`alone-${slug}`);
      for (const [i, ask] of UNRELATED.entries()) {
        expect({ title, ask, block: block(prompt({ db, session: `alone-${i}` }, ask)) }).toEqual({
          title,
          ask,
          block: "",
        });
      }
    }
  });
});

describe("the drain's refresh", () => {
  test("refreshes the projects active lately, and only those, a bounded number", () => {
    const db = store();
    realisticFolder();
    const quiet = join(base, "quiet");
    mkdirSync(quiet);
    realisticFolder(knowledgeDir(quiet));
    // Both projects had a session; the quiet one long ago.
    clock = NOW - 10 * 86_400_000;
    start({ db, cwd: quiet, session: "old" });
    clock = NOW;
    start({ db, session: "recent" });
    const before = db.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_state").get();
    entry("late", { title: "Added late" }, "Added after the last hook.");
    utimesSync(join(dir, "late.md"), new Date(NOW), new Date(NOW + 5000));
    const result = refreshActiveProjects(db, NOW, { maxProjects: 5 });
    expect(result.refreshed).toBe(1);
    const projectId = resolveProject(db, repo, NOW).id;
    expect(
      db
        .query<{ slug: string }, [number]>(
          "SELECT slug FROM knowledge_entries WHERE project_id = ? AND slug = 'late'",
        )
        .get(projectId),
    ).not.toBeNull();
    expect(before?.n).toBe(2);
    expect(refreshActiveProjects(db, NOW, { maxProjects: 0 }).refreshed).toBe(0);
  });

  test("bounded in time: past its deadline no further project is refreshed (final review)", () => {
    const db = store();
    realisticFolder();
    const other = join(base, "other");
    mkdirSync(other);
    realisticFolder(knowledgeDir(other));
    start({ db, session: "one" });
    start({ db, cwd: other, session: "two" });
    db.run("DELETE FROM knowledge_state");
    expect(refreshActiveProjects(db, NOW, { maxMs: 0 }).refreshed).toBe(0);
    expect(refreshActiveProjects(db, NOW).refreshed).toBe(2);
  });

  test("a project whose folder is gone gets an empty index", () => {
    const db = store();
    realisticFolder();
    start({ db });
    const projectId = resolveProject(db, repo, NOW).id;
    rmSync(dir, { recursive: true });
    refreshActiveProjects(db, clock);
    expect(
      db
        .query<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM knowledge_entries WHERE project_id = ?",
        )
        .get(projectId)?.n,
    ).toBe(0);
    // The index is still the files': a forced rebuild from nothing gives nothing.
    expect(refreshIndex(db, projectId, dir, { force: true }).indexed).toBe(0);
  });
});
