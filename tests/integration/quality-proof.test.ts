// The memory quality proof (scripts/proof/quality.sh and quality.ts, ADR 0023) on a throwaway
// "live" store: the live database is only read, and only TypeSafe's own verdicts are counted.
// Nothing leaves 127.0.0.1: TypeSafe is a local stand-in named by WIZARDINGCODE_MEM_TYPESAFE_URL,
// which quality.ts honours for smoke runs (the shell unsets it, so `measure` runs quality.ts
// directly, as the plan's smoke step does).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DB_FILE, openDb } from "../../src/store/db.ts";

const REPO = resolve(import.meta.dir, "../..");
const BUN = join(REPO, "node_modules/.bin/bun");
const KEY = ["apikey_", "test0000", "_", "x".repeat(40)].join("");

let base: string;
let brandHome: string;
let liveData: string;
let work: string;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-quality-proof-")));
  brandHome = join(base, "brand");
  liveData = join(brandHome, "mem");
  work = join(base, "work");
  mkdirSync(join(base, "user"), { recursive: true });
  const db = openDb({ dataDir: liveData, busyTimeoutMs: 2000 });
  db.run(`INSERT INTO projects (key, name, created_at) VALUES ('path:/p', 'p', 1)`);
  db.run(`INSERT INTO sessions (agent, agent_session_id, project_id, cwd, started_at, last_seen_at)
          VALUES ('claude-code', 's', 1, '/p', 1, 1)`);
  db.run(`INSERT INTO turns (session_id, project_id, seq, state, prompt, final_text, started_at, ended_at) VALUES
    (1, 1, 1, 'done', 'why does the hook hang on windows',
     'Status: looked into it. The cause was a pending timer in src/hooks/stop.ts that kept the process alive.', 1, 2),
    (1, 1, 2, 'done', 'why do the totals drift',
     'Done for today. Totals drift because each line was rounded; they are now rounded once, at the end.', 3, 4),
    (1, 1, 3, 'skipped', 'how is the verdict cache keyed',
     'The verdict cache is keyed by the SHA-256 of the request, so a wording change asks again.', 5, 6)`);
  db.run(`INSERT INTO memories (project_id, kind, title, body, terms, importance, origin, judge, judge_version,
                                source_turn_id, created_at, updated_at) VALUES
    (1, 'fix', 'Status: looked into it.', 'The cause was a pending timer in src/hooks/stop.ts that kept the process alive.',
     '', 4, 'distilled', 'typesafe', '1', 1, 2, 2),
    (1, 'decision', 'Done for today.', 'Totals drift because each line was rounded; they are now rounded once, at the end.',
     '', 3, 'distilled', 'typesafe', '1', 2, 4, 4)`);
  db.close();
});

afterEach(async () => {
  // Awaited: a port still closing can be handed to the next test's server.
  await server?.stop(true);
  server = undefined;
  rmSync(base, { recursive: true, force: true });
});

/** A hermetic environment: none of the caller's TYPESAFE* or WIZARDINGCODE* variables. */
function baseEnv(extra: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: join(base, "user"),
    TMPDIR: tmpdir(),
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
    WIZARDINGCODE_MEM_UI_BROWSER: "none",
    ...extra,
  };
}

async function run(cmd: string[], env: Record<string, string>) {
  // Async: the stand-in TypeSafe answers from this process's event loop.
  const child = Bun.spawn(cmd, { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/** The live store as the shell finds it: the brand home and the data directory named. */
const shell = (...args: string[]) =>
  run(
    ["bash", join(REPO, "scripts/proof/quality.sh"), work, ...args],
    baseEnv({ WIZARDINGCODE_HOME: brandHome, WIZARDINGCODE_MEM_DATA_DIR: liveData }),
  );

/** `measure` on the copy, pointed at the stand-in TypeSafe, with a fake key. */
const measure = (url: string, ...args: string[]) =>
  run(
    [BUN, join(REPO, "scripts/proof/quality.ts"), work, "measure", ...args],
    baseEnv({
      WIZARDINGCODE_HOME: brandHome,
      LIVE_DATA: liveData,
      LIVE_STORE: liveData,
      TYPESAFE_API_KEY: KEY,
      WIZARDINGCODE_MEM_TYPESAFE_URL: url,
    }),
  );

interface Item {
  turn: number;
  candidates: { id: number; said_by: string; text: string }[];
}

/** Samples drawn with the shell, and one labels file per sample, by candidate id. */
async function sampleAndLabel(): Promise<string[]> {
  const sampled = await shell("sample", "--size", "1", "--skipped", "5");
  expect(sampled.stderr).toBe("");
  expect(sampled.exitCode).toBe(0);
  expect(sampled.stdout).toContain(`copied the store to ${join(work, "home", "mem")}`);
  expect(sampled.stdout).toContain("eligible: 2 memories, 1 skipped turns; sample A 1, B 1, S 1");
  const args: string[] = [];
  for (const name of ["a", "b", "s"]) {
    const items = JSON.parse(readFileSync(join(work, `sample-${name}.json`), "utf8")) as Item[];
    const labels = items.map((item) => {
      const quotes = item.candidates
        .filter((c) => /cause|because|keyed by/.test(c.text))
        .map((c) => c.id);
      expect(quotes.length).toBeGreaterThan(0);
      // The skipped turn is labelled a record, so a memory version 2 makes from it is noise.
      if (name === "s") return { turn: item.turn, label: "record", why: "a status", quotes: [] };
      return { turn: item.turn, label: "mixed", why: "the cause, wrapped in the session", quotes };
    });
    const file = join(base, `labels-${name}.json`);
    writeFileSync(file, JSON.stringify(labels));
    args.push(`--${name}`, file);
  }
  return args;
}

/** A stand-in System One: every question answered by its type, as the real service does. */
function serveValid(): string {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = (await request.json()) as {
        questions: Record<string, { type: string; criteria?: unknown }>;
      };
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(body.questions)) {
        if (question.type === "noul") answers[id] = { type: "noul", noul: 0.9 };
        else if (question.type === "score")
          answers[id] = { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 1 };
        else {
          const criteria = question.criteria as Record<string, string>;
          const keys = Object.keys(criteria);
          // The title is the candidate that states the cause, as a judge that reads would pick.
          const cause = keys.find(
            (k) => k !== "none" && /cause|because|keyed by/.test(criteria[k] ?? ""),
          );
          const choice =
            id === "kind" ? "fix" : (cause ?? keys.find((k) => k !== "none") ?? "none");
          answers[id] = { type: "choice", choice, probabilities: {}, confidence: 1 };
        }
      }
      return Response.json({
        model: "jev-latest",
        answers,
        usage: { input_tokens: 400, output_tokens: 3 },
      });
    },
  });
  return `http://127.0.0.1:${server.port}/v1/systemone`;
}

function serveFailing(): string {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ detail: "down" }, { status: 500 }),
  });
  return `http://127.0.0.1:${server.port}/v1/systemone`;
}

/** The report's metric row, as its four cells: TypeSafe v1, TypeSafe v2, heuristic v1, v2. */
function rowOf(report: string, metric: string): string[] {
  const line = report.split("\n").find((l) => l.startsWith(`| ${metric}`));
  expect(line).toBeDefined();
  return (line as string)
    .split(" | ")
    .slice(1)
    .map((cell) => cell.replace(/ \|$/, "").trim());
}

const fingerprint = (path: string) => ({
  sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  mtimeMs: statSync(path).mtimeMs,
});

describe("the memory quality proof", () => {
  test("the live store is only read: sample and measure work on the copy in <work dir>/home/mem", async () => {
    const liveDb = join(liveData, DB_FILE);
    const before = fingerprint(liveDb);

    const labels = await sampleAndLabel();
    expect(existsSync(join(work, "home", "mem", DB_FILE))).toBe(true);
    // Through the shell, `measure` without a key stops before any request.
    const keyless = await shell("measure", ...labels);
    expect(keyless.exitCode).toBe(1);
    expect(keyless.stderr).toContain("measure needs a TypeSafe key");
    // With a key, on the copy, against the stand-in.
    const measured = await measure(serveValid(), ...labels);
    expect(measured.stderr).toBe("");
    expect(measured.exitCode).toBe(0);
    expect(existsSync(join(work, "report.md"))).toBe(true);

    expect(fingerprint(liveDb)).toEqual(before);
  }, 30_000);

  test("TypeSafe's own verdicts are counted: every verdict kept is TypeSafe's, none failed", async () => {
    const labels = await sampleAndLabel();
    const measured = await measure(serveValid(), ...labels);
    expect(measured.stderr).toBe("");
    expect(measured.exitCode).toBe(0);

    const report = readFileSync(join(work, "report.md"), "utf8");
    expect(report).toContain("TypeSafe failed on 0 turns, left out of every share.");
    expect(report).toContain("3 TypeSafe requests, 1200 input tokens, 0 verdicts reused");
    const verdicts = Object.values(
      JSON.parse(readFileSync(join(work, "verdicts.json"), "utf8")) as Record<
        string,
        { verdict: { source: string } }
      >,
    );
    expect(verdicts.length).toBe(3);
    for (const entry of verdicts) expect(entry.verdict.source).toBe("typesafe");
    // The metrics themselves, computed from the labels and the readings: TypeSafe v1 (the
    // stored memory), TypeSafe v2, heuristic v1, heuristic v2.
    expect(rowOf(report, "Title is knowledge")).toEqual([
      "0 of 1 (0%)",
      "1 of 1 (100%)",
      "1 of 1 (100%)",
      "1 of 1 (100%)",
    ]);
    expect(rowOf(report, "Lost, of knowledge and mixed turns")).toEqual([
      "0 of 1 (0%)",
      "0 of 1 (0%)",
      "0 of 1 (0%)",
      "0 of 1 (0%)",
    ]);
    expect(rowOf(report, "Stored from record or fragment")).toEqual([
      "0 of 1 (0%)",
      "1 of 2 (50%)",
      "0 of 1 (0%)",
      "0 of 1 (0%)",
    ]);
    expect(rowOf(report, "Memories stored")).toEqual(["2", "3", "2", "2"]);
    expect(rowOf(report, "Title-only")).toEqual([
      "0 of 2 (0%)",
      "0 of 3 (0%)",
      "2 of 2 (100%)",
      "2 of 2 (100%)",
    ]);
  }, 30_000);

  test("when TypeSafe fails, the heuristic never stands in: every turn failed, no v2 memory counted", async () => {
    const labels = await sampleAndLabel();
    const measured = await measure(serveFailing(), ...labels);
    expect(measured.stderr).toBe("");
    expect(measured.exitCode).toBe(0);

    const report = readFileSync(join(work, "report.md"), "utf8");
    expect(report).toContain("TypeSafe failed on 3 turns, left out of every share.");
    expect(report).toContain("0 TypeSafe requests, 0 input tokens, 0 verdicts reused");
    const v2 = (metric: string) => rowOf(report, metric)[1];
    expect(v2("Title is knowledge")).toBe("n/a");
    expect(v2("Lost, of knowledge and mixed turns")).toBe("n/a");
    expect(v2("Stored from record or fragment")).toBe("n/a");
    expect(v2("Memories stored")).toBe("0");
    expect(v2("Title-only")).toBe("n/a");
    // A failed request is never cached as a verdict.
    expect(JSON.parse(readFileSync(join(work, "verdicts.json"), "utf8"))).toEqual({});
  }, 30_000);
});
