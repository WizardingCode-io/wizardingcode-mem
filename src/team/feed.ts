// The pull: the feed's current rows after a cursor, in the scopes and aliases a device names,
// paged by count and by bytes, with the wait that makes the sync near-live (D-11, D-13, D-22).
import { isHostLedAlias } from "../sharing/levels.ts";
import type { OutgoingMemory } from "../sharing/types.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import type { Context, Limits, Meta } from "./routes.ts";
import {
  type ChangeRow,
  changesSince,
  type FeedQuery,
  hasChanges,
  memberById,
  memoryByKey,
  revisionAt,
  sequenceHighWater,
} from "./store.ts";

export { explainChangesSince, explainHasChanges } from "./store.ts";

export interface PullQuery extends FeedQuery {
  wait: number;
}

export interface FeedItem {
  seq: number;
  kind: "entry" | "memory";
  uid: string;
  op: "upsert" | "tombstone" | "purge";
  scope: string;
  remoteAlias: string | null;
  revision: number;
  hash: string;
  movedTo?: string;
  payload?: { frontmatter: string; body: string } | OutgoingMemory;
  member: { id: string; name: string };
  device?: string;
  at: number;
}

export interface PullPage {
  serverId: string;
  instance: string;
  next: number;
  more: boolean;
  snapshot: boolean;
  items: FeedItem[];
}

type Ids = { serverId: string; instance: string };

/** A held pull re-reads the feed this often, so a write by another process is seen in time. */
export const REREAD_MS = 5_000;

const OPERATOR = { id: "operator", name: "operator" };

function integer(raw: string | null, name: string, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new HttpError(400, { error: name });
  return value;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The query string, checked: a bad value is 400 naming the parameter. */
export function parsePullQuery(url: URL, limits: Limits): PullQuery {
  const params = url.searchParams;
  const since = integer(params.get("since"), "since", 0);
  if (since < 0) throw new HttpError(400, { error: "since" });
  const limit = clamp(integer(params.get("limit"), "limit", limits.pullItems), 1, limits.pullItems);
  const wait = clamp(integer(params.get("wait"), "wait", 0), 0, limits.pullWaitSeconds);
  const rawProjects = params.get("projects") ?? "";
  const projects = rawProjects === "" ? [] : rawProjects.split(",");
  for (const alias of projects) {
    if (!isHostLedAlias(alias)) throw new HttpError(400, { error: "projects" });
  }
  const rawScope = params.get("scope") ?? "all";
  if (rawScope !== "all" && rawScope !== "project") throw new HttpError(400, { error: "scope" });
  if (rawScope === "project" && projects.length !== 1) throw new HttpError(400, { error: "scope" });
  return { since, limit, wait, projects, scope: rawScope };
}

/** A memory's key, `<device id>:<uid>`, split at its first colon. */
function splitKey(key: string): { deviceId: string; uid: string } {
  const colon = key.indexOf(":");
  return { deviceId: key.slice(0, colon), uid: key.slice(colon + 1) };
}

/** The row as a device reads it; the payload's byte count rides along for the page cut. */
function toItem(
  db: Db,
  row: ChangeRow,
  admin: boolean,
  names: Map<string, string>,
): { item: FeedItem; bytes: number } {
  let member = OPERATOR;
  if (row.member_id !== OPERATOR.id) {
    let name = names.get(row.member_id);
    if (name === undefined) {
      name = memberById(db, row.member_id)?.name ?? row.member_id;
      names.set(row.member_id, name);
    }
    member = { id: row.member_id, name };
  }
  const item: FeedItem = {
    seq: row.seq,
    kind: row.kind,
    uid: row.uid,
    op: row.op,
    scope: row.scope,
    remoteAlias: row.remote_alias,
    revision: row.revision,
    hash: row.hash,
    member,
    at: row.at,
  };
  if (row.moved_to !== null) item.movedTo = row.moved_to;
  let bytes = 0;
  if (row.op === "upsert") {
    if (row.kind === "entry") {
      const revision = revisionAt(db, row.key, row.revision);
      if (revision !== null) {
        item.payload = { frontmatter: revision.frontmatter, body: revision.body };
        bytes = Buffer.byteLength(revision.frontmatter + revision.body, "utf8");
      }
    } else {
      const { deviceId, uid } = splitKey(row.key);
      const memory = memoryByKey(db, deviceId, uid);
      if (memory !== null) {
        item.payload = JSON.parse(memory.payload) as OutgoingMemory;
        bytes = memory.size;
      }
    }
  }
  if (admin) item.device = row.device_id;
  return { item, bytes };
}

/** One page: 410 for a cursor past the sequence; the rows read, stopping at the byte cap. */
export function pull(
  db: Db,
  query: FeedQuery,
  viewer: { admin: boolean },
  limits: Limits,
  ids: Ids,
): PullPage {
  if (query.since > sequenceHighWater(db, "changes")) {
    throw new HttpError(410, { error: "cursor ahead of this server", fullPull: true });
  }
  const rows = changesSince(db, { ...query, limit: query.limit + 1 });
  let more = rows.length > query.limit;
  const items: FeedItem[] = [];
  const names = new Map<string, string>();
  let bytes = 0;
  for (const row of rows.slice(0, query.limit)) {
    const next = toItem(db, row, viewer.admin, names);
    if (items.length > 0 && bytes + next.bytes > limits.pullBytes) {
      more = true;
      break;
    }
    bytes += next.bytes;
    items.push(next.item);
  }
  const last = items[items.length - 1];
  return {
    ...ids,
    next: last === undefined ? query.since : last.seq,
    more,
    snapshot: query.since === 0,
    items,
  };
}

/**
 * A pull that finds rows answers at once; otherwise it waits on the change signal, re-reading
 * every `REREAD_MS` (a write from another process) until a row shows, the wait is spent, or
 * the server closes the signal, then answers the empty page.
 */
export async function pullWithWait(
  ctx: Context,
  query: PullQuery,
  viewer: { admin: boolean },
  meta: Meta,
): Promise<PullPage> {
  const ids = (): Ids => ({ serverId: ctx.serverId, instance: ctx.instance() });
  const first = pull(ctx.db, query, viewer, ctx.limits, ids());
  if (first.items.length > 0 || query.wait === 0) return first;
  const started = ctx.now();
  const deadline = started + query.wait * 1000;
  for (;;) {
    const remaining = deadline - ctx.now();
    if (remaining <= 0 || ctx.signal.isClosed()) break;
    await ctx.signal.wait(Math.min(remaining, REREAD_MS));
    if (hasChanges(ctx.db, query)) {
      meta.held = ctx.now() - started;
      return pull(ctx.db, query, viewer, ctx.limits, ids());
    }
  }
  meta.held = ctx.now() - started;
  return { ...ids(), next: query.since, more: false, snapshot: false, items: [] };
}
