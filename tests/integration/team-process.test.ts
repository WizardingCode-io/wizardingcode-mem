import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTeamDb, openTeamExisting } from "../../src/team/db.ts";
import { SERVE_LEASE } from "../../src/team/lease.ts";
import { leaseOf, setMeta } from "../../src/team/store.ts";
import { runCli, type SpawnedCli, spawnCli } from "../helpers/cli.ts";
import {
  cleanTestDirs,
  entryPayload,
  eventsOf,
  startTestServer,
  type TestServer,
} from "../helpers/team.ts";

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "wcm-serve-"));
  dirs.push(dir);
  return dir;
};
const children: SpawnedCli[] = [];
const open: TestServer[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    await child.exited.catch(() => undefined);
  }
  for (const t of open.splice(0)) await t.close();
});
afterAll(() => {
  cleanTestDirs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const baseEnv = (home: string, extra: Record<string, string> = {}) => ({
  PATH: process.env.PATH ?? "",
  HOME: home,
  ...extra,
});

interface Line {
  at?: string;
  level?: string;
  event?: string;
  [key: string]: unknown;
}

/** Collects stdout lines in the background and gives the first that matches. */
function watch(child: SpawnedCli): {
  lines: Line[];
  raw: string[];
  until(predicate: (line: Line) => boolean, timeoutMs?: number): Promise<Line>;
} {
  const lines: Line[] = [];
  const raw: string[] = [];
  const waiters: { predicate: (line: Line) => boolean; resolve: (line: Line) => void }[] = [];
  (async () => {
    for await (const text of child.stdout) {
      raw.push(text);
      let parsed: Line;
      try {
        parsed = JSON.parse(text) as Line;
      } catch {
        parsed = { event: "unparsable", text };
      }
      lines.push(parsed);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(parsed)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(parsed);
        }
      }
    }
  })();
  return {
    lines,
    raw,
    until: (predicate, timeoutMs = 10_000) =>
      new Promise<Line>((resolve, reject) => {
        const found = lines.find(predicate);
        if (found !== undefined) return resolve(found);
        const timer = setTimeout(
          () =>
            reject(new Error(`no line matched within ${timeoutMs} ms; saw ${JSON.stringify(raw)}`)),
          timeoutMs,
        );
        waiters.push({
          predicate,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
      }),
  };
}

async function drain(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of stream) out.push(line);
  return out;
}

const serve = (
  dir: string,
  home: string,
  extraEnv: Record<string, string> = {},
  ...flags: string[]
) => {
  const child = spawnCli(
    { env: baseEnv(home, extraEnv) },
    "serve",
    "--data",
    dir,
    "--port",
    "0",
    ...flags,
  );
  children.push(child);
  return child;
};

describe("the serve process", () => {
  test("listens on 127.0.0.1 with PATH and HOME alone, logs JSON lines, answers a held pull on SIGTERM, releases the lease and exits 0 within 2 s", async () => {
    const dir = tempDir();
    const home = tempDir();
    const child = serve(dir, home);
    const out = watch(child);
    const listening = await out.until((line) => line.event === "listening");
    expect(listening.host).toBe("127.0.0.1");
    expect(typeof listening.port).toBe("number");
    const port = listening.port as number;
    expect(out.lines.some((line) => line.event === "plain-http")).toBe(false);
    const bootstrap = out.lines.find((line) => line.event === "bootstrap");
    expect(bootstrap?.code).toMatch(/^wci1_/);
    const origin = `http://127.0.0.1:${port}`;

    // The lease: a serve- owner, no pid.
    const peek = openTeamExisting(dir);
    const lease = leaseOf(peek as NonNullable<typeof peek>, SERVE_LEASE);
    peek?.close();
    expect(lease?.owner).toMatch(/^serve-[0-9a-f]{16}$/);
    expect(lease?.owner).not.toBe(`serve-${child.proc.pid}`);

    const joined = await fetch(`${origin}/v1/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: bootstrap?.code, label: "laptop", name: "André" }),
    });
    expect(joined.status).toBe(200);
    const { token } = (await joined.json()) as { token: string };
    // A pushed payload: its text must stay out of the log.
    const payload = entryPayload({ scope: "shared", slug: "logged", body: "PAYLOAD-MARKER-9f3c" });
    const pushed = await fetch(`${origin}/v1/push`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        epoch: 1,
        items: [{ op: "send", kind: "entry", uid: payload.uid, payload }],
      }),
    });
    expect(pushed.status).toBe(200);
    // A code minted through the API, a join refused with a wrong code, and the code's own join:
    // none of the three codes reaches the log.
    const minted = await fetch(`${origin}/v1/invitations`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ role: "member", name: "Eva" }),
    });
    expect(minted.status).toBe(201);
    const { code: evaCode } = (await minted.json()) as { code: string };
    const wrongCode = `${evaCode.slice(0, -1)}${evaCode.endsWith("A") ? "B" : "A"}`;
    const joinWith = (code: string) =>
      fetch(`${origin}/v1/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, label: "eva laptop" }),
      });
    expect((await joinWith(wrongCode)).status).not.toBe(200);
    expect((await joinWith(evaCode)).status).toBe(200);
    // The cursor past the pushed row, so the pull is held until the stop answers it.
    const held = fetch(`${origin}/v1/pull?since=1&wait=20`, {
      headers: { authorization: `Bearer ${token}` },
    });
    await Bun.sleep(150);
    const sent = performance.now();
    child.kill("SIGTERM");
    const answer = await held;
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { items: unknown[] }).items).toEqual([]);
    const code = await child.exited;
    expect(performance.now() - sent).toBeLessThan(2000);
    expect(code).toBe(0);
    const after = openTeamExisting(dir);
    expect(leaseOf(after as NonNullable<typeof after>, SERVE_LEASE)).toBeNull();
    after?.close();

    for (const line of out.lines) {
      expect(line.event).not.toBe("unparsable");
      expect(typeof line.at).toBe("string");
      expect(typeof line.level).toBe("string");
      expect(typeof line.event).toBe("string");
    }
    const everything = out.raw.join("\n");
    expect(everything).not.toContain(token.slice(5));
    expect(everything).toContain("request");
    expect(everything).not.toContain("PAYLOAD-MARKER-9f3c");
    expect(everything).not.toContain("id: ");
    expect(everything).not.toContain(evaCode);
    expect(everything).not.toContain(wrongCode);
    expect(out.raw.filter((line) => line.includes("wci1_"))).toHaveLength(1);
  });

  test("the host comes from the environment; a host outside loopback without trust-proxy logs plain-http", async () => {
    const dir = tempDir();
    const home = tempDir();
    const child = serve(dir, home, { WIZARDINGCODE_MEM_TEAM_HOST: "localhost" });
    const out = watch(child);
    const listening = await out.until((line) => line.event === "listening");
    expect(listening.host).toBe("localhost");
    child.kill("SIGTERM");
    expect(await child.exited).toBe(0);
    expect(out.lines.some((line) => line.event === "plain-http")).toBe(false);

    const exposed = await startTestServer({ host: "0.0.0.0" });
    open.push(exposed);
    expect(eventsOf(exposed, "plain-http")).toHaveLength(1);
    expect(exposed.server.options).toEqual({ idleTimeout: 120, maxRequestBodySize: 2_097_152 });
    const quiet = await startTestServer({ host: "127.0.0.1" });
    open.push(quiet);
    expect(eventsOf(quiet, "plain-http")).toHaveLength(0);
  });

  test("a second serve on the directory exits 1 naming the lease; an expired lease is replaced", async () => {
    const dir = tempDir();
    const home = tempDir();
    const first = serve(dir, home);
    const out = watch(first);
    await out.until((line) => line.event === "listening");
    const second = serve(dir, home);
    const [code, stderr] = await Promise.all([second.exited, drain(second.stderr)]);
    expect(code).toBe(1);
    expect(stderr.join("\n")).toContain("another serve holds");
    expect(stderr.join("\n")).toContain("serve.lease");
    first.kill("SIGTERM");
    expect(await first.exited).toBe(0);

    const db = openTeamDb(dir);
    setMeta(
      db,
      SERVE_LEASE,
      JSON.stringify({ owner: "serve-deadbeefdeadbeef", until: Date.now() - 60_000 }),
    );
    db.close();
    const third = serve(dir, home);
    const again = watch(third);
    await again.until((line) => line.event === "listening");
    const peek = openTeamExisting(dir);
    expect(leaseOf(peek as NonNullable<typeof peek>, SERVE_LEASE)?.owner).not.toBe(
      "serve-deadbeefdeadbeef",
    );
    peek?.close();
    third.kill("SIGTERM");
    expect(await third.exited).toBe(0);
  });

  test("serve skips the legacy migration, --help lists it, a newer team.db exits 3", async () => {
    const home = tempDir();
    const legacy = join(home, ".shibaox", "mem");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, "shibaox-mem.db"), "not a database, just a marker");
    writeFileSync(join(legacy, "ui.json"), "{}");
    const probe = spawnCli(
      { env: baseEnv(home) },
      "serve",
      "health",
      "--url",
      "http://127.0.0.1:1",
    );
    children.push(probe);
    expect(await probe.exited).toBe(1);
    expect(existsSync(join(legacy, "shibaox-mem.db"))).toBe(true);
    expect(readdirSync(legacy).sort()).toEqual(["shibaox-mem.db", "ui.json"]);
    expect(existsSync(join(home, ".wizardingcode"))).toBe(false);
    // The server itself, with the same seeded home.
    const running = serve(tempDir(), home);
    const out = watch(running);
    await out.until((line) => line.event === "listening");
    running.kill("SIGTERM");
    expect(await running.exited).toBe(0);
    expect(readdirSync(legacy).sort()).toEqual(["shibaox-mem.db", "ui.json"]);
    expect(existsSync(join(home, ".wizardingcode"))).toBe(false);

    const help = await runCli("--help");
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("serve");
    const serveHelp = await runCli("serve", "--help");
    expect(serveHelp.exitCode).toBe(0);
    expect(serveHelp.stdout).toContain("Subcommands");

    const dir = tempDir();
    const newer = new Database(join(dir, "team.db"), { create: true });
    newer.run("PRAGMA user_version = 2");
    newer.run("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    newer.run("INSERT INTO meta VALUES ('team.schema', 'team')");
    newer.close();
    const child = serve(dir, home);
    const [code, stderr] = await Promise.all([child.exited, drain(child.stderr)]);
    expect(code).toBe(3);
    expect(stderr.join("\n")).toMatch(/newer|too new/i);
  });
});
