// The pull: the feed's current rows after a cursor, in the scopes and aliases a device names,
// paged by count and by bytes, with the wait that makes the sync near-live (D-11, D-13, D-22).
import { isHostLedAlias } from "../sharing/levels.ts";
import type { OutgoingMemory } from "../sharing/types.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./errors.ts";
import { OPERATOR_ID, splitMemoryKey } from "./ids.ts";
import {
  type ChangeRow,
  changesSince,
  type FeedQuery,
  hasChanges,
  memberById,
  memoryByKey,
  readTransaction,
  revisionAt,
  sequenceHighWater,
} from "./store.ts";
import type { Context, Limits, Meta } from "./types.ts";

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

const OPERATOR_MEMBER = { id: OPERATOR_ID, name: OPERATOR_ID };

function integer(raw: string | null, name: string, fallback: number): number {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new HttpError(400, { error: name });
  return value;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The query string, checked: a bad value is 400 naming the parameter; the aliases de-duplicated and capped. */
export function parsePullQuery(url: URL, limits: Limits): PullQuery {
  const params = url.searchParams;
  const since = integer(params.get("since"), "since", 0);
  if (since < 0) throw new HttpError(400, { error: "since" });
  const limit = clamp(integer(params.get("limit"), "limit", limits.pullItems), 1, limits.pullItems);
  const wait = clamp(integer(params.get("wait"), "wait", 0), 0, limits.pullWaitSeconds);
  const rawProjects = params.get("projects") ?? "";
  const projects = rawProjects === "" ? [] : [...new Set(rawProjects.split(","))];
  if (projects.length > limits.aliasesPerPull) throw new HttpError(400, { error: "projects" });
  for (const alias of projects) {
    if (!isHostLedAlias(alias)) throw new HttpError(400, { error: "projects" });
  }
  const rawScope = params.get("scope") ?? "all";
  if (rawScope !== "all" && rawScope !== "project") throw new HttpError(400, { error: "scope" });
  if (rawScope === "project" && projects.length !== 1) throw new HttpError(400, { error: "scope" });
  return { since, limit, wait, projects, scope: rawScope };
}

/** The row as a device reads it; the payload's byte count rides along for the page cut. */
function toItem(
  db: Db,
  row: ChangeRow,
  admin: boolean,
  names: Map<string, string>,
): { item: FeedItem; bytes: number } {
  let member = OPERATOR_MEMBER;
  if (row.member_id !== OPERATOR_ID) {
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
      const { deviceId, uid } = splitMemoryKey(row.key);
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

/**
 * One page, read in one snapshot: 410 for a cursor past the sequence; the rows and their
 * payloads, stopping at the byte cap, so a write from another process lands before or after
 * the page and never inside it.
 */
export function pull(
  db: Db,
  query: FeedQuery,
  viewer: { admin: boolean },
  limits: Limits,
  ids: Ids,
): PullPage {
  return readTransaction(db, () => {
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
  });
}

/**
 * A pull that finds rows answers at once; otherwise it waits on the change signal, re-reading
 * every `REREAD_MS` (a write from another process) until a row shows, the wait is spent, or
 * the server closes the signal, then answers the empty page. A device past its share of held
 * pulls gets the empty page at once.
 */
export async function pullWithWait(
  ctx: Context,
  query: PullQuery,
  viewer: { admin: boolean; deviceId: string },
  meta: Meta,
): Promise<PullPage> {
  const ids = (): Ids => ({ serverId: ctx.serverId, instance: ctx.instance() });
  const first = pull(ctx.db, query, viewer, ctx.limits, ids());
  if (first.items.length > 0 || query.wait === 0) return first;
  const empty = (): PullPage => ({
    ...ids(),
    next: query.since,
    more: false,
    snapshot: false,
    items: [],
  });
  const holding = ctx.held.get(viewer.deviceId) ?? 0;
  if (holding >= ctx.limits.heldPullsPerDevice) return empty();
  ctx.held.set(viewer.deviceId, holding + 1);
  const started = ctx.now();
  try {
    const deadline = started + query.wait * 1000;
    for (;;) {
      const remaining = deadline - ctx.now();
      if (remaining <= 0 || ctx.signal.isClosed()) break;
      await ctx.signal.wait(Math.min(remaining, REREAD_MS));
      if (hasChanges(ctx.db, query)) return pull(ctx.db, query, viewer, ctx.limits, ids());
    }
    return empty();
  } finally {
    meta.held = ctx.now() - started;
    const left = (ctx.held.get(viewer.deviceId) ?? 1) - 1;
    if (left <= 0) ctx.held.delete(viewer.deviceId);
    else ctx.held.set(viewer.deviceId, left);
  }
}
