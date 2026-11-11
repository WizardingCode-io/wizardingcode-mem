// The team server in a test: a fresh data directory, a clock and timers the test drives, the
// bootstrap code captured, the log lines kept, and the HTTP calls as the client would make them.
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderEntry } from "../../src/modules/knowledge/entry.ts";
import { hashOf } from "../../src/modules/knowledge/repo.ts";
import { memoryHash } from "../../src/sharing/hash.ts";
import {
  entryUid,
  memoryUid,
  type OutgoingEntry,
  type OutgoingMemory,
} from "../../src/sharing/types.ts";
import type { Db } from "../../src/team/db.ts";
import type { Bucket } from "../../src/team/limits.ts";
import type { PushItem, PushResult } from "../../src/team/push.ts";
import {
  LIMITS,
  type ServerOptions,
  startTeamServer,
  type TeamServer,
  type Timers,
} from "../../src/team/server.ts";
import { CLOCK_START, type Clock, fakeClock, fakeTimers } from "./clock.ts";

export { CLOCK_START, type Clock, fakeClock, fakeTimers };

export interface TestServer {
  server: TeamServer;
  dir: string;
  /** The bootstrap invitation code the first start logged. */
  code: string;
  clock: Clock;
  timers: Timers & { pending(): number };
  freeBytes: { value: number | null };
  /** Every line the server wrote to its output. */
  lines: string[];
  mirrorRuns: { count: number };
  close(): Promise<void>;
}

export const ALIAS_A = "remote:github.com/acme/site";
export const ALIAS_B = "remote:github.com/acme/docs";

const dirs: string[] = [];

/**
 * `startAt` moves the fake clock: a restart after a restore must outlive the copied lease.
 * `clock` and `timers` share them with a sync client the same test drives.
 */
export async function startTestServer(
  overrides: Partial<ServerOptions> = {},
  extra: { startAt?: number; clock?: Clock; timers?: Timers & { pending(): number } } = {},
): Promise<TestServer> {
  const dir = overrides.dataDir ?? mkdtempSync(join(tmpdir(), "wcm-team-"));
  dirs.push(dir);
  const clock = extra.clock ?? fakeClock(extra.startAt ?? CLOCK_START);
  const timers = extra.timers ?? fakeTimers(clock);
  const freeBytes = { value: (10 * 1024 * 1024 * 1024) as number | null };
  const lines: string[] = [];
  const mirrorRuns = { count: 0 };
  let code = "";
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
    freeBytes: () => freeBytes.value,
    stdout: (line) => lines.push(line),
    // The counting stub stands in for the child unless the test gives the real command line.
    ...(overrides.mirrorCommand === undefined
      ? {
          mirrorChild: async () => {
            mirrorRuns.count++;
          },
        }
      : {}),
    ...overrides,
  });
  return {
    server,
    dir,
    code,
    clock,
    timers,
    freeBytes,
    lines,
    mirrorRuns,
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

/** A member named `name`, joined with one device labelled `label`. */
export async function memberOf(
  t: TestServer,
  adminToken: string,
  name: string,
  label = "laptop",
): Promise<Joined> {
  return joinAs(t.server, await invite(t, adminToken, { role: "member", name }), label);
}

/** A second device of `member`. */
export async function deviceOf(
  t: TestServer,
  adminToken: string,
  member: Joined,
  label = "desktop",
): Promise<Joined> {
  return joinAs(t.server, await invite(t, adminToken, { forMember: member.memberId }), label);
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

// --- Payloads ---------------------------------------------------------------------------

export const newUuid = (): string => randomUUID();

export interface EntryInput {
  scope: "workspace" | "shared" | "project";
  uuid?: string;
  remoteAlias?: string | null;
  slug: string;
  title?: string;
  area?: string;
  kind?: string;
  body?: string;
  version?: number;
  author?: string;
  /** The frontmatter's `id`, when it must differ from the uid's UUID. */
  id?: string;
}

/** Splits a rendered file at the end of its frontmatter block, the closing `---` line included. */
export function splitEntryText(text: string): { frontmatter: string; body: string } {
  const end = text.indexOf("\n---\n", 3) + "\n---\n".length;
  return { frontmatter: text.slice(0, end), body: text.slice(end) };
}

/** An entry as part 4's client would send it: rendered by part 1, hashed by part 1. */
export function entryPayload(input: EntryInput): OutgoingEntry {
  const uuid = input.uuid ?? newUuid();
  const remoteAlias =
    input.scope === "project" ? (input.remoteAlias ?? ALIAS_A) : (input.remoteAlias ?? null);
  const text = renderEntry({
    id: input.id ?? uuid,
    slug: input.slug,
    title: input.title ?? "A title",
    kind: input.kind ?? "knowledge",
    area: input.area ?? "code",
    context: "",
    subject: "",
    status: "active",
    author: input.author ?? "Ana",
    version: input.version ?? 1,
    created: null,
    updated: null,
    supersedes: null,
    pinned: false,
    body: input.body ?? "The body.",
    extra: [],
    problem: null,
  });
  const { frontmatter, body } = splitEntryText(text);
  return {
    kind: "entry",
    uid: entryUid(input.scope, remoteAlias, uuid),
    scope: input.scope,
    slug: input.slug,
    remoteAlias,
    frontmatter,
    body,
    version: input.version ?? 1,
    hash: hashOf(Buffer.from(text, "utf8")),
  };
}

/** The payload with its hash recomputed after the test changed a text field. */
export function rehashed(payload: OutgoingEntry): OutgoingEntry {
  return { ...payload, hash: hashOf(Buffer.from(payload.frontmatter + payload.body, "utf8")) };
}

export interface MemoryInput {
  uid?: string;
  generation?: string;
  rowId?: number;
  remoteAlias?: string;
  title?: string;
  body?: string;
  memoryKind?: string;
  importance?: number;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  version?: number;
}

export function memoryPayload(input: MemoryInput = {}): OutgoingMemory {
  const fields = {
    memoryKind: input.memoryKind ?? "decision",
    importance: input.importance ?? 3,
    status: input.status ?? "active",
    title: input.title ?? "We chose SQLite",
    body: input.body ?? "One file, one process, no daemon.",
  };
  return {
    kind: "memory",
    uid: input.uid ?? memoryUid(input.generation ?? "a1b2c3d4", input.rowId ?? 1),
    remoteAlias: input.remoteAlias ?? ALIAS_A,
    ...fields,
    createdAt: input.createdAt ?? 1_699_000_000_000,
    updatedAt: input.updatedAt ?? 1_699_000_000_000,
    version: input.version ?? 1,
    hash: memoryHash(fields),
  };
}

/** The memory payload with its hash recomputed after a change. */
export function rehashedMemory(payload: OutgoingMemory): OutgoingMemory {
  return { ...payload, hash: memoryHash(payload) };
}

export type PushInput = Partial<PushItem> & { payload?: unknown };

/** A send of `payload` on base 0 unless the item says otherwise. */
export function sendOf(
  payload: OutgoingEntry | OutgoingMemory,
  base: { baseRevision?: number; baseHash?: string } = {},
): PushInput {
  return { op: "send", kind: payload.kind, uid: payload.uid, payload, ...base };
}

/** `items` is anything: the envelope tests send malformed ones on purpose. */
export async function push(
  server: TeamServer,
  token: string,
  items: readonly unknown[],
  epoch: number | null = 1,
): Promise<ApiAnswer> {
  return api(server, token, "POST", "/v1/push", { epoch, items });
}

/** Empties a bucket's key: takes ever smaller amounts until a single token is refused. */
export function drainBucket(bucket: Bucket, key: string): void {
  for (let amount = 1 << 26; amount >= 1; amount = Math.floor(amount / 2)) {
    while (bucket.take(key, amount).ok) {
      // keep taking
    }
  }
}

export async function pushOne(
  server: TeamServer,
  token: string,
  item: PushInput,
): Promise<PushResult> {
  const answer = await push(server, token, [item]);
  if (answer.status !== 200)
    throw new Error(`push failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  return answer.body.results[0] as PushResult;
}

// --- Pull -------------------------------------------------------------------------------

export interface PullInput {
  since?: number;
  limit?: number;
  projects?: readonly string[];
  wait?: number;
  scope?: "all" | "project";
}

/** The query string of a pull, each alias URL-encoded by `URLSearchParams`. */
export function pullQuery(input: PullInput): string {
  const params = new URLSearchParams();
  params.set("since", String(input.since ?? 0));
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.projects !== undefined) params.set("projects", input.projects.join(","));
  if (input.wait !== undefined) params.set("wait", String(input.wait));
  if (input.scope !== undefined) params.set("scope", input.scope);
  return params.toString();
}

export function pull(server: TeamServer, token: string, input: PullInput): Promise<ApiAnswer> {
  return api(server, token, "GET", `/v1/pull?${pullQuery(input)}`);
}

export interface PullPageBody {
  serverId: string;
  instance: string;
  next: number;
  more: boolean;
  snapshot: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: the tests read whatever the server answered
  items: any[];
}

/** A pull that must answer 200; the page. */
export async function pullAll(
  server: TeamServer,
  token: string,
  input: PullInput,
): Promise<PullPageBody> {
  const answer = await pull(server, token, input);
  if (answer.status !== 200)
    throw new Error(`pull failed: ${answer.status} ${JSON.stringify(answer.body)}`);
  return answer.body as PullPageBody;
}

/**
 * A large feed: `rows` current entry rows under other aliases and `aliasRows` under `alias`,
 * written straight into `changes` (no payload rows: the pull test that reads them asks for
 * tombstones). For the query-plan and the timing cases.
 */
export function seedFeed(db: Db, rows: number, alias: string, aliasRows: number): void {
  const insert = db.prepare(
    `INSERT INTO changes (kind, uid, key, op, scope, remote_alias, revision, hash, moved_to, member_id, device_id, client_epoch, at, current)
     VALUES ('entry', ?, ?, 'tombstone', 'project', ?, 1, 'h', NULL, 'm', 'd', NULL, 1, 1)`,
  );
  db.transaction(() => {
    for (let i = 0; i < rows; i++) {
      const other = `remote:github.com/other/repo-${i % 50}`;
      insert.run(`project:${other}:seed-${i}`, `seed-${i}`, other);
    }
    for (let i = 0; i < aliasRows; i++) {
      insert.run(`project:${alias}:named-${i}`, `named-${i}`, alias);
    }
  })();
}

export { LIMITS };
