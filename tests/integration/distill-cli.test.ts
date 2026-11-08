import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DB_FILE, openDb } from "../../src/store/db.ts";
import { runCliWith } from "../helpers/cli.ts";

let base: string;
let dataDir: string;
let project: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-distill-cli-")));
  dataDir = join(base, "data");
  project = join(base, "project");
  mkdirSync(project);
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const env = (distill: "off" | "detached") => ({
  WIZARDINGCODE_MEM_DATA_DIR: dataDir,
  ...(distill === "off" ? { WIZARDINGCODE_MEM_DISTILL: "off" } : { WIZARDINGCODE_MEM_DISTILL: "" }),
});

async function turn(n: number, distill: "off" | "detached" = "off"): Promise<void> {
  const common = { session_id: "s1", cwd: project, prompt_id: `p${n}` };
  await runCliWith(
    {
      input: JSON.stringify({ ...common, prompt: `why does module${n} fail under load?` }),
      env: env(distill),
    },
    "hook",
    "claude-code",
    "prompt",
  );
  await runCliWith(
    {
      input: JSON.stringify({
        ...common,
        last_assistant_message: `Fixed: the root cause was that \`worker${n}Pool\` never released connection ${n}. The pool in src/pool${n}.ts now releases it in a finally block.`,
      }),
      env: env(distill),
    },
    "hook",
    "claude-code",
    "turn-end",
  );
}

function rows<T>(sql: string): T[] {
  const db = new Database(join(dataDir, DB_FILE), { readonly: true });
  // A reader meeting a writer mid-checkpoint must wait, not fail.
  db.run("PRAGMA busy_timeout = 5000");
  try {
    return db.query<T, []>(sql).all();
  } finally {
    db.close();
  }
}
const count = (sql: string) => rows<{ n: number }>(`SELECT count(*) AS n FROM ${sql}`)[0]?.n;

describe("wizardingcode-mem distill", () => {
  test("drains the queue and says what it did", async () => {
    await turn(1);
    const result = await runCliWith({ env: env("off") }, "distill");
    expect(result).toEqual({
      exitCode: 0,
      stdout: "distill: 1 claimed, 1 done, 0 skipped, 0 failed\n",
      stderr: "",
    });
    expect(rows("SELECT kind FROM memories")).toEqual([{ kind: "fix" }]);
    expect(rows("SELECT state FROM turns")).toEqual([{ state: "done" }]);
  });

  test("says why the turns it skipped were skipped", async () => {
    const common = { session_id: "s1", cwd: project, prompt_id: "t1" };
    await runCliWith(
      { input: JSON.stringify({ ...common, prompt: "thanks!" }), env: env("off") },
      "hook",
      "claude-code",
      "prompt",
    );
    await runCliWith(
      {
        input: JSON.stringify({
          ...common,
          last_assistant_message: "Glad that sorted it out for you.",
        }),
        env: env("off"),
      },
      "hook",
      "claude-code",
      "turn-end",
    );
    expect((await runCliWith({ env: env("off") }, "distill")).stdout).toBe(
      "distill: 1 claimed, 0 done, 1 skipped (not-worth 1), 0 failed\n",
    );
  });

  test("with nothing queued it does nothing, successfully", async () => {
    openDb({ dataDir, busyTimeoutMs: 2000 }).close();
    expect((await runCliWith({ env: env("off") }, "distill")).stdout).toBe(
      "distill: 0 claimed, 0 done, 0 skipped, 0 failed\n",
    );
  });

  test("several processes at once handle each turn exactly once", async () => {
    for (let n = 1; n <= 6; n++) await turn(n);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => runCliWith({ env: env("off") }, "distill")),
    );
    expect(results.map((result) => [result.exitCode, result.stderr])).toEqual([
      [0, ""],
      [0, ""],
      [0, ""],
    ]);
    expect(count("turns WHERE state = 'done'")).toBe(6);
    expect(count("memory_sources WHERE relation = 'origin'")).toBe(count("memories"));
    expect(
      rows<{ n: number }>("SELECT count(*) AS n FROM memory_sources GROUP BY turn_id").every(
        (row) => row.n === 1,
      ),
    ).toBe(true);
    // Whichever process got the lease did all the work; the others reported nothing.
    const claimed = results.map((result) => Number(result.stdout.match(/(\d+) claimed/)?.[1]));
    expect(claimed.sort()).toEqual([0, 0, 6]);
  }, 30_000);

  test("a turn-end hook starts distillation in the background by itself", async () => {
    await turn(1, "detached");
    const deadline = Date.now() + 10_000;
    let state: string | undefined;
    while (Date.now() < deadline) {
      state = rows<{ state: string }>("SELECT state FROM turns")[0]?.state;
      if (state === "done" && count("meta WHERE key = 'drain.lease'") === 0) break;
      await Bun.sleep(50);
    }
    expect(state).toBe("done");
    expect(count("memories")).toBe(1);
  }, 20_000);

  test("a database it cannot use is an error a person can read", async () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    db.run("PRAGMA user_version = 99");
    db.close();
    const result = await runCliWith({ env: env("off") }, "distill");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("newer than this wizardingcode-mem supports");
    expect(result.stdout).toBe("");
  });
});
