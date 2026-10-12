// The measuring half of scripts/proof/semantic.sh (ADR 0017). Run by that script, against a
// temporary copy of a database, never the live one:
//
//   bun scripts/proof/semantic.ts measure <queries.tsv> <out.json> [--runs 20] [--bin <binary>]
//   bun scripts/proof/semantic.ts compare <before.json> <after.json> [--full]
//
// The data directory comes from the environment (WIZARDINGCODE_HOME), as for the binary.
// queries.tsv holds one query per line, optionally "project<TAB>query"; it is the author's
// own and stays outside the repository.
//
// measure: for each query, memory_search's ranking (rankMemories) over every project and over
// the query's project, its top 5, the full lexical list (to tell results found only by
// meaning), and history_search's top 5 when history.db exists; then latencies, p50 / p95:
// - warm: one connection, every query RUNS times (what a long-lived caller with a cache sees);
// - per call: a connection opened and closed per search, as the MCP server does;
// - process: the binary's `tool memory_search --global`, one process per call.
// Whether the model is used is whatever loadModel says (present and switched on).
//
// compare: an anonymous summary (counts and latencies, no query, title or project) on stdout;
// --full adds the queries and the titles before and after, for the author's eyes only.
// Never commit --full output, nor the JSON files: they hold titles and queries.

import { readFileSync, writeFileSync } from "node:fs";
import { loadModel, type Model } from "../../src/embed/model.ts";
import { openHistoryDb } from "../../src/history/db.ts";
import { searchHistory } from "../../src/history/search.ts";
import type { Judge } from "../../src/judge/types.ts";
import { globalSearch } from "../../src/mcp/global.ts";
import { rankMemories, type ToolContext } from "../../src/mcp/tools.ts";
import { type Db, openDb } from "../../src/store/db.ts";
import { resolvePaths } from "../../src/util/paths.ts";
import { assertNotLive } from "./live-guard.ts";

interface Query {
  project: string | null;
  query: string;
}

interface Hit {
  id: number;
  title: string;
}

interface QueryResult {
  query: string;
  project: string | null;
  globalTop: Hit[];
  globalLexical: number[];
  projectTop: Hit[] | null;
  projectLexical: number[] | null;
  historyTop: Hit[] | null;
  historyLexical: number[] | null;
}

interface Stats {
  n: number;
  p50: number;
  p95: number;
}

interface Measure {
  model: string | null;
  results: QueryResult[];
  latency: Record<string, Stats>;
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const positional = args.filter((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
const USAGE =
  "usage: bun scripts/proof/semantic.ts measure <queries.tsv> <out.json> [--runs 20] [--bin <binary>]\n" +
  "       bun scripts/proof/semantic.ts compare <before.json> <after.json> [--full]";

const TOP = 5;
const POOL = 50;

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { n: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)) };
}

function readQueries(path: string): Query[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab === -1
        ? { project: null, query: line }
        : { project: line.slice(0, tab).trim() || null, query: line.slice(tab + 1).trim() };
    });
}

function projectId(db: Db, name: string): number | null {
  const row = db
    .query<{ id: number }, [string]>(
      "SELECT id FROM projects WHERE lower(name) = lower(?) AND disabled = 0 LIMIT 1",
    )
    .get(name);
  return row?.id ?? null;
}

const context = (db: Db, projectIdOrNull: number | null, model: Model | null): ToolContext => ({
  db,
  judge: null as unknown as Judge,
  projectId: projectIdOrNull,
  root: "",
  branch: null,
  now: Date.now(),
  model,
});

function ranked(db: Db, model: Model | null, project: number | null, query: string) {
  const rows = rankMemories(context(db, project, model), { query });
  const lexical = rankMemories(context(db, project, null), { query });
  return {
    top: rows.slice(0, TOP).map((row) => ({ id: row.id, title: row.title })),
    lexical: lexical.slice(0, POOL).map((row) => row.id),
  };
}

function time(fn: () => void): number {
  const start = Bun.nanoseconds();
  fn();
  return (Bun.nanoseconds() - start) / 1e6;
}

function measure(queriesPath: string, outPath: string): void {
  const runs = Number(option("runs", "20"));
  const bin = option("bin", "");
  const { dataDir, storeDir } = resolvePaths();
  const home = process.env.HOME ?? "";
  assertNotLive(
    storeDir,
    [`${home}/.wizardingcode`, `${home}/.shibaox`],
    `${home}/.wizardingcode/mem/wizardingcode-mem.db`,
  );
  const queries = readQueries(queriesPath);
  const model = loadModel({ dataDir });
  const db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  const hdb = openHistoryDb(storeDir, { create: false, busyTimeoutMs: 2000 });
  const results: QueryResult[] = [];
  const samples: Record<string, number[]> = {};
  const add = (key: string, ms: number) => {
    const list = samples[key] ?? [];
    list.push(ms);
    samples[key] = list;
  };
  try {
    for (const q of queries) {
      const pid = q.project === null ? null : projectId(db, q.project);
      const global = ranked(db, model, null, q.query);
      const inProject = pid === null ? null : ranked(db, model, pid, q.query);
      let historyTop: Hit[] | null = null;
      let historyLexical: number[] | null = null;
      if (hdb !== null) {
        const hits = searchHistory(hdb, { query: q.query, limit: TOP, model });
        historyTop = hits.map((hit) => ({ id: hit.id, title: hit.prompt.slice(0, 120) }));
        historyLexical = searchHistory(hdb, { query: q.query, limit: 25, model: null }).map(
          (hit) => hit.id,
        );
      }
      results.push({
        query: q.query,
        project: q.project,
        globalTop: global.top,
        globalLexical: global.lexical,
        projectTop: inProject?.top ?? null,
        projectLexical: inProject?.lexical ?? null,
        historyTop,
        historyLexical,
      });
    }

    // Warm: one connection; a first round fills the caches and is not counted.
    const projects = queries.map((q) => (q.project === null ? null : projectId(db, q.project)));
    for (let round = 0; round <= runs; round++) {
      queries.forEach((q, i) => {
        const g = time(() => globalSearch(db, Date.now(), { query: q.query }, model));
        const pid = projects[i];
        const p =
          pid === null || pid === undefined
            ? null
            : time(() => rankMemories(context(db, pid, model), { query: q.query }).slice(0, 10));
        const h = hdb === null ? null : time(() => searchHistory(hdb, { query: q.query, model }));
        if (round === 0) return;
        add("warm global", g);
        if (p !== null) add("warm project", p);
        if (h !== null) add("warm history", h);
      });
    }
  } finally {
    hdb?.close();
    db.close();
  }

  // Per call: a connection per search, as the MCP server opens one per tool call.
  for (let round = 0; round < Math.max(3, Math.floor(runs / 4)); round++) {
    for (const q of queries) {
      add(
        "per-call global",
        time(() => {
          const conn = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
          try {
            globalSearch(conn, Date.now(), { query: q.query }, loadModel({ dataDir }));
          } finally {
            conn.close();
          }
        }),
      );
    }
  }

  // Process: the binary, one process per call (model opened, connection, search, exit).
  if (bin !== "") {
    for (let round = 0; round < Math.max(2, Math.floor(runs / 10)); round++) {
      for (const q of queries) {
        const start = Bun.nanoseconds();
        const proc = Bun.spawnSync([bin, "tool", "memory_search", "--global"], {
          stdin: new TextEncoder().encode(JSON.stringify({ query: q.query })),
          stdout: "pipe",
          stderr: "pipe",
        });
        const ms = (Bun.nanoseconds() - start) / 1e6;
        if (proc.exitCode !== 0) throw new Error(`tool failed: ${proc.stderr.toString()}`);
        add("process global", ms);
      }
    }
  }

  const latency = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, stats(v)]));
  const out: Measure = { model: model?.id ?? null, results, latency };
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`model: ${out.model ?? "none"}`);
  for (const [k, s] of Object.entries(latency)) {
    console.log(`${k}: p50 ${s.p50} ms, p95 ${s.p95} ms (n ${s.n})`);
  }
}

function compare(beforePath: string, afterPath: string): void {
  const full = args.includes("--full");
  const before = JSON.parse(readFileSync(beforePath, "utf8")) as Measure;
  const after = JSON.parse(readFileSync(afterPath, "utf8")) as Measure;
  const lines: string[] = [];
  lines.push(`Model before: ${before.model ?? "none"}; after: ${after.model ?? "none"}`, "");
  lines.push("| Latency | before p50 / p95 (ms) | after p50 / p95 (ms) |", "|---|---|---|");
  const keys = new Set([...Object.keys(before.latency), ...Object.keys(after.latency)]);
  const show = (s: Stats | undefined) => (s ? `${s.p50} / ${s.p95}` : "—");
  for (const k of keys)
    lines.push(`| ${k} | ${show(before.latency[k])} | ${show(after.latency[k])} |`);
  lines.push("");

  type Scope = "global" | "project" | "history";
  const pick = (r: QueryResult, scope: Scope): [Hit[] | null, number[] | null] =>
    scope === "global"
      ? [r.globalTop, r.globalLexical]
      : scope === "project"
        ? [r.projectTop, r.projectLexical]
        : [r.historyTop, r.historyLexical];
  for (const scope of ["global", "project", "history"] as Scope[]) {
    const rows: string[] = [];
    let emptyBefore = 0;
    let emptyAfter = 0;
    let meaningOnly = 0;
    let kept = 0;
    let shown = 0;
    after.results.forEach((a, i) => {
      const b = before.results[i];
      if (b === undefined) return;
      const [bt] = pick(b, scope);
      const [at, lex] = pick(a, scope);
      if (bt === null || at === null) return;
      const bIds = new Set(bt.map((h) => h.id));
      const lexical = new Set(lex ?? []);
      const added = at.filter((h) => !lexical.has(h.id)).length;
      const same = at.filter((h) => bIds.has(h.id)).length;
      if (bt.length === 0) emptyBefore++;
      if (at.length === 0) emptyAfter++;
      meaningOnly += added;
      kept += same;
      shown += at.length;
      rows.push(
        `| Q${i + 1} | ${bt.length} | ${at.length} | ${same} | ${added} |` +
          (full ? ` ${a.project ?? ""} · ${a.query} |` : ""),
      );
      if (full) {
        const list = (hits: Hit[], lexicalIds: Set<number> | null) =>
          hits
            .map(
              (h, k) =>
                `${k + 1}. ${lexicalIds !== null && !lexicalIds.has(h.id) ? "(meaning) " : ""}${h.title.replace(/\s+/g, " ")}`,
            )
            .join("<br>");
        rows.push(`| | before | ${list(bt, null)} | after | ${list(at, lexical)} |`);
      }
    });
    if (rows.length === 0) continue;
    lines.push(
      `### ${scope}: ${rows.filter((r) => r.startsWith("| Q")).length} queries; empty top 5 before ${emptyBefore}, after ${emptyAfter}; top-5 results kept ${kept}/${shown}; found only by meaning ${meaningOnly}`,
      "",
      `| Query | top 5 before | top 5 after | kept from before | only by meaning |${full ? " query |" : ""}`,
      `|---|---|---|---|---|${full ? "---|" : ""}`,
      ...rows,
      "",
    );
  }
  console.log(lines.join("\n"));
}

const [mode, first, second] = positional;
if (mode === "measure" && first && second) measure(first, second);
else if (mode === "compare" && first && second) compare(first, second);
else {
  console.error(USAGE);
  process.exit(1);
}
