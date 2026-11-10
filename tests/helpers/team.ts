// The team server in a test: a fresh data directory, a clock and timers the test drives, the
// bootstrap code captured, the log lines kept, and the HTTP calls as the client would make them.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LIMITS,
  type ServerOptions,
  startTeamServer,
  type TeamServer,
  type Timers,
} from "../../src/team/server.ts";

export interface Clock {
  now: number;
  /** Moves time forward and fires every timer that became due, in order. */
  advance(ms: number): void;
}

interface Scheduled {
  id: number;
  due: number;
  fn: () => void;
  every: number | null;
}

/** Timers that fire only when the clock is advanced past their due time. */
export function fakeTimers(clock: Clock): Timers & { pending(): number } {
  const scheduled: Scheduled[] = [];
  let next = 1;
  const add = (fn: () => void, ms: number, every: number | null) => {
    const entry = { id: next++, due: clock.now + Math.max(0, ms), fn, every };
    scheduled.push(entry);
    return entry.id as unknown as ReturnType<typeof setTimeout>;
  };
  const remove = (id: unknown) => {
    const index = scheduled.findIndex((entry) => entry.id === (id as number));
    if (index >= 0) scheduled.splice(index, 1);
  };
  clock.advance = (ms: number) => {
    const target = clock.now + ms;
    for (;;) {
      const due = scheduled.filter((entry) => entry.due <= target).sort((a, b) => a.due - b.due)[0];
      if (due === undefined) break;
      clock.now = Math.max(clock.now, due.due);
      if (due.every === null) remove(due.id);
      else due.due += due.every;
      due.fn();
    }
    clock.now = target;
  };
  return {
    setTimeout: ((fn: () => void, ms: number) => add(fn, ms, null)) as unknown as typeof setTimeout,
    clearTimeout: remove as unknown as typeof clearTimeout,
    setInterval: ((fn: () => void, ms: number) =>
      add(fn, ms, Math.max(1, ms))) as unknown as typeof setInterval,
    clearInterval: remove as unknown as typeof clearInterval,
    pending: () => scheduled.length,
  };
}

export interface TestServer {
  server: TeamServer;
  dir: string;
  /** The bootstrap invitation code the first start logged. */
  code: string;
  clock: Clock;
  freeBytes: { value: number | null };
  /** Every line the server wrote to its output. */
  lines: string[];
  mirrorRuns: { count: number };
  env: Record<string, string>;
  close(): Promise<void>;
}

export const ALIAS_A = "remote:github.com/acme/site";
export const ALIAS_B = "remote:github.com/acme/docs";

const dirs: string[] = [];

export async function startTestServer(overrides: Partial<ServerOptions> = {}): Promise<TestServer> {
  const dir = overrides.dataDir ?? mkdtempSync(join(tmpdir(), "wcm-team-"));
  dirs.push(dir);
  const clock: Clock = { now: 1_700_000_000_000, advance: () => undefined };
  const timers = fakeTimers(clock);
  const freeBytes = { value: (10 * 1024 * 1024 * 1024) as number | null };
  const lines: string[] = [];
  const mirrorRuns = { count: 0 };
  let code = "";
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: join(dir, "home") };
  const server = await startTeamServer({
    dataDir: dir,
    host: "127.0.0.1",
    port: 0,
    trustProxy: false,
    now: () => clock.now,
    timers,
    onBootstrap: (c) => {
      code = c;
    },
    env,
    freeBytes: () => freeBytes.value,
    stdout: (line) => lines.push(line),
    mirrorChild: async () => {
      mirrorRuns.count++;
    },
    ...overrides,
  });
  return {
    server,
    dir,
    code,
    clock,
    freeBytes,
    lines,
    mirrorRuns,
    env,
    close: async () => {
      await server.stop();
    },
  };
}

/** Removes every data directory the tests made; call it in `afterAll`. */
export function cleanTestDirs(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface ApiAnswer {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: the tests read whatever the server answered
  body: any;
  headers: Headers;
}

export async function api(
  server: TeamServer,
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiAnswer> {
  const response = await fetch(`${server.origin}${path}`, {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

export interface Joined {
  token: string;
  deviceId: string;
  deviceAlias: string;
  memberId: string;
  name: string;
  role: string;
  contract: number;
  serverId: string;
  instance: string;
}

export async function joinAs(
  server: TeamServer,
  code: string,
  label: string,
  name?: string,
): Promise<Joined> {
  const answer = await api(server, null, "POST", "/v1/join", {
    code,
    label,
    ...(name === undefined ? {} : { name }),
  });
  if (answer.status !== 200)
    throw new Error(`join failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  return answer.body as Joined;
}

export const adminOf = (t: TestServer, name?: string): Promise<Joined> =>
  joinAs(t.server, t.code, "admin laptop", name);

export async function invite(
  t: TestServer,
  adminToken: string,
  input: { role: "admin" | "member"; name: string } | { forMember: string },
): Promise<string> {
  const answer = await api(t.server, adminToken, "POST", "/v1/invitations", input);
  if (answer.status !== 201)
    throw new Error(`invite failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  return answer.body.code as string;
}

/** The JSON log lines of one event. */
export function eventsOf(t: TestServer, event: string): Record<string, unknown>[] {
  return t.lines
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null && entry.event === event);
}

export { LIMITS };
