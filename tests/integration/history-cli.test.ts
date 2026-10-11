import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    const db = new Database(dbPath(), { readonly: true });
    const rows = db
      .query<{ kind: string; created_at: number }, []>("SELECT kind, created_at FROM memories")
      .all();
    db.close();
    expect(rows.map((r) => r.kind)).toEqual(["convention"]);
    expect(rows[0]?.created_at).toBeLessThan(Date.now() - 2 * 86_400_000);
  });

  test("running it again adds nothing", async () => {
    await history("import");
    const again = await history("import");
    expect(again.stdout).toContain("0 queued, 1 known");
  });

  test("a bad flag is a usage error", async () => {
    const out = await history("import", "--days", "zero");
    expect(out.exitCode).toBe(EXIT_USAGE);
  });

  test("restore-imports reports what it reactivated", async () => {
    const out = await history("restore-imports");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("0 restored");
  });
});
