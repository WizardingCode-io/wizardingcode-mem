// The measuring half of scripts/proof/knowledge.sh (ADR 0020). Run by that script:
//
//   bun scripts/proof/knowledge.ts <out dir> [--runs 30] [--no-copy]
//
// a. A synthetic project under <out dir>/synthetic, with its own store: 20 entries written for
//    the proof (a fictional shop backend, no real data) and 500 synthetic memories. Prints the
//    session start and a few prompts as the agent gets them, times the session-start and prompt
//    hooks in process (handleHook, memory and knowledge) with 0 entries (no folder), 50 and 500,
//    and counts what the relevance floor lets through: the entries' own prompts (which should
//    bring their entry) and unrelated ones (which should bring nothing), then the probe in
//    tests/fixtures/knowledge-probe.ts. Every prompt runs in a new session, so nothing is held
//    back as already shown.
// b. Without --no-copy: the copy of the real database in the data directory the environment
//    names (WIZARDINGCODE_HOME), never the live one. Runs proposePromotions drain after drain
//    until its cursor has reached the backlog, then quiet drains, and counts the proposals by
//    project, kind and reason. Proposing writes no file; nothing is accepted.
//
// Writes <out dir>/report.md (anonymous: counts and latencies) and <out dir>/full.md (project
// names and memory titles: for the author's eyes only; never commit it).

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { HookEvent } from "../../src/core/types.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { knowledgeDir, slugify } from "../../src/modules/knowledge/files.ts";
import { knowledge } from "../../src/modules/knowledge/index.ts";
import { refreshIndex } from "../../src/modules/knowledge/index-store.ts";
import { projectRoot, proposePromotions } from "../../src/modules/knowledge/promote.ts";
import { memory } from "../../src/modules/memory/index.ts";
import { DB_FILE, type Db, openDb, withWrite } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { getMeta } from "../../src/store/meta.ts";
import { defaultDataDir, resolvePaths } from "../../src/util/paths.ts";
import { searchTerms } from "../../src/util/words.ts";
import {
  PROBE_ENTRIES,
  PROBE_RELEVANT,
  PROBE_UNRELATED,
} from "../../tests/fixtures/knowledge-probe.ts";
import { assertNotLive } from "./live-guard.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const out = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (out === undefined) {
  console.error("usage: bun scripts/proof/knowledge.ts <out dir> [--runs 30] [--no-copy]");
  process.exit(1);
}
const RUNS = Number(option("runs", "30"));
const COPY = !args.includes("--no-copy");

interface Stats {
  n: number;
  p50: number;
  p95: number;
}
function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)) };
}
const fmt = (s: Stats) => `${s.p50} / ${s.p95} (n=${s.n})`;

const report: string[] = [];
const full: string[] = [];
const both = (line: string) => {
  report.push(line);
  full.push(line);
};

// ---- a. the synthetic project ----------------------------------------------------------

interface Entry {
  title: string;
  kind: "decision" | "rule" | "glossary" | "architecture" | "howto";
  essential?: boolean;
  status?: "draft" | "superseded";
  tags: string[];
  updated: string;
  body: string;
}

// A fictional shop backend's knowledge, written for this proof.
const ENTRIES: Entry[] = [
  {
    title: "Orders are never deleted, only cancelled",
    kind: "rule",
    essential: true,
    tags: ["orders", "billing"],
    updated: "2026-09-28",
    body: "An order row stays forever; cancelling sets `status = cancelled` and `cancelled_at`. Refunds go through the billing service, never by deleting the order, because the monthly reports count every order.",
  },
  {
    title: "Money is stored in integer cents",
    kind: "rule",
    essential: true,
    tags: ["money", "prices"],
    updated: "2026-09-21",
    body: "Every amount is an integer number of cents with its ISO currency beside it. Format for display with `formatMoney` only; never use floats for prices, totals or taxes.",
  },
  {
    title: "Migrations are forward only",
    kind: "rule",
    essential: true,
    tags: ["database", "migrations"],
    updated: "2026-08-30",
    body: "A schema migration is never edited once merged and never rolled back in production. To undo one, write a new migration. Each migration must run in under a minute on the production table sizes.",
  },
  {
    title: "Customer emails are never logged",
    kind: "rule",
    essential: true,
    tags: ["privacy", "logging"],
    updated: "2026-09-02",
    body: "Logs carry the customer id, never the email, name or address. The logger's redact list covers the known fields; a new personal field must be added to it in the same change.",
  },
  {
    title: "Stock is reserved at checkout, not at add to cart",
    kind: "decision",
    tags: ["stock", "checkout"],
    updated: "2026-07-14",
    body: "Reserving on add to cart let abandoned carts hold stock for hours. Stock is reserved when checkout starts and released after 15 minutes without payment.",
  },
  {
    title: "Payments go through Stripe, with idempotency keys",
    kind: "decision",
    tags: ["payments", "stripe"],
    updated: "2026-06-03",
    body: "Every Stripe call carries an idempotency key derived from the order id and the attempt, so a retried webhook or request never charges twice. The webhook handler is the only place that marks an order paid.",
  },
  {
    title: "Search runs on Postgres full text, not Elasticsearch",
    kind: "decision",
    tags: ["search", "postgres"],
    updated: "2026-05-19",
    body: "The catalogue has about 40,000 products; Postgres full text with a trigram index answers in under 30 ms. Elasticsearch was dropped to remove one cluster to run. Revisit past 1 million products.",
  },
  {
    title: "Emails are sent from a background queue",
    kind: "decision",
    tags: ["email", "queue"],
    updated: "2026-04-11",
    body: "Requests never send email inline. They enqueue a job; the mailer worker sends it through Postmark and retries five times with backoff before giving up.",
  },
  {
    title: "Feature flags expire after two releases",
    kind: "rule",
    tags: ["flags", "releases"],
    updated: "2026-08-08",
    body: "A flag fully turned on must be removed within two releases, with its dead branch. `flags.yaml` lists each flag's owner and the release it was turned on in.",
  },
  {
    title: "SKU",
    kind: "glossary",
    tags: ["catalogue"],
    updated: "2026-03-02",
    body: "Stock keeping unit: one sellable variant of a product (size and colour). Stock, prices and barcodes belong to the SKU, not to the product.",
  },
  {
    title: "Fulfilment centre",
    kind: "glossary",
    tags: ["warehouse", "shipping"],
    updated: "2026-03-02",
    body: "The warehouse that picks, packs and ships an order. An order with SKUs in two fulfilment centres is split into two shipments.",
  },
  {
    title: "Basket versus cart",
    kind: "glossary",
    tags: ["checkout"],
    updated: "2026-02-20",
    body: "The code says cart everywhere; basket is the word the shop shows customers in the UK storefront. They are the same thing.",
  },
  {
    title: "How a request reaches the database",
    kind: "architecture",
    tags: ["api", "layers"],
    updated: "2026-09-10",
    body: "Routes in `src/http` validate input with zod and call a service in `src/services`; only services use the repositories in `src/db`. Routes never import the database directly.",
  },
  {
    title: "Webhooks are verified, then queued",
    kind: "architecture",
    tags: ["webhooks", "stripe"],
    updated: "2026-06-03",
    body: "Each incoming webhook is checked against the provider's signature, stored raw in `webhook_events` and processed by a worker, so a slow handler never times the provider out.",
  },
  {
    title: "Images are served from the CDN with signed URLs",
    kind: "architecture",
    tags: ["images", "cdn"],
    updated: "2026-05-01",
    body: "Product images live in object storage and are served through the CDN; private images (invoices, returns) get signed URLs valid for ten minutes.",
  },
  {
    title: "How to add a payment method",
    kind: "howto",
    tags: ["payments"],
    updated: "2026-07-01",
    body: "Add the method to `PAYMENT_METHODS`, enable it in the Stripe dashboard for test and live, add its icon, and cover the webhook events it sends in `tests/webhooks`.",
  },
  {
    title: "How to run the test suite against a real database",
    kind: "howto",
    tags: ["tests", "database"],
    updated: "2026-08-15",
    body: "Start the database with `docker compose up db`, then run `pnpm test:integration`. Each test file gets its own schema, dropped at the end.",
  },
  {
    title: "How to cut a release",
    kind: "howto",
    tags: ["releases"],
    updated: "2026-09-15",
    body: "Merge to main, tag `vX.Y.Z`, and the release workflow builds the images and deploys to staging; production is promoted by hand from the deploy dashboard after a smoke test.",
  },
  {
    title: "Move sessions to Redis",
    kind: "decision",
    status: "draft",
    tags: ["sessions", "redis"],
    updated: "2026-10-01",
    body: "Proposal, not agreed: keep login sessions in Redis instead of the sessions table, to take load off the primary database.",
  },
  {
    title: "Prices include VAT in the storefront",
    kind: "rule",
    status: "superseded",
    tags: ["prices", "tax"],
    updated: "2025-11-30",
    body: "Replaced by per-market display rules: the storefront shows prices with or without VAT depending on the market.",
  },
];

// Prompts that ask about one entry (the title it should bring) and prompts that should get none.
const OWN_RELEVANT: [string, string][] = [
  ["can I delete a test order from the admin?", "Orders are never deleted, only cancelled"],
  ["should the discount be a float or stored in cents?", "Money is stored in integer cents"],
  ["the migration is wrong, can I edit it and rerun it?", "Migrations are forward only"],
  ["is it ok to log the customer email when signup fails?", "Customer emails are never logged"],
  [
    "when is the stock reserved, at checkout or add to cart?",
    "Stock is reserved at checkout, not at add to cart",
  ],
  [
    "a Stripe webhook retried and charged twice, how do idempotency keys work here?",
    "Payments go through Stripe, with idempotency keys",
  ],
  [
    "should we add Elasticsearch for the product search?",
    "Search runs on Postgres full text, not Elasticsearch",
  ],
  [
    "send the confirmation email inline from the request handler",
    "Emails are sent from a background queue",
  ],
  ["which feature flags can we remove this release?", "Feature flags expire after two releases"],
  ["an order has SKUs in two fulfilment centres, how many shipments?", "Fulfilment centre"],
  ["can the route import the database repository directly?", "How a request reaches the database"],
  ["how do I add a new payment method like MB Way?", "How to add a payment method"],
  [
    "how do I run the integration test suite against a real database?",
    "How to run the test suite against a real database",
  ],
  ["what are the steps to cut a release and deploy to production?", "How to cut a release"],
];
const OWN_UNRELATED: string[] = [
  "the navbar overlaps the logo on mobile",
  "rename the variable in this loop to something clearer",
  "why is the dev server so slow to start today?",
  "add a dark mode toggle to the settings page",
  "write a unit test for the slugify helper",
  "the order of the columns in the admin table is wrong",
  "update the README with the new screenshots",
  "bump typescript and fix the type errors",
  "the email field in the signup form has no label",
  "make the release notes page load faster",
  "o botão de pesquisa está desalinhado",
  "traduz esta mensagem de erro para português",
];

const START_PROMPTS = [
  "can I delete a test order from the admin?",
  "should we add Elasticsearch for the product search?",
  "the navbar overlaps the logo on mobile",
];

function entryText(entry: Entry): string {
  return [
    "---",
    `title: ${JSON.stringify(entry.title)}`,
    `kind: ${entry.kind}`,
    `essential: ${entry.essential === true}`,
    `status: ${entry.status ?? "active"}`,
    `tags: [${entry.tags.join(", ")}]`,
    `updated: ${entry.updated}`,
    "---",
    entry.body,
    "",
  ].join("\n");
}

const adapter = ADAPTERS["claude-code"] as AgentAdapter;
const synth = join(out, "synthetic");
rmSync(synth, { recursive: true, force: true });
const project = join(synth, "shop");
mkdirSync(project, { recursive: true });
const sdb: Db = openDb({ dataDir: join(synth, "store"), busyTimeoutMs: 5000 });
const projectId = resolveProject(sdb, project, Date.now()).id;
let clock = Date.now();
let sessionSeq = 0;

function hook(event: HookEvent, extra: Partial<HookInput>, cwd = project): string {
  const input: HookInput = {
    agent: "claude-code",
    event,
    sessionId: `proof-${++sessionSeq}`,
    cwd,
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
  const text = handleHook(
    {
      db: sdb,
      now: () => (clock += 1000),
      spawnDistill: () => {},
      modules: () => [memory, knowledge],
      onError: (error) => {
        throw error;
      },
    },
    adapter,
    input,
  );
  if (text === "") return "";
  return (JSON.parse(text) as { hookSpecificOutput: { additionalContext: string } })
    .hookSpecificOutput.additionalContext;
}
const start = (cwd = project) => hook("session-start", { source: "startup" }, cwd);
const prompt = (text: string, cwd = project) => hook("prompt", { prompt: text }, cwd);
const knowledgeBlock = (context: string) =>
  /<wizardingcode-knowledge>[\s\S]*?<\/wizardingcode-knowledge>/.exec(context)?.[0] ?? "";
const shownTitles = (context: string) =>
  knowledgeBlock(context)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) =>
      line.slice(2).replace(/ \((decision|rule|glossary|architecture|howto)[,)].*$/, ""),
    );

// Memories, so memory has work to do beside knowledge: 500 synthetic notes about the same shop.
const NOTE_WORDS =
  "order cart checkout stock payment refund invoice shipment webhook queue worker retry email template price discount coupon tax currency product variant image cdn search index session login token cache migration schema test fixture release deploy staging flag admin report export".split(
    " ",
  );
let seed = 42;
const next = (max: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % max;
};
const word = () => NOTE_WORDS[next(NOTE_WORDS.length)] as string;
withWrite(sdb, () => {
  for (let i = 0; i < 500; i++) {
    const title = `The ${word()} ${word()} ${["broke", "needs", "uses", "skips", "retries"][i % 5]} the ${word()} ${word()}`;
    const body = `Seen when the ${word()} ${word()} met the ${word()}; fixed in src/${word()}/${word()}.ts.`;
    insertMemory(sdb, {
      projectId,
      kind: (["gotcha", "fix", "decision", "convention", "discovery"] as const)[i % 5] ?? "fix",
      title,
      body: body as Redacted,
      terms: searchTerms(title, body, []),
      importance: 2 + (i % 4),
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: [],
      now: clock - i * 60_000,
    });
  }
});

const folder = knowledgeDir(project);
function writeFolder(fillers: number): void {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  for (const entry of ENTRIES) {
    writeFileSync(join(folder, `${slugify(entry.title)}.md`), entryText(entry));
  }
  const kinds = ["rule", "decision", "glossary", "architecture", "howto"] as const;
  for (let i = 0; i < fillers; i++) {
    writeFileSync(
      join(folder, `filler-${String(i).padStart(3, "0")}.md`),
      entryText({
        title: `The ${word()} ${word()} must ${word()} before the ${word()} ${i}`,
        kind: kinds[i % 5] as Entry["kind"],
        essential: i % 25 === 0,
        tags: [word(), word()],
        updated: `2026-0${1 + (i % 9)}-1${i % 10}`,
        body: `Because the ${word()} ${word()} would otherwise ${word()} the ${word()}. Checked in src/${word()}/${word()}.ts before every ${word()}.`,
      }),
    );
  }
  // What the drain does for a large folder; a hook re-indexes a small one itself.
  refreshIndex(sdb, projectId, folder, { force: true });
}

both("# Knowledge: proof");
both("");
both("## a. A synthetic project (20 entries written for the proof, 500 synthetic memories)");
both("");

// Outputs with the 20 entries.
writeFolder(0);
both("### Session start, as the agent gets it (knowledge block)");
both("");
both("```");
both(knowledgeBlock(start()));
both("```");
both("");
for (const text of START_PROMPTS) {
  both(`### Prompt: "${text}" (knowledge block)`);
  both("");
  both("```");
  both(knowledgeBlock(prompt(text)) || "(nothing from knowledge)");
  both("```");
  both("");
}

// Latency with 0, 50 and 500 entries.
const PROMPTS = [...OWN_RELEVANT.map(([p]) => p), ...OWN_UNRELATED];
interface Phase {
  label: string;
  start: Stats;
  prompt: Stats;
  startWithKnowledge: number;
  promptWithKnowledge: number;
}
function measure(label: string): Phase {
  const s: number[] = [];
  const p: number[] = [];
  let startWith = 0;
  let promptWith = 0;
  // A warm round, then RUNS timed ones.
  for (let round = 0; round <= RUNS; round++) {
    let t = performance.now();
    const context = start();
    if (round > 0) s.push(performance.now() - t);
    if (round === 1 && context.includes("<wizardingcode-knowledge>")) startWith++;
    for (const text of PROMPTS) {
      t = performance.now();
      const answer = prompt(text);
      if (round > 0) p.push(performance.now() - t);
      if (round === 1 && answer.includes("<wizardingcode-knowledge>")) promptWith++;
    }
  }
  return {
    label,
    start: stats(s),
    prompt: stats(p),
    startWithKnowledge: startWith,
    promptWithKnowledge: promptWith,
  };
}
rmSync(folder, { recursive: true, force: true });
const phases = [measure("0 entries (no folder)")];
writeFolder(30);
phases.push(measure("50 entries (20 written + 30 synthetic)"));
writeFolder(480);
phases.push(measure("500 entries (20 written + 480 synthetic)"));

both(
  `### Hook latency in process, ms, p50 / p95 (${PROMPTS.length} prompts, ${RUNS} timed rounds after a warm one; a new session each call)`,
);
both("");
both("| Folder | Session start | Prompt | Starts with knowledge | Prompts with knowledge |");
both("|---|---|---|---|---|");
for (const ph of phases) {
  both(
    `| ${ph.label} | ${fmt(ph.start)} | ${fmt(ph.prompt)} | ${ph.startWithKnowledge}/1 | ${ph.promptWithKnowledge}/${PROMPTS.length} |`,
  );
}
both("");

// Relevance on the 20 entries, then on the probe.
function floor(label: string, relevant: [string, string][], unrelated: string[], cwd: string) {
  let first = 0;
  let among = 0;
  const missed: string[] = [];
  for (const [text, title] of relevant) {
    const titles = shownTitles(prompt(text, cwd));
    if (titles[0] === title) first++;
    if (titles.includes(title)) among++;
    else missed.push(`"${text}" → ${titles.length === 0 ? "nothing" : titles.join(" | ")}`);
  }
  let injected = 0;
  const leaks: string[] = [];
  for (const text of unrelated) {
    const titles = shownTitles(prompt(text, cwd));
    if (titles.length > 0) {
      injected++;
      leaks.push(`"${text}" → ${titles.join(" | ")}`);
    }
  }
  both(
    `| ${label} | ${among}/${relevant.length} (${first} first) | ${injected}/${unrelated.length} |`,
  );
  return { missed, leaks };
}
writeFolder(0);
both("### The relevance floor, through the prompt hook");
both("");
both("| Set | Relevant prompts that bring their entry | Unrelated prompts that inject |");
both("|---|---|---|");
const own = floor("20 written entries", OWN_RELEVANT, OWN_UNRELATED, project);
const probeProject = join(synth, "probe");
const probeFolder = knowledgeDir(probeProject);
mkdirSync(probeFolder, { recursive: true });
for (const e of PROBE_ENTRIES) {
  writeFileSync(
    join(probeFolder, `${slugify(e.title)}.md`),
    entryText({ title: e.title, kind: "rule", tags: e.tags, updated: "2026-10-01", body: e.body }),
  );
}
const probe = floor(
  "knowledge-probe.ts (18 entries)",
  PROBE_RELEVANT,
  PROBE_UNRELATED,
  probeProject,
);
both("");
for (const [label, result] of [
  ["20 written entries", own],
  ["probe", probe],
] as const) {
  for (const line of result.missed) both(`- ${label}, missed: ${line}`);
  for (const line of result.leaks) both(`- ${label}, injected: ${line}`);
}
both("");
sdb.close();

// ---- b. the promotion pass on the copy -------------------------------------------------

if (COPY) {
  const { storeDir } = resolvePaths();
  const liveData = defaultDataDir({ ...process.env, WIZARDINGCODE_HOME: undefined });
  assertNotLive(join(storeDir, DB_FILE), [liveData], join(liveData, DB_FILE));
  const db: Db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
  const count = (sql: string) => db.query<{ n: number }, []>(sql).get()?.n ?? 0;
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
  const names = new Map(
    db
      .query<{ id: number; name: string }, []>("SELECT id, name FROM projects")
      .all()
      .map((r) => [r.id, r.name]),
  );
  both(`## b. The promotion pass on a copy of the real database (schema v${version})`);
  both("");
  const eligible =
    "m.status = 'active' AND m.kind IN ('decision','convention') AND m.importance >= 4";
  both(
    `Store: ${count("SELECT count(*) AS n FROM projects WHERE disabled = 0")} projects; ` +
      `${count("SELECT count(*) AS n FROM memories WHERE status = 'active'")} active memories; ` +
      `${count(`SELECT count(*) AS n FROM memories m WHERE ${eligible}`)} active decisions and conventions of importance 4 or more; ` +
      `${count("SELECT count(*) AS n FROM injections")} injection records; ` +
      `${count("SELECT count(*) AS n FROM user_memories")} rules of the author's.`,
  );
  both("");

  // Drains until the cursor stops moving with nothing proposed, then quiet drains.
  const drains: { ms: number; scanned: number; proposed: number }[] = [];
  for (let i = 0; i < 200; i++) {
    const before = getMeta(db, "knowledge.promote.cursor");
    const t = performance.now();
    const run = await proposePromotions(db, { now: Date.now(), env: process.env });
    const ms = performance.now() - t;
    drains.push({ ms, ...run });
    if (run.proposed === 0 && getMeta(db, "knowledge.promote.cursor") === before) break;
  }
  const quiet: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await proposePromotions(db, { now: Date.now(), env: process.env });
    quiet.push(performance.now() - t);
  }
  const working = drains.filter((d) => d.scanned > 0 || d.proposed > 0);
  const total = working.reduce((n, d) => n + d.ms, 0);
  both("### Drains");
  both("");
  both(
    `${working.length} drains to reach the backlog, ${(total / 1000).toFixed(1)} s in all; ` +
      `per drain ${Math.min(...working.map((d) => d.ms)).toFixed(0)}–${Math.max(...working.map((d) => d.ms)).toFixed(0)} ms ` +
      `(memories looked at per drain ${Math.min(...working.map((d) => d.scanned))}–${Math.max(...working.map((d) => d.scanned))}). ` +
      `A drain with nothing new: ${fmt(stats(quiet))} ms.`,
  );
  both("");
  full.push("| Drain | ms | looked at | proposed |");
  full.push("|---|---|---|---|");
  for (const [i, d] of working.entries())
    full.push(`| ${i + 1} | ${d.ms.toFixed(0)} | ${d.scanned} | ${d.proposed} |`);
  full.push("");

  interface Row {
    id: number;
    projectId: number;
    kind: string;
    importance: number;
    title: string;
    body: string;
    rule: number;
    slug: string;
  }
  const rows = db
    .query<Row, []>(
      `SELECT k.id AS id, k.project_id AS projectId, m.kind AS kind, m.importance AS importance,
              m.title AS title, m.body AS body, k.slug AS slug,
              EXISTS (SELECT 1 FROM user_memories u WHERE u.memory_id = m.id) AS rule
         FROM knowledge_proposals k JOIN memories m ON m.id = k.memory_id
        WHERE k.status = 'proposed' ORDER BY k.project_id, k.id`,
    )
    .all();
  const perProject = new Map<number, Row[]>();
  for (const row of rows)
    perProject.set(row.projectId, [...(perProject.get(row.projectId) ?? []), row]);
  const sizes = [...perProject.values()].map((r) => r.length).sort((a, b) => a - b);
  const tally = (pick: (r: Row) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
    return [...m]
      .sort()
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
  };
  // What the rule would take, before the project-root check: eligible and shown in 3 contexts.
  const shownEnough = count(
    `SELECT count(*) AS n FROM memories m JOIN projects p ON p.id = m.project_id AND p.disabled = 0
      WHERE ${eligible} AND (
        EXISTS (SELECT 1 FROM user_memories u WHERE u.memory_id = m.id) OR
        (SELECT count(DISTINCT session_id || ':' || context_epoch) FROM injections i WHERE i.memory_id = m.id) >= 3)`,
  );
  const projectsWithRoot = [...new Set(rows.map((r) => r.projectId))].length;
  let noRoot = 0;
  for (const id of names.keys()) if (projectRoot(db, id) === null) noRoot++;
  const withSessions = names.size - noRoot;
  both(`### Proposals: ${rows.length}`);
  both("");
  both(
    `Qualifying by the rule before the project check: ${shownEnough}. Proposed: ${rows.length}, in ${projectsWithRoot} projects ` +
      `(per project ${sizes[0] ?? 0}–${sizes.at(-1) ?? 0}, median ${sizes[Math.floor(sizes.length / 2)] ?? 0}; ` +
      `per project, sorted: ${sizes.join(", ") || "none"}). Projects with a known root (a session seen): ${withSessions}; with none (never proposed): ${noRoot}.`,
  );
  both("");
  both(
    `By kind: ${tally((r) => r.kind) || "none"}. By importance: ${tally((r) => String(r.importance)) || "none"}. By reason: ${tally((r) => (r.rule ? "author's rule" : "shown in 3+ contexts")) || "none"}.`,
  );
  both("");
  full.push("### Proposals (never commit)");
  full.push("");
  for (const [id, list] of perProject) {
    full.push(`#### ${names.get(id) ?? `#${id}`} (${list.length})`);
    full.push("");
    for (const r of list) {
      full.push(
        `- [${r.kind}, ${r.importance}${r.rule ? ", rule" : ""}] ${r.title} — ${r.body.slice(0, 200).replaceAll("\n", " ")}`,
      );
    }
    full.push("");
  }
  db.close();
}

writeFileSync(join(out, "report.md"), `${report.join("\n")}\n`);
writeFileSync(join(out, "full.md"), `${full.join("\n")}\n`);
console.log(report.join("\n"));
console.log(
  `\nreport: ${join(out, "report.md")} (anonymous); ${join(out, "full.md")} (never commit)`,
);
