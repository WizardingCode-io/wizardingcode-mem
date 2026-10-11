import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_USAGE } from "../../src/cli/exit.ts";
import { DB_FILE } from "../../src/store/db.ts";
import { runCliWith } from "../helpers/cli.ts";

let base: string;
let env: Record<string, string>;
const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-history-cli-")));
  const shop = join(base, "shop");
  mkdirSync(shop);
  const projects = join(base, "claude", "projects", "-shop");
  mkdirSync(projects, { recursive: true });
  const line = (o: unknown) => JSON.stringify(o);
  const common = { sessionId: "s1", cwd: shop, gitBranch: "main", isSidechain: false };
  writeFileSync(
    join(projects, "s1.jsonl"),
    [
      line({
        ...common,
        type: "user",
        promptId: "p1",
        timestamp: day(3),
        message: {
          role: "user",
          content: "Never mock the database in these tests. Always use a real SQLite file.",
        },
      }),
      line({
        ...common,
        type: "assistant",
        timestamp: day(3),
        message: { role: "assistant", content: [{ type: "text", text: "Understood." }] },
      }),
    ].join("\n"),
  );
  env = {
    WIZARDINGCODE_HOME: join(base, "home"),
    CLAUDE_CONFIG_DIR: join(base, "claude"),
    CODEX_HOME: join(base, "codex"),
    WIZARDINGCODE_MEM_TYPESAFE: "off",
    WIZARDINGCODE_MEM_DISTILL: "off",
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    WIZARDINGCODE_MEM_MIGRATE: "off",
  };
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const dbPath = () => join(base, "home", "mem", DB_FILE);
const history = (...args: string[]) => runCliWith({ env }, "history", ...args);

describe("wizardingcode-mem history", () => {
  test("import distils recent history into memories dated when they happened", async () => {
    const out = await history("import");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("1 queued");
    expect(out.stdout).toContain("0 skipped (window 0, host 0, disabled 0, unresolved 0)");
    const db = new Database(dbPath(), { readonly: true });
    const rows = db
      .query<{ kind: string; created_at: number }, []>("SELECT kind, created_at FROM memories")
      .all();
    db.close();
    expect(rows.map((r) => r.kind)).toEqual(["convention"]);
    expect(rows[0]?.created_at).toBeLessThan(Date.now() - 2 * 86_400_000);
  });

  test("import never archives; it says how many projects are ready for replace-imports", async () => {
    const out = await history("import");
    expect(out.stdout).toContain("1 projects ready for replace-imports");
    expect(out.stdout).not.toContain("replaced");
  });

  test("replace-imports archives the imports history covers; restore and a later import keep them active", async () => {
    await history("import");
    const db = new Database(dbPath());
    const turn = db
      .query<{ project_id: number; started_at: number }, []>(
        "SELECT project_id, started_at FROM turns WHERE origin = 'history'",
      )
      .get();
    db.run(
      `INSERT INTO memories (project_id, kind, title, body, importance, origin, judge, judge_version, created_at, updated_at)
       VALUES (?, 'decision', 'Imported', 'From claude-mem.', 3, 'imported', 'x', '1', ?, ?)`,
      [turn?.project_id ?? 0, turn?.started_at ?? 0, turn?.started_at ?? 0],
    );
    db.close();
    const statusOf = () => {
      const read = new Database(dbPath(), { readonly: true });
      const row = read
        .query<{ status: string }, []>("SELECT status FROM memories WHERE origin = 'imported'")
        .get();
      read.close();
      return row?.status;
    };

    const replaced = await history("replace-imports");
    expect(replaced.exitCode).toBe(0);
    expect(replaced.stdout).toContain("1 imports archived, 0 spared as confirmed, 1 projects");
    expect(statusOf()).toBe("archived");

    expect((await history("restore-imports")).stdout).toContain("1 restored");
    expect(statusOf()).toBe("active");

    await history("import");
    expect(statusOf()).toBe("active");
  });

  test("running it again adds nothing", async () => {
    await history("import");
    const again = await history("import");
    expect(again.stdout).toContain("0 queued, 1 known");
  });

  test("a bad flag is a usage error", async () => {
    const out = await history("import", "--days", "zero");
    expect(out.exitCode).toBe(EXIT_USAGE);
    expect(out.stderr).toContain("bad option");
  });

  test("restore-imports reports what it reactivated", async () => {
    const out = await history("restore-imports");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("0 restored");
  });
  test("index then search finds the turn; forget removes only the index", async () => {
    const idx = await history("index");
    expect(idx.exitCode).toBe(0);
    expect(idx.stdout).toMatch(
      /history index: 1 files, 1 indexed, 0 unchanged, 0 removed, 1 turns/,
    );
    const found = await history("search", "SQLite", "file");
    expect(found.exitCode).toBe(0);
    expect(found.stdout).toContain("Never mock the database");
    expect(found.stdout).toContain("shop");
    const mine = await history("search", "sqlite", "--project", "nonexistent");
    expect(mine.stdout).not.toContain("Never mock");

    await history("import");
    const forgotten = await history("forget");
    expect(forgotten.stdout).toContain("history forget: index deleted");
    expect(existsSync(join(base, "home", "mem", "history.db"))).toBe(false);
    expect(existsSync(dbPath())).toBe(true);
    const db = new Database(dbPath(), { readonly: true });
    const count = db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n;
    db.close();
    expect(count).toBe(1);
  });

  test("search works once the index's WAL and shared-memory files are gone", async () => {
    await history("index");
    const index = join(base, "home", "mem", "history.db");
    for (const suffix of ["-wal", "-shm"]) rmSync(index + suffix, { force: true });
    const found = await history("search", "SQLite");
    expect(found.exitCode).toBe(0);
    expect(found.stdout).toContain("Never mock the database");
  });

  test("index --transcript does nothing, silently, when there is no index", async () => {
    const file = join(base, "claude", "projects", "-shop", "s1.jsonl");
    const out = await history("index", "--transcript", file, "--agent", "claude-code");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("");
    expect(out.stderr).toBe("");
    expect(existsSync(join(base, "home", "mem", "history.db"))).toBe(false);
  });

  test("index --transcript indexes exactly that file and needs --agent", async () => {
    const file = join(base, "claude", "projects", "-shop", "s1.jsonl");
    await history("index", "--agent", "codex"); // an empty index, as after a first pass
    const one = await history("index", "--transcript", file, "--agent", "claude-code");
    expect(one.exitCode).toBe(0);
    expect(one.stdout).toMatch(
      /history index: 1 files, 1 indexed, 0 unchanged, 0 removed, 1 turns/,
    );
    const again = await history("index", "--transcript", file, "--agent", "claude-code");
    expect(again.stdout).toMatch(/history index: 1 files, 0 indexed, 1 unchanged/);
    const bad = await history("index", "--transcript", file);
    expect(bad.exitCode).toBe(EXIT_USAGE);
  });

  test("search before any index says so and exits 0", async () => {
    const out = await history("search", "anything");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("history search: no history index yet");
  });

  test("search over an index that cannot be read says how to rebuild it and exits 1", async () => {
    mkdirSync(join(base, "home", "mem"), { recursive: true });
    writeFileSync(join(base, "home", "mem", "history.db"), "not a database, not at all");
    const out = await history("search", "anything");
    expect(out.exitCode).toBe(1);
    expect(out.stderr.trim()).toBe(
      "The history index could not be read. The user can rebuild it: wizardingcode-mem history forget, then wizardingcode-mem history index",
    );
  });

  test("search without words is a usage error", async () => {
    expect((await history("search")).exitCode).toBe(EXIT_USAGE);
  });

  test("import prints the backfill line and the index line", async () => {
    const out = await history("import");
    expect(out.stdout).toContain("history: 1 transcripts");
    expect(out.stdout).toContain("history index: 1 files");
  });

  describe("one run at a time", () => {
    const meta = (key: string): string | null => {
      const read = new Database(dbPath(), { readonly: true });
      const row = read
        .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
        .get(key);
      read.close();
      return row?.value ?? null;
    };
    const setLease = (until: number) => {
      const write = new Database(dbPath());
      write.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('history.lease', ?)", [
        JSON.stringify({ owner: `${process.pid}-other`, until }),
      ]);
      write.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('history.run.state', 'running')");
      write.close();
    };

    test("a run records its state, its times and its report, and lets go of the lease", async () => {
      expect((await history("import")).exitCode).toBe(0);
      expect(meta("history.run.state")).toBe("done");
      expect(Number(meta("history.run.started_at"))).toBeGreaterThan(0);
      expect(Number(meta("history.run.finished_at"))).toBeGreaterThanOrEqual(
        Number(meta("history.run.started_at")),
      );
      expect(JSON.parse(meta("history.run.report") as string)).toMatchObject({ queued: 1 });
      expect(meta("history.lease")).toBeNull();
    });

    test("while another run holds the lease, import and index say so and change nothing", async () => {
      await history("import");
      setLease(Date.now() + 60_000);
      for (const sub of ["import", "index"]) {
        const out = await history(sub);
        expect(out.exitCode).toBe(0);
        expect(out.stdout).toBe("history: already running\n");
      }
      expect(meta("history.run.state")).toBe("running");
    });

    test("a run that was killed (its lease expired) does not block the next one", async () => {
      await history("import");
      setLease(Date.now() - 1000);
      const out = await history("import");
      expect(out.stdout).toContain("transcripts");
      expect(meta("history.run.state")).toBe("done");
      expect(meta("history.lease")).toBeNull();
    });

    test("an index run is recorded too", async () => {
      await history("import");
      expect((await history("index")).exitCode).toBe(0);
      expect(meta("history.run.state")).toBe("done");
      expect(JSON.parse(meta("history.run.report") as string)).toHaveProperty("files");
    });
  });
});
