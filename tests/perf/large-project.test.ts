import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProject } from "../../src/core/project.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { MEMORY_KINDS } from "../../src/core/types.ts";
import { retrieveForPrompt } from "../../src/retrieve/prompt.ts";
import { type Db, openDb, withWrite } from "../../src/store/db.ts";
import { insertMemory } from "../../src/store/memories.ts";
import { searchTerms } from "../../src/util/words.ts";

// One project grown large, as real ones do: 30,000 memories of real length, in a store
// that holds as many again from other projects, with words spread the way words are (a
// few in almost every memory, most in very few). A real prompt is a paragraph full of the
// common ones. Ranking every memory that shares any word with it took the prompt hook
// past 200 ms on such a project (on the author's store, 28,700 memories in one project);
// what a prompt is given must not grow with how common its words are.

const PROJECT_MEMORIES = 30_000;
const OTHER_MEMORIES = 30_000;
const VOCABULARY = 8000;
const PROMPTS = 40;
const WINDOWS = process.platform === "win32";
const CI = Boolean(process.env.CI);
// In process: the prompt hook's budget is 80 ms, and starting the binary, finding the
// session and recording the turn take about 30 of them on the author's machine.
const BUDGET_MS = (WINDOWS ? 120 : 50) * (CI ? 2.5 : 1);

/** Deterministic pseudo-random numbers: the same corpus on every run. */
function generator(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}

// Made-up words of three syllables, none of them a stopword or a word about code.
const CONSONANTS = "bdfgklmnprtvz";
const VOWELS = "aeiou";
const WORDS = Array.from({ length: VOCABULARY }, (_, i) => {
  let word = "";
  let n = i + 1000;
  for (let s = 0; s < 3; s++) {
    word += `${CONSONANTS[n % CONSONANTS.length]}${VOWELS[Math.floor(n / CONSONANTS.length) % VOWELS.length]}`;
    n = Math.floor(n / (CONSONANTS.length * VOWELS.length)) + s * 7;
  }
  return `${word}${i % 7 === 0 ? "r" : "n"}`;
});

/** Zipf's law: the word of rank r is drawn in proportion to 1/r. */
const CUMULATIVE = (() => {
  let sum = 0;
  return WORDS.map((_, rank) => {
    sum += 1 / (rank + 1);
    return sum;
  });
})();
function zipf(next: (max: number) => number): string {
  const target = (next(1_000_000) / 1_000_000) * (CUMULATIVE.at(-1) as number);
  let low = 0;
  let high = CUMULATIVE.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((CUMULATIVE[mid] as number) < target) low = mid + 1;
    else high = mid;
  }
  return WORDS[low] as string;
}

let base: string;
let db: Db;
let projectId: number;
const prompts: string[] = [];

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wcmem-perf-large-")));
  db = openDb({ dataDir: join(base, "data"), busyTimeoutMs: 5000 });
  mkdirSync(join(base, "project"));
  mkdirSync(join(base, "other"));
  projectId = resolveProject(db, join(base, "project"), 0).id;
  const otherId = resolveProject(db, join(base, "other"), 0).id;
  const next = generator(42);
  const words = (n: number) => Array.from({ length: n }, () => zipf(next)).join(" ");
  const now = Date.now();
  withWrite(db, () => {
    for (let i = 0; i < PROJECT_MEMORIES + OTHER_MEMORIES; i++) {
      const title = `The ${words(8)}.`;
      const body = `${words(40)}. ${words(40)}. ${words(30)}.`;
      const file = `src/${WORDS[next(VOCABULARY)]}/${WORDS[next(VOCABULARY)]}.ts`;
      insertMemory(db, {
        projectId: i % 2 === 0 ? projectId : otherId,
        kind: MEMORY_KINDS[i % MEMORY_KINDS.length] as (typeof MEMORY_KINDS)[number],
        title,
        body: body as Redacted,
        terms: searchTerms(title, body, [file]),
        importance: 1 + (i % 5),
        branch: null,
        commit: null,
        origin: "manual",
        judge: "heuristic",
        judgeVersion: "1",
        sourceTurnId: null,
        files: [{ path: file, role: "changed" }],
        now: now - next(200) * 86_400_000,
      });
    }
  });
  // Mostly the words every memory has, and a few that only some have.
  const ask = generator(7);
  const common = () => WORDS[ask(150)] as string;
  const telling = () => WORDS[300 + ask(3000)] as string;
  for (let i = 0; i < PROMPTS; i++) {
    const many = Array.from({ length: 30 }, common).join(" ");
    prompts.push(
      `why does the ${common()} ${telling()} ${common()} when ${many}? Could the ${telling()} ${common()} ${telling()} be the problem?`,
    );
  }
}, 240_000);

afterAll(() => {
  db.close();
  rmSync(base, { recursive: true, force: true });
});

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] as number;
}

test(`a prompt of common words is answered within ${BUDGET_MS} ms in a project of ${PROJECT_MEMORIES} memories`, () => {
  const samples: number[] = [];
  let given = 0;
  // Once unmeasured: the first pass reads the index from disk.
  for (const [run, prompt] of [...prompts.slice(0, 1), ...prompts].entries()) {
    const start = performance.now();
    const notes = retrieveForPrompt(db, {
      projectId,
      sessionId: -1,
      epoch: 0,
      prompt,
      branch: null,
      now: Date.now(),
    });
    if (run === 0) continue;
    samples.push(performance.now() - start);
    if (notes.length > 0) given++;
  }
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(
    `large project prompt: p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms (${given} of ${PROMPTS} given notes)`,
  );
  // The measurement only means something if retrieval actually ran and found things.
  expect(given).toBeGreaterThan(PROMPTS / 4);
  // On a shared CI runner the tail is noise: the median is held there, the tail here.
  expect(CI ? p50 : p95).toBeLessThanOrEqual(BUDGET_MS);
}, 120_000);
