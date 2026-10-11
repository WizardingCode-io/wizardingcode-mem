/**
 * The semantic-recall spike (ADR 0014). Dev-only; never shipped, never run by tests.
 *
 *   bun scripts/embed/spike.ts <pack> <spike-probe binary> <scratch dir>
 *
 * 1. Latency: fresh probe processes against 5,000 and 65,000 random int8 vectors, and with
 *    `--noop` (the process alone).
 * 2. Recall and noise on tests/golden/retrieval.json, lexical retrieval set up as in
 *    tests/golden/retrieval.test.ts, swept over cosine thresholds; then tests/golden/semantic.json
 *    at the threshold chosen on the first set (not re-tuned).
 * 3. Writes <scratch dir>/spike-report.md and prints it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { MemoryKind } from "../../src/core/types.ts";
import { cosine, embed, quantize } from "../../src/embed/embed.ts";
import { openPack } from "../../src/embed/pack.ts";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { openDb } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { clip } from "../../src/util/text.ts";
import { searchTerms } from "../../src/util/words.ts";
import golden from "../../tests/golden/retrieval.json" with { type: "json" };
import semantic from "../../tests/golden/semantic.json" with { type: "json" };

const [packPath, probePath, scratch] = process.argv.slice(2);
if (packPath === undefined || probePath === undefined || scratch === undefined) {
  console.error("usage: bun scripts/embed/spike.ts <pack> <spike-probe> <scratch dir>");
  process.exit(1);
}

const DIMS = 256;
const RUNS = 61;
const TOP = 5;
/** The gate's recall (ADR 0014): 22/24 on retrieval.json, the same share on semantic.json. */
const GATE_RECALL = 22 / 24;
const MAX_PROMPT_CHARS = 4000;
const PROMPT =
  "why does the background worker lose the lease when the database is busy during a long migration on startup again";
const out: string[] = [];
const say = (line = "") => out.push(line);
const f3 = (n: number) => n.toFixed(3);
const f1 = (n: number) => n.toFixed(1);

// ---------------------------------------------------------------- 1. latency

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)]!;
}

/** Deterministic standard normals (mulberry32 + Box-Muller): the same vectors every run. */
function normals(seed: number) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

function writeVectors(path: string, count: number): void {
  const next = normals(count);
  const buffer = new ArrayBuffer(count * (4 + DIMS));
  const view = new DataView(buffer);
  const bytes = new Int8Array(buffer);
  for (let r = 0; r < count; r++) {
    const v = new Float32Array(DIMS);
    let sum = 0;
    for (let d = 0; d < DIMS; d++) {
      v[d] = next();
      sum += v[d]! * v[d]!;
    }
    const norm = Math.sqrt(sum);
    for (let d = 0; d < DIMS; d++) v[d] = v[d]! / norm;
    const { scale, q } = quantize(v);
    view.setFloat32(r * (4 + DIMS), scale, true);
    bytes.set(q, r * (4 + DIMS) + 4);
  }
  writeFileSync(path, new Uint8Array(buffer));
}

interface Timing {
  wall: number[];
  open: number[];
  embed: number[];
  scan: number[];
}

function runProbe(args: string[]): Timing {
  const timing: Timing = { wall: [], open: [], embed: [], scan: [] };
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    const proc = Bun.spawnSync([probePath!, ...args], { stdout: "pipe", stderr: "pipe" });
    const wall = performance.now() - start;
    if (proc.exitCode !== 0) throw new Error(`probe failed: ${proc.stderr.toString()}`);
    if (i === 0) continue; // warm-up, unmeasured
    timing.wall.push(wall);
    const line = proc.stdout.toString().trim();
    if (line !== "") {
      const [open, emb, scan] = line.split(" ").map(Number);
      timing.open.push(open!);
      timing.embed.push(emb!);
      timing.scan.push(scan!);
    }
  }
  return timing;
}

const pq = (values: number[]) =>
  values.length === 0 ? "—" : `${f1(percentile(values, 50))} / ${f1(percentile(values, 95))}`;

say("# Semantic recall spike");
say();
say(`Pack: ${packPath} (${Bun.file(packPath).size} bytes)`);
say(`Probe: ${probePath}`);
say();
say("## 1. Latency");
say();
say(
  `${RUNS} fresh processes each, the first unmeasured; the prompt has twenty words. Wall time is measured by the parent around the whole process; open, embed and scan are measured inside it. p50 / p95 in ms.`,
);
say();
say("| Vectors | Process wall | open | embed | scan | `--noop` wall | probe p95 − noop p95 |");
say("|---|---|---|---|---|---|---|");
const latency: Record<number, { probeP95: number; noopP95: number }> = {};
for (const count of [5000, 65_000]) {
  const vectors = join(scratch, `vectors-${count}.bin`);
  writeVectors(vectors, count);
  const noop = runProbe(["--noop"]);
  const probe = runProbe([packPath, vectors, PROMPT]);
  const probeP95 = percentile(probe.wall, 95);
  const noopP95 = percentile(noop.wall, 95);
  latency[count] = { probeP95, noopP95 };
  say(
    `| ${count.toLocaleString("en-US")} | ${pq(probe.wall)} | ${pq(probe.open)} | ${pq(probe.embed)} | ${pq(probe.scan)} | ${pq(noop.wall)} | ${f1(probeP95 - noopP95)} |`,
  );
}
say();

// ---------------------------------------------------------------- 2. recall and noise

const opened = openPack(packPath);
if (!opened.ok) throw new Error(`pack: ${opened.reason}`);
const pack = opened.pack;
const vec = (text: string) => embed(pack, clip(text, MAX_PROMPT_CHARS));

const memories = golden.memories.map((m) => ({ key: m.key, vector: vec(`${m.title}\n${m.body}`) }));
for (const m of memories) if (m.vector === null) throw new Error(`no vector for memory ${m.key}`);

/** Memories by cosine to the prompt, best first. */
function ranked(prompt: string): { key: string; score: number }[] {
  const q = vec(prompt);
  if (q === null) return [];
  return memories
    .map((m) => ({ key: m.key, score: cosine(q, m.vector!) }))
    .sort((a, b) => b.score - a.score);
}

// Lexical retrieval, set up exactly as tests/golden/retrieval.test.ts does.
const NOW = Date.UTC(2026, 9, 5);
const base = mkdtempSync(join(scratch, "spike-db-"));
const projectDir = join(base, "project");
mkdirSync(projectDir);
const db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 2000 });
const projectId = resolveProject(db, projectDir, NOW).id;
const ids = new Map<string, number>();
for (const memory of golden.memories) {
  ids.set(
    memory.key,
    insertMemory(db, {
      projectId,
      kind: memory.kind as MemoryKind,
      title: memory.title,
      body: memory.body as Redacted,
      terms: searchTerms(memory.title, memory.body, memory.files),
      importance: 3,
      branch: null,
      commit: null,
      origin: "manual",
      judge: "heuristic",
      judgeVersion: "1",
      sourceTurnId: null,
      files: memory.files.map((path) => ({ path, role: "changed" as const })),
      now: NOW,
    }),
  );
}
let session = 10_000;
const lexical = (prompt: string) =>
  retrieveForPrompt(db, {
    projectId,
    sessionId: session++,
    epoch: 0,
    prompt,
    branch: null,
    now: NOW,
  }).map((note) => note.id);

interface Relevant {
  prompt: string;
  expect: string[];
  lexicalFound: boolean;
  /** For each expected memory: its cosine rank (1-based) and score. */
  hits: { key: string; rank: number; score: number }[];
  top: { key: string; score: number }[];
}
interface Unrelated {
  prompt: string;
  lexicalInjects: boolean;
  best: { key: string; score: number } | null;
  /** The two best memories by cosine, best first (for the relative rule). */
  top: { key: string; score: number }[];
}

function evaluate(relevantItems: { prompt: string; expect: string[] }[], unrelatedItems: string[]) {
  const relevant: Relevant[] = relevantItems.map((item) => {
    const got = lexical(item.prompt);
    const order = ranked(item.prompt);
    return {
      prompt: item.prompt,
      expect: item.expect,
      lexicalFound: item.expect.every((key) => got.includes(ids.get(key)!)),
      hits: item.expect.map((key) => {
        const index = order.findIndex((o) => o.key === key);
        return { key, rank: index + 1, score: index < 0 ? Number.NaN : order[index]!.score };
      }),
      top: order.slice(0, 3),
    };
  });
  const unrelated: Unrelated[] = unrelatedItems.map((prompt) => {
    const order = ranked(prompt);
    return {
      prompt,
      lexicalInjects: lexical(prompt).length > 0,
      best: order[0] ?? null,
      top: order.slice(0, 2),
    };
  });
  return { relevant, unrelated };
}

const semanticHit = (r: Relevant, t: number) =>
  r.hits.every((h) => h.rank >= 1 && h.rank <= TOP && h.score >= t);

function at(set: ReturnType<typeof evaluate>, t: number) {
  const recalled = set.relevant.filter((r) => r.lexicalFound || semanticHit(r, t));
  const recovered = set.relevant.filter((r) => !r.lexicalFound && semanticHit(r, t));
  const noisy = set.unrelated.filter(
    (u) => u.lexicalInjects || (u.best !== null && u.best.score >= t),
  );
  const lowestRecovered = Math.min(...recovered.flatMap((r) => r.hits.map((h) => h.score)));
  const highestUnrelated = Math.max(...set.unrelated.map((u) => u.best?.score ?? -1));
  return { recalled, recovered, noisy, lowestRecovered, highestUnrelated };
}

const thresholds = Array.from({ length: 61 }, (_, i) => Math.round((0.3 + i * 0.01) * 100) / 100);

function report(name: string, set: ReturnType<typeof evaluate>, chosen: number | null): number {
  const n = set.relevant.length;
  const u = set.unrelated.length;
  const lexicalRecall = set.relevant.filter((r) => r.lexicalFound).length;
  const lexicalNoise = set.unrelated.filter((x) => x.lexicalInjects).length;
  say(`### ${name}`);
  say();
  say(
    `Lexical alone: recall ${lexicalRecall}/${n}, false injections ${lexicalNoise}/${u}. Semantic hit = every expected memory in the cosine top ${TOP} with score ≥ t.`,
  );
  say();
  say("| t | recall (lexical ∪ semantic) | recovered by semantic | false injections |");
  say("|---|---|---|---|");
  let best = thresholds[thresholds.length - 1]!;
  let bestRecall = -1;
  for (const t of thresholds) {
    const r = at(set, t);
    say(
      `| ${t.toFixed(2)} | ${r.recalled.length}/${n} | ${r.recovered.length} | ${r.noisy.length}/${u} |`,
    );
    if (r.noisy.length === 0 && r.recalled.length >= bestRecall) {
      bestRecall = r.recalled.length;
      best = t;
    }
  }
  say();
  const t = chosen ?? best;
  const r = at(set, t);
  if (chosen === null)
    say(`**Best t: ${t.toFixed(2)}** (highest recall with 0 false injections; ties → highest t).`);
  else say(`**At t = ${t.toFixed(2)}** (chosen on the original set, not re-tuned).`);
  say();
  say(
    `- Recall: ${r.recalled.length}/${n} (lexical ${lexicalRecall}, recovered by semantic ${r.recovered.length})`,
  );
  say(
    `- False injections: ${r.noisy.length}/${u}${r.noisy.length ? ` — ${r.noisy.map((x) => `"${x.prompt}"`).join("; ")}` : ""}`,
  );
  say(
    `- Margin: lowest recovered score ${r.recovered.length ? f3(r.lowestRecovered) : "—"} − highest unrelated score ${f3(r.highestUnrelated)} = ${r.recovered.length ? f3(r.lowestRecovered - r.highestUnrelated) : "—"}`,
  );
  const silent = thresholds.find((x) => at(set, x).noisy.length === 0);
  say(`- Lowest t with 0 false injections: ${silent === undefined ? "none" : silent.toFixed(2)}`);
  // What a threshold would have to separate: the semantic-only candidates (expected memory in the
  // top 5), best first, against the highest unrelated score.
  const candidates = set.relevant
    .filter((x) => !x.lexicalFound && x.hits.every((h) => h.rank >= 1 && h.rank <= TOP))
    .map((x) => Math.min(...x.hits.map((h) => h.score)))
    .sort((a, b) => b - a);
  const needed = Math.max(0, Math.ceil(GATE_RECALL * n) - lexicalRecall);
  if (needed > 0) {
    const kth = candidates[needed - 1];
    say(
      `- To reach ${Math.ceil(GATE_RECALL * n)}/${n} semantic must recover ${needed}: candidate number ${needed} (best first) scores ${kth === undefined ? "— (too few in the top 5)" : f3(kth)}, the highest unrelated ${f3(r.highestUnrelated)}${kth === undefined ? "" : ` (difference ${f3(kth - r.highestUnrelated)})`}`,
    );
  }
  say();
  say(
    "Relevant prompts lexical misses: the expected memory's cosine score and rank, and the cosine top 3.",
  );
  say();
  say("| Prompt | Expected | Rank | Score | Recovered at t | Cosine top 3 |");
  say("|---|---|---|---|---|---|");
  for (const x of set.relevant.filter((x) => !x.lexicalFound)) {
    for (const h of x.hits)
      say(
        `| ${x.prompt} | ${h.key} | ${h.rank} | ${f3(h.score)} | ${semanticHit(x, t) ? "yes" : "no"} | ${x.top.map((o) => `${o.key} ${f3(o.score)}`).join(", ")} |`,
      );
  }
  say();
  say("The five highest unrelated scores:");
  say();
  say("| Unrelated prompt | Best memory | Score | Lexical injects |");
  say("|---|---|---|---|");
  for (const x of [...set.unrelated]
    .sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1))
    .slice(0, 5))
    say(
      `| ${x.prompt} | ${x.best?.key ?? "—"} | ${f3(x.best?.score ?? Number.NaN)} | ${x.lexicalInjects ? "yes" : "no"} |`,
    );
  say();
  return t;
}

say("## 2. Recall and noise");
say();
say(
  `Memory text: title + "\\n" + body. Prompts clipped to ${MAX_PROMPT_CHARS} characters, as buildQuery does.`,
);
say();
const original = evaluate(golden.relevant, golden.unrelated);
const chosen = report("retrieval.json (24 relevant, 23 unrelated)", original, null);
const extended = evaluate(semantic.paraphrases, semantic.unrelated);
report(
  `semantic.json (${semantic.paraphrases.length} paraphrases, ${semantic.unrelated.length} unrelated)`,
  extended,
  chosen,
);

// ---------------------------------------------------------------- 3. a relative rule

/**
 * The relative rule (ADR 0014, fixed before its numbers were seen): only the top memory can be
 * added, and only when s1 ≥ f and s1 − s2 ≥ g (s2 = 0 with one memory).
 */
const gap = (top: { score: number }[]) => (top[0]?.score ?? 0) - (top[1]?.score ?? 0);
const fires = (top: { score: number }[], f: number, g: number) =>
  top.length > 0 && top[0]!.score >= f && gap(top) >= g;
const relativeHit = (r: Relevant, f: number, g: number) =>
  r.top.length > 0 && r.expect.every((key) => key === r.top[0]!.key) && fires(r.top, f, g);

function relativeAt(set: ReturnType<typeof evaluate>, f: number, g: number) {
  const recalled = set.relevant.filter((r) => r.lexicalFound || relativeHit(r, f, g));
  const recovered = set.relevant.filter((r) => !r.lexicalFound && relativeHit(r, f, g));
  const noisy = set.unrelated.filter((u) => u.lexicalInjects || fires(u.top, f, g));
  return { recalled, recovered, noisy };
}

const grid = (from: number, to: number) =>
  Array.from(
    { length: Math.round((to - from) * 100) + 1 },
    (_, i) => Math.round(from * 100 + i) / 100,
  );
const fs = grid(0.3, 0.6);
const gs = grid(0.05, 0.3);

function relativeDetail(set: ReturnType<typeof evaluate>, f: number, g: number) {
  say("Relevant prompts lexical misses:");
  say();
  say("| Prompt | Expected | Top memory | s1 | s2 | Gap | Fires (top = expected) |");
  say("|---|---|---|---|---|---|---|");
  for (const r of set.relevant.filter((x) => !x.lexicalFound))
    say(
      `| ${r.prompt} | ${r.expect.join(", ")} | ${r.top[0]?.key ?? "—"} | ${f3(r.top[0]?.score ?? 0)} | ${f3(r.top[1]?.score ?? 0)} | ${f3(gap(r.top))} | ${fires(r.top, f, g) ? "yes" : "no"} (${relativeHit(r, f, g) ? "recovered" : r.top[0]?.key === r.expect[0] ? "right memory" : "wrong memory"}) |`,
    );
  say();
  say("The five unrelated prompts with the largest gap:");
  say();
  say("| Unrelated prompt | Top memory | s1 | s2 | Gap | Fires |");
  say("|---|---|---|---|---|---|");
  for (const u of [...set.unrelated].sort((a, b) => gap(b.top) - gap(a.top)).slice(0, 5))
    say(
      `| ${u.prompt} | ${u.top[0]?.key ?? "—"} | ${f3(u.top[0]?.score ?? 0)} | ${f3(u.top[1]?.score ?? 0)} | ${f3(gap(u.top))} | ${fires(u.top, f, g) ? "yes" : "no"} |`,
    );
  say();
}

say("## 3. A relative rule");
say();
say(
  `Only the top memory can be added, when s1 ≥ f and s1 − s2 ≥ g. Grid on retrieval.json only: f ${fs[0]!.toFixed(2)}–${fs[fs.length - 1]!.toFixed(2)}, g ${gs[0]!.toFixed(2)}–${gs[gs.length - 1]!.toFixed(2)}, by 0.01 (${fs.length * gs.length} pairs). Among pairs with 0 false injections: highest recall; ties → largest g, then largest f.`,
);
say();
let pick: { f: number; g: number; recall: number } | null = null;
const zeroFalse: { f: number; g: number; recall: number }[] = [];
for (const g of gs)
  for (const f of fs) {
    const r = relativeAt(original, f, g);
    if (r.noisy.length > 0) continue;
    const cell = { f, g, recall: r.recalled.length };
    zeroFalse.push(cell);
    if (
      pick === null ||
      cell.recall > pick.recall ||
      (cell.recall === pick.recall && (g > pick.g || (g === pick.g && f > pick.f)))
    )
      pick = cell;
  }
say("Per g: the best recall among f with 0 false injections, and the f values that reach it.");
say();
say("| g | Pairs with 0 false | Best recall at 0 false | f reaching it |");
say("|---|---|---|---|");
const ranges = (values: number[]) => {
  const parts: string[] = [];
  let start = values[0];
  for (let i = 1; i <= values.length; i++) {
    if (i === values.length || Math.round((values[i]! - values[i - 1]!) * 100) !== 1) {
      const end = values[i - 1]!;
      parts.push(start === end ? start!.toFixed(2) : `${start!.toFixed(2)}–${end.toFixed(2)}`);
      start = values[i];
    }
  }
  return parts.join(", ");
};
for (const g of gs) {
  const cells = zeroFalse.filter((c) => c.g === g);
  if (cells.length === 0) {
    say(`| ${g.toFixed(2)} | 0 | — | — |`);
    continue;
  }
  const best = Math.max(...cells.map((c) => c.recall));
  say(
    `| ${g.toFixed(2)} | ${cells.length} | ${best}/24 | ${ranges(cells.filter((c) => c.recall === best).map((c) => c.f))} |`,
  );
}
say();
if (pick === null) {
  say("**No pair has 0 false injections.**");
} else {
  const p = pick;
  const region = zeroFalse.filter((c) => c.recall === p.recall);
  const regionGs = [...new Set(region.map((c) => c.g))];
  say(
    `**Chosen: f = ${p.f.toFixed(2)}, g = ${p.g.toFixed(2)}**, recall ${p.recall}/${original.relevant.length}, false injections 0/${original.unrelated.length}.`,
  );
  say();
  say(
    `Winning region (0 false, recall ${p.recall}/24): ${region.length} of ${fs.length * gs.length} pairs; g ${ranges(regionGs)}; f ${ranges([...new Set(region.map((c) => c.f))].sort((a, b) => a - b))}.`,
  );
  say();
  relativeDetail(original, p.f, p.g);
  const held = relativeAt(extended, p.f, p.g);
  say(`### Held out: semantic.json at f = ${p.f.toFixed(2)}, g = ${p.g.toFixed(2)} (not re-tuned)`);
  say();
  say(
    `Recall ${held.recalled.length}/${extended.relevant.length} (lexical ${extended.relevant.filter((r) => r.lexicalFound).length}, recovered ${held.recovered.length}); false injections ${held.noisy.length}/${extended.unrelated.length}${held.noisy.length ? ` — ${held.noisy.map((x) => `"${x.prompt}"`).join("; ")}` : ""}.`,
  );
  say();
  relativeDetail(extended, p.f, p.g);
}

db.close();
rmSync(base, { recursive: true, force: true });

// ---------------------------------------------------------------- the gate inputs

const big = latency[65_000]!;
say("## Gate inputs");
say();
say(`- Chosen t: ${chosen.toFixed(2)}`);
const g = at(original, chosen);
say(`- recall@5 at t: ${g.recalled.length}/${original.relevant.length}`);
say(`- false injections at t: ${g.noisy.length}/${original.unrelated.length}`);
say(
  `- probe p95 − noop p95 at 65,000 vectors: ${f1(big.probeP95)} − ${f1(big.noopP95)} = ${f1(big.probeP95 - big.noopP95)} ms (add the prompt hook p95 from tests/perf/budgets.test.ts)`,
);

if (pick !== null) {
  const held = relativeAt(extended, pick.f, pick.g);
  const r = relativeAt(original, pick.f, pick.g);
  say(
    `- Relative rule (f = ${pick.f.toFixed(2)}, g = ${pick.g.toFixed(2)}): recall ${r.recalled.length}/24, false ${r.noisy.length}/23; held out recall ${held.recalled.length}/20, false ${held.noisy.length}/20`,
  );
}

const text = out.join("\n");
writeFileSync(join(scratch, "spike-report.md"), `${text}\n`);
console.log(text);
