// The measuring half of scripts/proof/quality.sh (ADR 0023). Run by that script on a copy of
// the database, never the live one:
//
//   bun scripts/proof/quality.ts <work dir> sample  [--size 200] [--skipped 100] [--seed 7]
//                                                    [--projects a,b] [--exclude-projects c,d]
//   bun scripts/proof/quality.ts <work dir> measure --a <labels> [--b <labels>] [--s <labels>]
//
// The copy is <work dir>/home/mem/wizardingcode-mem.db, where quality.sh puts it; the first
// open migrates it. Every data or store directory the environment names is live, and refused.
// `measure` needs a TypeSafe key. The proof sends no text to any model but TypeSafe: the
// labels come from a labeller the author chooses (ADR 0023, D-4).
//
// sample:  draws sample A (calibration) and sample B (check), disjoint, of active distilled
//          memories judged by TypeSafe with version 1, and sample S of turns version 1
//          skipped, each turn with its candidate sentences as the segmenter cuts them, and
//          writes sample-a.json, sample-b.json, sample-s.json, the turns of the author's
//          20-label check (check-a.json, …) and the brief (brief.md).
// measure: for every labelled turn, runs the drain's steps up to the draft (`prepareTurn`,
//          `draftTurn`; nothing is consolidated or written) with TypeSafe version 2 and with
//          the heuristic, report signals off and on. Version 1 is the memory stored. TypeSafe's
//          verdicts are kept in verdicts.json and reused while the request is the same, so a
//          threshold change re-runs the policy without asking again. Writes report.md
//          (anonymous) and full.md (titles: never commit it).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Redacted } from "../../src/core/redact.ts";
import { stripHost } from "../../src/distill/noise.ts";
import {
  draftTurn,
  type PreparedTurn,
  prepareTurn,
  storedDetail,
  toldInSession,
  unfilteredTexts,
} from "../../src/distill/pipeline.ts";
import { TITLE_MAX_CHARS } from "../../src/distill/policy.ts";
import { candidates } from "../../src/distill/segment.ts";
import { heuristicJudge, heuristicJudgeV1 } from "../../src/judge/heuristic.ts";
import { readTypeSafeKey } from "../../src/judge/key.ts";
import { distillQuestions, distillState } from "../../src/judge/questions.ts";
import type { DistillVerdict, Judge } from "../../src/judge/types.ts";
import { TypeSafeJudge } from "../../src/judge/typesafe.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";
import { resolvePaths } from "../../src/util/paths.ts";
import { clip } from "../../src/util/text.ts";
import { assertNotLive } from "./live-guard.ts";
import { generator, sample } from "./random.ts";

const args = process.argv.slice(2);
const [outArg, mode] = args;
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const list = (name: string) =>
  option(name, "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
if (outArg === undefined || (mode !== "sample" && mode !== "measure")) {
  console.error(
    "usage: bun scripts/proof/quality.ts <work dir> sample [--size n] [--skipped n] [--seed n] [--projects a,b] [--exclude-projects c,d] | measure --a <labels> [--b <labels>] [--s <labels>]",
  );
  process.exit(1);
}
const out = resolve(outArg);
const copyDir = join(out, "home", "mem");

// ---- guards ---------------------------------------------------------------------------

const REPO = resolve(import.meta.dir, "../..");
const env = process.env;
// Live: what the environment resolves to (WIZARDINGCODE_HOME, WIZARDINGCODE_MEM_DATA_DIR and
// WIZARDINGCODE_MEM_STORE_DIR honoured), the defaults without them, each of them as named,
// and what the shell wrapper found (LIVE_DATA, LIVE_STORE).
const resolved = resolvePaths(env);
const defaults = resolvePaths({
  ...env,
  WIZARDINGCODE_HOME: undefined,
  WIZARDINGCODE_MEM_DATA_DIR: undefined,
  WIZARDINGCODE_MEM_STORE_DIR: undefined,
});
const liveDirs = [
  resolved.dataDir,
  resolved.storeDir,
  defaults.dataDir,
  defaults.storeDir,
  env.WIZARDINGCODE_HOME,
  env.WIZARDINGCODE_MEM_DATA_DIR,
  env.WIZARDINGCODE_MEM_STORE_DIR,
  env.LIVE_DATA,
  env.LIVE_STORE,
].filter((dir): dir is string => dir !== undefined && dir !== "");
const liveDb = join(env.LIVE_STORE || resolved.storeDir, DB_FILE);

/** Refuses a path inside the repository or a live data or store directory, by real path. */
function refuseInside(path: string, what: string): void {
  try {
    assertNotLive(path, [REPO, ...liveDirs], liveDb);
  } catch {
    console.error(`refusing: ${what} (${path}) is inside the repository or the live data`);
    process.exit(1);
  }
}

refuseInside(out, "the work dir");
if (!existsSync(join(copyDir, DB_FILE))) {
  console.error(`no copy at ${join(copyDir, DB_FILE)}: run scripts/proof/quality.sh`);
  process.exit(1);
}
refuseInside(join(copyDir, DB_FILE), "the copy");
const db: Db = openDb({ dataDir: copyDir, busyTimeoutMs: 5000 });

// ---- samples --------------------------------------------------------------------------

interface Row {
  turn: number;
  memory: number | null;
  project: string;
  sessionId: number;
  endedAt: number | null;
  kind: string | null;
  importance: number | null;
  title: string | null;
  body: string | null;
  prompt: string;
  final: string;
}

/** One turn of a sample, as the labeller and `measure` see it. */
interface Item {
  turn: number;
  /** The memory version 1 stored from the turn; null in sample S. */
  memory: number | null;
  project: string;
  kind: string | null;
  importance: number | null;
  title: string | null;
  body: string | null;
  prompt: string;
  final: string;
  /** The turn's sentences as the segmenter cuts them, before `stripHost` and `dropNoise`; labels name their ids. */
  candidates: { id: number; said_by: "user" | "assistant"; text: string }[];
}

const COLUMNS = `t.id AS turn, p.name AS project, t.session_id AS sessionId, t.ended_at AS endedAt,
       t.prompt, COALESCE(t.final_text, '') AS final`;
const HAS_TEXT = "(t.prompt <> '' OR COALESCE(t.final_text, '') <> '')";
const MEMORY_ROWS = `SELECT ${COLUMNS}, m.id AS memory, m.kind, m.importance, m.title, m.body
  FROM memories m JOIN turns t ON t.id = m.source_turn_id JOIN projects p ON p.id = t.project_id
 WHERE m.origin = 'distilled' AND m.status = 'active' AND m.judge = 'typesafe'
   AND m.judge_version = '1' AND ${HAS_TEXT}`;
// A turn the drain skipped because the agent saved a memory itself left no mark on the
// turn; its memory_save did: a memory with origin 'manual' and judge 'agent', created while
// the turn ran. Such turns are left out (in any project: the agent may name another).
const SKIPPED_ROWS = `SELECT ${COLUMNS}, NULL AS memory, NULL AS kind, NULL AS importance,
       NULL AS title, NULL AS body
  FROM turns t JOIN projects p ON p.id = t.project_id
 WHERE t.state = 'skipped' AND ${HAS_TEXT}
   AND NOT EXISTS (SELECT 1 FROM memories s WHERE s.origin = 'manual' AND s.judge = 'agent'
                     AND s.created_at BETWEEN t.started_at AND COALESCE(t.ended_at, t.started_at))`;

/** The projects clause and its parameters, from --projects and --exclude-projects. */
function projectFilter(): { sql: string; params: string[] } {
  const only = list("projects");
  const except = list("exclude-projects");
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
  return {
    sql:
      (only.length > 0 ? ` AND p.name IN (${marks(only.length)})` : "") +
      (except.length > 0 ? ` AND p.name NOT IN (${marks(except.length)})` : ""),
    params: [...only, ...except],
  };
}

function prepared(row: Row): PreparedTurn {
  return prepareTurn(
    db,
    {
      id: row.turn,
      sessionId: row.sessionId,
      endedAt: row.endedAt,
      prompt: row.prompt as Redacted,
      finalText: row.final as Redacted,
    },
    storedDetail(db, row.turn),
  );
}

/**
 * The turn's texts as the pipeline reads them before its filter: the notes the session had
 * been shown removed (as `prepareTurn` does), the host's blocks still in.
 */
function unfiltered(row: Row): { prompt: string; final: string } {
  const told = toldInSession(db, row.turn, row.sessionId, row.endedAt);
  const texts = unfilteredTexts(row.prompt, row.final, told);
  return { prompt: texts.prompt, final: texts.finalText };
}

function itemOf(row: Row): Item {
  const { sessionId: _session, endedAt: _ended, ...rest } = row;
  const texts = unfiltered(row);
  return {
    ...rest,
    candidates: candidates(texts.prompt, texts.final).map((candidate) => ({
      id: candidate.idx,
      said_by: candidate.source === "prompt" ? "user" : "assistant",
      text: candidate.text,
    })),
  };
}

function drawSamples(): void {
  const size = Number(option("size", "200"));
  const skipped = Number(option("skipped", "100"));
  const seed = Number(option("seed", "7"));
  const filter = projectFilter();
  const memories = db
    .query<Row, string[]>(`${MEMORY_ROWS}${filter.sql} ORDER BY m.id`)
    .all(...filter.params);
  const turns = db
    .query<Row, string[]>(`${SKIPPED_ROWS}${filter.sql} ORDER BY t.id`)
    .all(...filter.params);
  const next = generator(seed);
  // One draw of 2 × size, split in two: A and B are disjoint by construction.
  const drawn = sample(memories, size * 2, next);
  const samples = {
    a: drawn.slice(0, size).map(itemOf),
    b: drawn.slice(size).map(itemOf),
    s: sample(turns, skipped, next).map(itemOf),
  };
  // The author's check: 20 turns of each sample, each from its own generator.
  const checkSeeds = { a: seed + 1, b: seed + 2, s: seed + 3 };
  for (const [name, items] of Object.entries(samples) as ["a" | "b" | "s", Item[]][]) {
    writeFileSync(join(out, `sample-${name}.json`), `${JSON.stringify(items, null, 2)}\n`);
    const checked = sample(items, 20, generator(checkSeeds[name])).map((item) => item.turn);
    writeFileSync(join(out, `check-${name}.json`), `${JSON.stringify(checked)}\n`);
  }
  copyFileSync(join(import.meta.dir, "quality-brief.md"), join(out, "brief.md"));
  console.log(
    `eligible: ${memories.length} memories, ${turns.length} skipped turns; sample A ${samples.a.length}, B ${samples.b.length}, S ${samples.s.length} (seed ${seed}; check seeds ${seed + 1}, ${seed + 2}, ${seed + 3}); written to ${out}`,
  );
}

// ---- measure --------------------------------------------------------------------------

const LABELS = ["knowledge", "mixed", "record", "fragment"] as const;
type LabelName = (typeof LABELS)[number];
interface Label {
  turn: number;
  label: LabelName;
  why?: string;
  /** The ids of the turn's candidates that hold knowledge on their own. */
  quotes?: number[];
}
type SampleName = "a" | "b" | "s";
const isKnowledge = (label: LabelName) => label === "knowledge" || label === "mixed";

/** The sentence a title was cut from (titles are clipped at TITLE_MAX_CHARS), or the title. */
const fullSentence = (title: string, sentences: string[]) =>
  sentences.find((sentence) => clip(sentence, TITLE_MAX_CHARS, "…") === title) ?? title;
const factsOf = (body: string) =>
  body.split("\n").filter((line) => line !== "" && !line.startsWith("Context: "));

/** What one version made of one turn. */
interface Reading {
  outcome: "stored" | "not stored" | "emptied" | "failed";
  title: string | null;
  /** The title's sentence before the clip, compared with the quoted candidates. */
  fullTitle: string | null;
  facts: string[];
  importance: number | null;
}
const NONE = { title: null, fullTitle: null, facts: [], importance: null };

async function readingOf(judge: Judge, turn: PreparedTurn): Promise<Reading> {
  if (turn.candidates.length === 0) return { outcome: "emptied", ...NONE };
  let result: Awaited<ReturnType<typeof draftTurn>>;
  try {
    result = await draftTurn(judge, turn);
  } catch {
    return { outcome: "failed", ...NONE };
  }
  if (result.verdict?.source !== judge.name) return { outcome: "failed", ...NONE };
  if (result.draft === null) return { outcome: "not stored", ...NONE };
  return {
    outcome: "stored",
    title: result.draft.title,
    fullTitle: fullSentence(
      result.draft.title,
      turn.candidates.map((candidate) => candidate.text),
    ),
    facts: factsOf(result.draft.body),
    importance: result.draft.importance,
  };
}

interface Outcome {
  sample: SampleName;
  item: Item;
  label: Label;
  /** The texts of the quoted candidates. */
  quoted: string[];
  v1: Reading;
  v2: Reading;
  h1: Reading;
  h2: Reading;
  dropped: { text: string; pattern: string }[];
  /** `stripHost` removed text from the turn; and, with it, a quoted candidate. */
  hostRemoved: boolean;
  quoteRemoved: boolean;
}
type Version = "v1" | "v2" | "h1" | "h2";
const VERSIONS: Version[] = ["v1", "v2", "h1", "h2"];

const titleIsKnowledge = (o: Outcome, r: Reading) =>
  r.outcome === "stored" && o.quoted.includes(r.fullTitle ?? "");
const lost = (o: Outcome, r: Reading) =>
  isKnowledge(o.label.label) &&
  !(
    r.outcome === "stored" &&
    [r.fullTitle ?? "", ...r.facts].some((sentence) => o.quoted.includes(sentence))
  );

/** Reads and checks a labels file against its sample. Unknown or unquoted labels stop the run. */
function readLabels(name: SampleName, file: string): { item: Item; label: Label }[] {
  refuseInside(file, "the labels");
  const items = JSON.parse(readFileSync(join(out, `sample-${name}.json`), "utf8")) as Item[];
  const byTurn = new Map(items.map((item) => [item.turn, item]));
  const labels = JSON.parse(readFileSync(file, "utf8")) as Label[];
  const kept: { item: Item; label: Label }[] = [];
  const seen = new Set<number>();
  const duplicates: number[] = [];
  const notInSample: number[] = [];
  for (const label of labels) {
    if (!LABELS.includes(label.label)) {
      console.error(
        `turn ${label.turn}: label "${label.label}", expected one of ${LABELS.join(", ")}`,
      );
      process.exit(1);
    }
    const item = byTurn.get(label.turn);
    const ids = new Set(item?.candidates.map((candidate) => candidate.id) ?? []);
    const quotes = (label.quotes ?? []).filter((id) => ids.has(id));
    if (item !== undefined && isKnowledge(label.label) && quotes.length === 0) {
      console.error(
        `turn ${label.turn}: a ${label.label} label needs the id of at least one of its candidates`,
      );
      process.exit(1);
    }
    if (seen.has(label.turn)) duplicates.push(label.turn);
    else if (item === undefined) notInSample.push(label.turn);
    else kept.push({ item, label: { ...label, quotes } });
    seen.add(label.turn);
  }
  const unlabelled = items.filter((item) => !seen.has(item.turn)).map((item) => item.turn);
  for (const [what, turns] of [
    ["duplicate labels (first kept)", duplicates],
    ["labels of turns not in the sample", notInSample],
    ["turns with no label", unlabelled],
  ] as const) {
    if (turns.length > 0)
      console.log(`sample ${name}: ${turns.length} ${what}: ${turns.join(", ")}`);
  }
  return kept;
}

/** TypeSafe's verdicts by request: a threshold change re-runs the policy on them. */
interface Cached {
  verdict: DistillVerdict;
  inputTokens: number;
}

async function measure(): Promise<void> {
  const files = (["a", "b", "s"] as const)
    .map((name) => [name, option(name, "")] as const)
    .filter(([, file]) => file !== "");
  if (!files.some(([name]) => name === "a" || name === "b")) {
    console.error("measure needs --a <labels> or --b <labels>");
    process.exit(1);
  }
  for (const [, file] of files) {
    if (!existsSync(resolve(file))) {
      console.error(`no labels file at ${file}`);
      process.exit(1);
    }
  }
  const key = readTypeSafeKey(env, env.LIVE_DATA || resolved.dataDir);
  if (key === null) {
    console.error("measure needs a TypeSafe key: TYPESAFE_API_KEY, or the live env file");
    process.exit(1);
  }
  const cacheFile = join(out, "verdicts.json");
  const cache = new Map<string, Cached>(
    existsSync(cacheFile) ? Object.entries(JSON.parse(readFileSync(cacheFile, "utf8"))) : [],
  );
  const usage = { requests: 0, inputTokens: 0, reused: 0 };
  let lastTokens = 0;
  // The live drain's judge: its own timeout and retries, so a request that would fail live
  // fails here. An endpoint in the environment stands in for the service (smoke runs only).
  const service = new TypeSafeJudge({
    apiKey: key,
    ...(env.WIZARDINGCODE_MEM_TYPESAFE_URL ? { endpoint: env.WIZARDINGCODE_MEM_TYPESAFE_URL } : {}),
    onUsage: (tokens) => {
      lastTokens = tokens;
      usage.requests++;
      usage.inputTokens += tokens;
    },
  });
  const tokensByTurn = new Map<number, number>();
  let current = 0;
  const typesafe: Judge = {
    name: "typesafe",
    version: service.version,
    versions: service.versions,
    distill: async (input) => {
      const request = JSON.stringify({ s: distillState(input), q: distillQuestions(input) });
      const id = createHash("sha256").update(request).digest("hex");
      const hit = cache.get(id);
      if (hit !== undefined) {
        usage.reused++;
        tokensByTurn.set(current, hit.inputTokens);
        return hit.verdict;
      }
      const verdict = await service.distill(input);
      cache.set(id, { verdict, inputTokens: lastTokens });
      tokensByTurn.set(current, lastTokens);
      return verdict;
    },
    consolidate: (input) => service.consolidate(input),
  };

  const outcomes: Outcome[] = [];
  const started = performance.now();
  try {
    for (const [name, file] of files) {
      for (const { item, label } of readLabels(name, resolve(file))) {
        const row = db
          .query<{ sessionId: number; endedAt: number | null }, [number]>(
            "SELECT session_id AS sessionId, ended_at AS endedAt FROM turns WHERE id = ?",
          )
          .get(item.turn);
        if (row === null) continue;
        current = item.turn;
        const turn = prepared({ ...item, ...row });
        const quoted = item.candidates
          .filter((candidate) => label.quotes?.includes(candidate.id))
          .map((candidate) => candidate.text);
        const v2 = await readingOf(typesafe, turn);
        const texts = unfiltered({ ...item, ...row });
        // What the filter saw: every sentence left once the host's blocks were removed.
        const afterHost = new Set([
          ...turn.candidates.map((candidate) => candidate.text as string),
          ...turn.dropped.map((d) => d.text),
        ]);
        const hostRemoved =
          stripHost(texts.prompt) !== texts.prompt || stripHost(texts.final) !== texts.final;
        outcomes.push({
          sample: name,
          item,
          label,
          quoted,
          v1:
            item.title === null
              ? { outcome: "not stored", ...NONE }
              : {
                  outcome: "stored",
                  title: item.title,
                  fullTitle: fullSentence(
                    item.title,
                    item.candidates.map((candidate) => candidate.text),
                  ),
                  facts: factsOf(item.body ?? ""),
                  importance: item.importance,
                },
          v2,
          h1: await readingOf(heuristicJudgeV1, turn),
          h2: await readingOf(heuristicJudge, turn),
          dropped: turn.dropped,
          hostRemoved,
          quoteRemoved: hostRemoved && quoted.some((text) => !afterHost.has(text)),
        });
      }
    }
  } finally {
    writeFileSync(cacheFile, `${JSON.stringify(Object.fromEntries(cache))}\n`);
  }
  const seconds = (performance.now() - started) / 1000;
  writeFileSync(
    join(out, "report.md"),
    `${render(outcomes, seconds, usage, tokensByTurn, false)}\n`,
  );
  writeFileSync(join(out, "full.md"), `${render(outcomes, seconds, usage, tokensByTurn, true)}\n`);
  console.log(render(outcomes, seconds, usage, tokensByTurn, false));
  console.log(`full report with titles: ${join(out, "full.md")}`);
}

const pct = (n: number, of: number) =>
  of === 0 ? "n/a" : `${n} of ${of} (${Math.round((100 * n) / of)}%)`;
const cell = (text: string | null) => (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function render(
  outcomes: Outcome[],
  seconds: number,
  usage: { requests: number; inputTokens: number; reused: number },
  tokensByTurn: Map<number, number>,
  full: boolean,
): string {
  const counted = outcomes.filter((o) => o.v2.outcome !== "failed");
  const failed = outcomes.length - counted.length;
  // The checked sample: B when it was labelled, A while calibrating.
  const checked: SampleName = counted.some((o) => o.sample === "b") ? "b" : "a";
  const inChecked = counted.filter((o) => o.sample === checked);
  const withS = counted.filter((o) => o.sample === checked || o.sample === "s");
  const stored = (set: Outcome[], v: Version) => set.filter((o) => o[v].outcome === "stored");
  const lostIn = (v: Version) => inChecked.filter((o) => lost(o, o[v]));
  const records = (v: Version) => stored(withS, v).filter((o) => !isKnowledge(o.label.label));
  const row = (name: string, f: (v: Version) => string) =>
    `| ${name} | ${VERSIONS.map(f).join(" | ")} |`;
  const byLabel = (s: SampleName) =>
    LABELS.map(
      (l) => `${l} ${outcomes.filter((o) => o.sample === s && o.label.label === l).length}`,
    ).join(", ");
  const judged = inChecked.map((o) => tokensByTurn.get(o.item.turn)).filter((t) => t !== undefined);
  const meanTokens = judged.length === 0 ? 0 : judged.reduce((a, b) => a + b, 0) / judged.length;
  const drops = new Map<string, number>();
  for (const o of counted)
    for (const d of o.dropped) drops.set(d.pattern, (drops.get(d.pattern) ?? 0) + 1);
  const quotedDrops = counted.flatMap((o) =>
    o.dropped.filter((d) => o.quoted.includes(d.text)).map((d) => ({ o, d })),
  );
  const host = counted.filter((o) => o.hostRemoved);
  const v2LostV1Kept = lostIn("v2").filter((o) => !lost(o, o.v1));
  const bothLost = lostIn("v2").filter((o) => lost(o, o.v1));
  const C = checked.toUpperCase();
  const lines = [
    `# Memory quality proof · ${new Date().toISOString()}`,
    "",
    ...(["a", "b", "s"] as const)
      .filter((s) => outcomes.some((o) => o.sample === s))
      .map((s) => `Sample ${s.toUpperCase()}: ${byLabel(s)}.`),
    `Checked sample: ${C}. TypeSafe failed on ${failed} turns, left out of every share.`,
    `Cost and time (D-9): ${usage.requests} TypeSafe requests, ${usage.inputTokens} input tokens, ${usage.reused} verdicts reused; ${seconds.toFixed(0)} s.`,
    "",
    "| Metric | TypeSafe v1 (stored) | TypeSafe v2 | Heuristic v1 | Heuristic v2 |",
    "|---|---|---|---|---|",
    row(`Title is knowledge, of memories stored from ${C} (v2 ≥ 60%)`, (v) =>
      pct(
        stored(inChecked, v).filter((o) => titleIsKnowledge(o, o[v])).length,
        stored(inChecked, v).length,
      ),
    ),
    row(`Lost, of knowledge and mixed turns of ${C}`, (v) =>
      pct(lostIn(v).length, inChecked.filter((o) => isKnowledge(o.label.label)).length),
    ),
    row(`Stored from record or fragment, of memories stored from ${C} and S (v2 ≤ 15%)`, (v) =>
      pct(records(v).length, stored(withS, v).length),
    ),
    row("Memories stored", (v) => `${stored(counted, v).length}`),
    row("Title-only", (v) =>
      pct(
        stored(counted, v).filter((o) => o[v].facts.length === 0).length,
        stored(counted, v).length,
      ),
    ),
    row("Importance 1/2/3/4/5", (v) =>
      [1, 2, 3, 4, 5]
        .map((i) => stored(counted, v).filter((o) => o[v].importance === i).length)
        .join("/"),
    ),
    "",
    `TypeSafe v2 lost turns that v1 kept (target 0): ${v2LostV1Kept.length}; lost by both: ${bothLost.length}.`,
    `Heuristic, lost (D-6, v2 ≤ v1): v2 ${lostIn("h2").length}, v1 ${lostIn("h1").length}. Stored from record or fragment, ${C} and S (D-8, v2 < v1): v2 ${records("h2").length}, v1 ${records("h1").length}.`,
    `Mean input tokens per judged turn of ${C}, version 2: ${meanTokens.toFixed(0)} (the D-5 ratio is measured on the golden turns).`,
    `Turns the filter emptied: ${counted.filter((o) => o.v2.outcome === "emptied").length}. Sentences dropped per pattern: ${[...drops].map(([p, n]) => `${p} ${n}`).join(", ") || "none"}; quoted as knowledge: ${quotedDrops.length}.`,
    `Turns where stripHost removed text: ${host.length}; with a quoted candidate among the removed text: ${counted.filter((o) => o.quoteRemoved).length}.`,
  ];
  if (!full) return lines.join("\n");
  const shown = (o: Outcome, v: Version) =>
    `${o[v].outcome}${lost(o, o[v]) ? ", LOST" : ""}${titleIsKnowledge(o, o[v]) ? ", knowledge title" : ""}: ${cell(o[v].title)}`;
  return [
    ...lines,
    "",
    "## Every turn (full: never commit)",
    "",
    "| sample | turn | label | TypeSafe v1 | TypeSafe v2 | Heuristic v1 | Heuristic v2 |",
    "|---|---|---|---|---|---|---|",
    ...outcomes.map(
      (o) =>
        `| ${o.sample} | ${o.item.turn} | ${o.label.label} | ${VERSIONS.map((v) => shown(o, v)).join(" | ")} |`,
    ),
    "",
    "## Lost by v2, kept by v1",
    "",
    ...v2LostV1Kept.map(
      (o) => `- ${o.item.turn}: ${cell(o.v1.title)} · quoted: ${cell(o.quoted.join(" / "))}`,
    ),
    "",
    "## Stored by v2 from record or fragment turns",
    "",
    ...records("v2").map(
      (o) => `- ${o.sample} ${o.item.turn} (${o.label.label}): ${cell(o.v2.title)}`,
    ),
    "",
    "## Quoted candidates the filter dropped",
    "",
    ...quotedDrops.map(({ o, d }) => `- ${o.item.turn} (${d.pattern}): ${cell(d.text)}`),
    "",
    "## Turns where stripHost removed text",
    "",
    ...host.map(
      (o) =>
        `- ${o.item.turn} (${o.label.label})${o.quoteRemoved ? ": a quoted candidate is gone" : ""}`,
    ),
  ].join("\n");
}

try {
  if (mode === "sample") drawSamples();
  else await measure();
} finally {
  db.close();
}
