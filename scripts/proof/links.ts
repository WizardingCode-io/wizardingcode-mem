// The measuring half of scripts/proof/links.sh (ADR 0018). Run by that script, against a
// temporary copy of a database, never the live one:
//
//   bun scripts/proof/links.ts <out dir> [--runs 10] [--prompts 10] [--hand-links 3] [--seed-rules 3] [--unbounded]
//
// The data directory comes from the environment (WIZARDINGCODE_HOME), as for the binary. The
// first open migrates the copy to the latest schema.
//
// 1. Times the background steps a drain runs after distilling: suggestLinks twice (the first run
//    on a store that never had it, then a steady one; remotes, and the manifests read from the
//    project roots the copy records, which are only read) and proposeRules with the heuristic
//    judge (TypeSafe off) and no model, as on a store without one: drain after drain until its
//    cursor has reached the backlog, then quiet drains with nothing new. --seed-rules n first
//    writes n synthetic rules the author "said always" into the copy (a short typed prompt and
//    the memory it gave), to measure recall; they are counted apart. --unbounded runs the first
//    proposal drain with no time budget.
// 2. Counts the suggestions by kind and signal and the proposals by reason.
// 3. Measures sessionBrief and retrieveForPrompt, p50 / p95, for the projects in a suggestion
//    (or the most recently active ones), over each project's own recent prompts: before, after
//    confirming every suggestion, after linking each of them by hand to the --hand-links projects
//    with the most important memories (a stress: real data behind the linked share), and after
//    also accepting every proposal.
//
// Writes <out dir>/report.md (anonymous: counts and latencies) and <out dir>/full.md (project
// names, signals, rule text: for the author's eyes only; never commit it).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { heuristicJudge } from "../../src/judge/heuristic.ts";
import { acceptProposal, proposeRules } from "../../src/links/rules.ts";
import { suggestLinks } from "../../src/links/suggest.ts";
import { sessionBrief } from "../../src/retrieve/brief.ts";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";
import { decideLink, linkProjects, parseSignals } from "../../src/store/links.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { touchSession } from "../../src/store/sessions.ts";
import { defaultDataDir, resolvePaths } from "../../src/util/paths.ts";
import { searchTerms } from "../../src/util/words.ts";
import { assertNotLive } from "./live-guard.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const out = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (out === undefined) {
  console.error(
    "usage: bun scripts/proof/links.ts <out dir> [--runs 10] [--prompts 10] [--hand-links 3] [--seed-rules 3] [--unbounded]",
  );
  process.exit(1);
}
const RUNS = Number(option("runs", "10"));
const PROMPTS = Number(option("prompts", "10"));
const HAND_LINKS = Number(option("hand-links", "3"));
const UNBOUNDED = args.includes("--unbounded");
const SEED_RULES = Number(option("seed-rules", "3"));
const MIN_PROJECTS = 10;

const { dataDir, storeDir } = resolvePaths();
const liveData = defaultDataDir({ ...process.env, WIZARDINGCODE_HOME: undefined });
assertNotLive(join(storeDir, DB_FILE), [liveData], join(liveData, DB_FILE));

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
const timed = <T>(fn: () => T): [T, number] => {
  const t = performance.now();
  const value = fn();
  return [value, performance.now() - t];
};

const db: Db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
const report: string[] = [];
const full: string[] = [];
const both = (line: string) => {
  report.push(line);
  full.push(line);
};
const names = new Map(
  db
    .query<{ id: number; name: string }, []>("SELECT id, name FROM projects")
    .all()
    .map((r) => [r.id, r.name]),
);
const name = (id: number) => names.get(id) ?? `#${id}`;

both(`# Linked projects and your rules: proof on a copy (schema v${version})`);
both("");
const count = (sql: string) => db.query<{ n: number }, []>(sql).get()?.n ?? 0;
both(
  `Store: ${count("SELECT count(*) AS n FROM projects WHERE disabled = 0")} projects, ` +
    `${count("SELECT count(DISTINCT project_id) AS n FROM project_aliases WHERE alias LIKE 'path:%'")} with a recorded root, ` +
    `${count("SELECT count(DISTINCT project_id) AS n FROM project_aliases WHERE alias LIKE 'remote:%'")} with a git remote; ` +
    `${count("SELECT count(*) AS n FROM memories WHERE status = 'active'")} active memories ` +
    `(${count("SELECT count(*) AS n FROM memories WHERE status = 'active' AND kind IN ('convention','decision')")} conventions and decisions).`,
);
both("");

// ---- 1. the background steps ----------------------------------------------------------

both("## Background steps (after the drain)");
both("");
both("| Step | First run | Steady run |");
both("|---|---|---|");
const [s1, ms1] = timed(() => suggestLinks(db, { now: Date.now() }));
const [s2, ms2] = timed(() => suggestLinks(db, { now: Date.now() }));
both(
  `| suggestLinks | ${ms1.toFixed(0)} ms, ${s1.suggested} suggested | ${ms2.toFixed(0)} ms, ${s2.suggested} refreshed |`,
);
// Synthetic rules said always, written now in the most recently active project: what the
// narrowed signal must still find. Never the author's text.
const SEEDS: { prompt: string; title: string; body: string; kind: "convention" | "decision" }[] = [
  {
    prompt: "a partir de agora corre sempre os testes com o bun fixado antes de cada commit",
    title: "Run the tests with the pinned bun before each commit",
    body: "The global bun differs from the pinned one.",
    kind: "convention",
  },
  {
    prompt: "always write the ADRs in English, in every project",
    title: "ADRs are written in English",
    body: "Decision records in English, whatever language the talk is in.",
    kind: "decision",
  },
  {
    prompt: "em todos os projetos usa imports com extensão .ts explícita",
    title: "Imports levam extensão .ts explícita",
    body: "Sem extensão o runtime não resolve o módulo.",
    kind: "convention",
  },
];
const seeded: number[] = [];
{
  const recent = db
    .query<{ id: number }, []>(
      `SELECT p.id AS id FROM projects p JOIN turns t ON t.project_id = p.id
        WHERE p.disabled = 0 GROUP BY p.id ORDER BY MAX(t.started_at) DESC LIMIT 1`,
    )
    .get();
  for (const [i, seed] of SEEDS.slice(0, SEED_RULES).entries()) {
    if (!recent) break;
    const now = Date.now();
    const session = touchSession(db, {
      agent: "claude-code",
      agentSessionId: `proof-seed-${i}-${now}`,
      projectId: recent.id,
      cwd: "/",
      branch: null,
      now,
    }).id;
    const turn = db
      .query<{ id: number }, [number, number, string, number, number]>(
        `INSERT INTO turns (session_id, project_id, seq, state, prompt, final_text, started_at, ended_at)
         VALUES (?, ?, 1, 'done', ?, 'ok', ?, ?) RETURNING id`,
      )
      .get(session, recent.id, seed.prompt, now, now)?.id as number;
    seeded.push(
      insertMemory(db, {
        projectId: recent.id,
        kind: seed.kind,
        title: seed.title,
        body: seed.body as Redacted,
        terms: searchTerms(seed.title, seed.body, []),
        importance: 4,
        branch: null,
        commit: null,
        origin: "distilled",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: turn,
        files: [],
        now,
      }),
    );
  }
}

// Drains until the cursor has reached the backlog, then quiet drains with nothing new.
const drains: { ms: number; scanned: number; proposed: number }[] = [];
for (let i = 0; i < 50; i++) {
  const t = performance.now();
  const run = await proposeRules(db, {
    judge: heuristicJudge,
    now: Date.now(),
    model: null,
    ...(UNBOUNDED && i === 0 ? { maxMs: 3_600_000 } : {}),
  });
  drains.push({ ms: performance.now() - t, ...run });
  if (run.scanned === 0) break;
}
const quiet: number[] = [];
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  await proposeRules(db, { judge: heuristicJudge, now: Date.now(), model: null });
  quiet.push(performance.now() - t);
}
const working = drains.filter((d) => d.scanned > 0);
both(
  `| proposeRules (heuristic judge, no model) | ${working.length} drains to reach the backlog: ${working.map((d) => `${d.ms.toFixed(0)} ms / ${d.scanned} looked at / ${d.proposed} proposed`).join("; ") || "none"} | nothing new: ${fmt(stats(quiet))} |`,
);
both("");

// ---- 2. what was suggested and proposed -----------------------------------------------

interface LinkRow {
  id: number;
  f: number;
  t: number;
  kind: string;
  signals: string;
}
const links = db
  .query<LinkRow, []>(
    "SELECT id, from_project AS f, to_project AS t, kind, signals FROM project_links WHERE status = 'suggested' ORDER BY id",
  )
  .all();
const signalOf = (s: string) =>
  s.startsWith("same owner") || s.startsWith("shared name")
    ? "same owner + shared name stem"
    : s.startsWith("one workspace")
      ? "one workspace"
      : s.includes(" depends on ")
        ? "declared dependency"
        : "other";
const bySignal = new Map<string, number>();
for (const link of links) {
  const kinds = new Set(parseSignals(link.signals).map(signalOf));
  const key = `${link.kind}: ${[...kinds].sort().join(", ")}`;
  bySignal.set(key, (bySignal.get(key) ?? 0) + 1);
}
const involved = new Set(links.flatMap((l) => [l.f, l.t]));
both(`## Suggestions: ${links.length} links over ${involved.size} projects`);
both("");
both("| Kind: signal | Links |");
both("|---|---|");
for (const [key, n] of [...bySignal].sort()) both(`| ${key} | ${n} |`);
both("");
full.push("### Suggested links (never commit)");
full.push("");
for (const link of links) {
  const arrow = link.kind === "uses" ? "uses" : "same product as";
  full.push(
    `- #${link.id} ${name(link.f)} ${arrow} ${name(link.t)} — ${parseSignals(link.signals).join("; ")}`,
  );
}
full.push("");

interface ProposalRow {
  id: number;
  memory_ids: string;
  title: string;
  body: string;
  reason: string;
}
const proposals = db
  .query<ProposalRow, []>(
    "SELECT id, memory_ids, title, body, reason FROM rule_proposals WHERE status = 'proposed' ORDER BY id",
  )
  .all();
const byReason = new Map<string, number>();
const sizes: number[] = [];
const spread: number[] = [];
const projectOf = db.query<{ p: number; kind: string; prompt: string | null }, [number]>(
  `SELECT m.project_id AS p, m.kind AS kind, t.prompt AS prompt
     FROM memories m LEFT JOIN turns t ON t.id = m.source_turn_id WHERE m.id = ?`,
);
const promptLengths: number[] = [];
full.push("### Proposed rules (never commit)");
full.push("");
let seedsFound = 0;
for (const proposal of proposals) {
  const ids = JSON.parse(proposal.memory_ids) as number[];
  const seed = ids.some((id) => seeded.includes(id));
  if (seed) seedsFound++;
  const reason = seed ? `${proposal.reason} (seeded)` : proposal.reason;
  byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  const members = ids.map((id) => projectOf.get(id)).filter((m) => m !== null);
  const projects = [...new Set(members.map((m) => m.p))];
  sizes.push(ids.length);
  if (!seed && proposal.reason === "said-always" && members[0]?.prompt) {
    promptLengths.push(members[0].prompt.length);
  }
  spread.push(projects.length);
  full.push(
    `- #${proposal.id} [${reason}; ${members[0]?.kind ?? "?"}; ${ids.length} memories in ${projects.map(name).join(", ")}] ${proposal.title} — ${proposal.body.slice(0, 240).replaceAll("\n", " ")}`,
  );
}
full.push("");
both(`## Proposals: ${proposals.length}`);
both("");
both(`Seeded rules said always: ${seedsFound} of ${seeded.length} proposed.`);
both("");
both("| Reason | Proposals |");
both("|---|---|");
for (const [reason, n] of [...byReason].sort()) both(`| ${reason} | ${n} |`);
if (sizes.length > 0) {
  both("");
  both(
    `Memories per proposal: ${Math.min(...sizes)}–${Math.max(...sizes)} (median ${[...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)]}); projects per proposal: ${Math.min(...spread)}–${Math.max(...spread)}.`,
  );
}
if (promptLengths.length > 0) {
  const sorted = [...promptLengths].sort((a, b) => a - b);
  both(
    `Said-always prompts (not seeded): ${sorted.length}, length ${sorted[0]}–${sorted.at(-1)} characters (median ${sorted[Math.floor(sorted.length / 2)]}); ${sorted.filter((n) => n > 1000).length} longer than 1,000.`,
  );
}
both("");

// ---- 3. brief and prompt latency --------------------------------------------------------

const measured = [...involved];
if (measured.length < MIN_PROJECTS) {
  for (const row of db
    .query<{ id: number }, []>(
      `SELECT project_id AS id FROM turns WHERE prompt IS NOT NULL
        GROUP BY project_id ORDER BY MAX(started_at) DESC LIMIT 40`,
    )
    .all()) {
    if (measured.length >= MIN_PROJECTS) break;
    if (!measured.includes(row.id)) measured.push(row.id);
  }
}
const promptsOf = db.query<{ prompt: string }, [number, number]>(
  `SELECT prompt FROM turns WHERE project_id = ? AND prompt IS NOT NULL AND length(prompt) > 12
    ORDER BY started_at DESC, id DESC LIMIT ?`,
);
const workload = measured.map((projectId) => ({
  projectId,
  prompts: promptsOf.all(projectId, PROMPTS).map((r) => r.prompt),
}));
const promptCount = workload.reduce((n, w) => n + w.prompts.length, 0);

interface Phase {
  label: string;
  brief: Stats;
  prompt: Stats;
  briefChars: number;
  briefLinked: number;
  briefYou: number;
  promptLinked: number;
  promptYou: number;
  prompted: number;
}
function measure(label: string): Phase {
  const now = Date.now();
  const brief: number[] = [];
  const prompt: number[] = [];
  let briefChars = 0;
  let briefLinked = 0;
  let briefYou = 0;
  let promptLinked = 0;
  let promptYou = 0;
  let prompted = 0;
  // A first round warms the page cache; then RUNS rounds are timed.
  for (let round = 0; round <= RUNS; round++) {
    for (const { projectId, prompts } of workload) {
      const [b, bms] = timed(() => sessionBrief(db, { projectId, branch: null, now }));
      if (round > 0) brief.push(bms);
      if (round === 1) {
        briefChars += b.text.length;
        briefLinked += b.notes.filter((n) => n.origin?.startsWith("from ")).length;
        briefYou += b.notes.filter((n) => n.origin === "you").length;
      }
      for (const text of prompts) {
        const [notes, pms] = timed(() =>
          retrieveForPrompt(db, {
            projectId,
            sessionId: -1,
            epoch: 0,
            prompt: text,
            branch: null,
            now,
          }),
        );
        if (round > 0) prompt.push(pms);
        if (round === 1) {
          if (notes.length > 0) prompted++;
          promptLinked += notes.filter((n) => n.origin?.startsWith("from ")).length;
          promptYou += notes.filter((n) => n.origin === "you").length;
        }
      }
    }
  }
  return {
    label,
    brief: stats(brief),
    prompt: stats(prompt),
    briefChars: Math.round(briefChars / Math.max(1, workload.length)),
    briefLinked,
    briefYou,
    promptLinked,
    promptYou,
    prompted,
  };
}

const phases: Phase[] = [measure("before (no confirmed links, no rules)")];
const confirmAt = Date.now();
for (const link of links) decideLink(db, link.id, "confirmed", confirmAt);
phases.push(measure(`every suggestion confirmed (${links.length})`));
let handLinked = 0;
if (HAND_LINKS > 0) {
  const biggest = db
    .query<{ id: number }, []>(
      `SELECT project_id AS id FROM memories WHERE status = 'active' AND stale = 0 AND importance >= 4
        GROUP BY project_id ORDER BY count(*) DESC`,
    )
    .all()
    .map((row) => row.id);
  for (const { projectId } of workload) {
    for (const other of biggest.filter((id) => id !== projectId).slice(0, HAND_LINKS)) {
      linkProjects(db, projectId, other, "product", Date.now());
      handLinked++;
    }
  }
  phases.push(
    measure(`and ${handLinked} links by hand to the ${HAND_LINKS} biggest projects (stress)`),
  );
}
let accepted = 0;
for (const proposal of proposals) {
  if ("userMemoryId" in acceptProposal(db, proposal.id, Date.now(), null)) accepted++;
}
phases.push(measure(`and every proposal accepted (${accepted})`));

both(
  `## Brief and prompt, in process, ms (${workload.length} projects, ${promptCount} of their own recent prompts, ${RUNS} timed rounds after a warm one)`,
);
both("");
both(
  "| Phase | sessionBrief p50 / p95 | retrieveForPrompt p50 / p95 | Brief chars (mean) | Brief notes from linked / you | Prompts with notes | Prompt notes from linked / you |",
);
both("|---|---|---|---|---|---|---|");
for (const p of phases) {
  both(
    `| ${p.label} | ${fmt(p.brief)} | ${fmt(p.prompt)} | ${p.briefChars} | ${p.briefLinked} / ${p.briefYou} | ${p.prompted}/${promptCount} | ${p.promptLinked} / ${p.promptYou} |`,
  );
}
both("");
db.close();

writeFileSync(join(out, "report.md"), `${report.join("\n")}\n`);
writeFileSync(join(out, "full.md"), `${full.join("\n")}\n`);
console.log(report.join("\n"));
console.log(
  `\nreport: ${join(out, "report.md")} (anonymous); ${join(out, "full.md")} (never commit)`,
);
console.log(`data dir: ${dataDir}`);
