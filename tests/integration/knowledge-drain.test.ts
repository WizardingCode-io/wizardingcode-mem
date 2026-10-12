import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { knowledgeDir } from "../../src/modules/knowledge/files.ts";
import { openDb } from "../../src/store/db.ts";
import { runCliWith } from "../helpers/cli.ts";

// The background drain brings the knowledge index of recently active projects up to date
// (K5): a folder too large for a hook to re-index is indexed here.

let base: string;
let dataDir: string;
let project: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-knowledge-drain-")));
  process.env.WIZARDINGCODE_HOME = base;
  dataDir = join(base, "data");
  project = join(base, "project");
  const dir = knowledgeDir(project);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 60; i++) {
    writeFileSync(
      join(dir, `entry-${i}.md`),
      `---\ntitle: Entry ${i}\nkind: rule\n---\nBody of entry ${i}.\n`,
    );
  }
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const entries = () => {
  const db = openDb({ dataDir, busyTimeoutMs: 2000 });
  try {
    return db.query<{ n: number }, []>("SELECT count(*) AS n FROM knowledge_entries").get()?.n;
  } finally {
    db.close();
  }
};

async function promptThenDrain(modules?: string) {
  const env = {
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off",
    ...(modules === undefined ? {} : { WIZARDINGCODE_MODULES: modules }),
  };
  const hook = await runCliWith(
    {
      input: JSON.stringify({ session_id: "s", cwd: project, prompt: "what does entry 7 say?" }),
      env: { ...env, WIZARDINGCODE_MEM_DISTILL: "off" },
    },
    "hook",
    "claude-code",
    "prompt",
  );
  expect(hook.exitCode).toBe(0);
  // Over the inline limit: the hook left the index alone.
  expect(entries()).toBe(0);
  const drain = await runCliWith({ env: { ...env, WIZARDINGCODE_MEM_DISTILL: "" } }, "distill");
  expect(drain.exitCode).toBe(0);
}

describe("the drain's knowledge refresh", () => {
  test("indexes the folder of a project an agent just worked in", async () => {
    await promptThenDrain();
    expect(entries()).toBe(60);
  }, 30_000);

  test("not when knowledge is off", async () => {
    await promptThenDrain("memory");
    expect(entries()).toBe(0);
  }, 30_000);
});
