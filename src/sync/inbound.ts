// The inbound side (ADR 0027): one pull of a server and the apply of its page. The main pull
// names the sticky main set of up to 100 bound aliases and holds; the extra aliases are pulled
// alone at the sixty-second mark; a newly bound alias gets a one-alias snapshot; the reconcile
// of unbound aliases runs before a pull's first page; every row kind of the feed is applied
// row by row under the lease, idempotently, the cursor saved after the page.
import { createHash } from "node:crypto";
import { isTeamAlias, TEAM_ALIAS_SQL } from "../core/identity.ts";
import { type Redacted, redact } from "../core/redact.ts";
import { MEMORY_KINDS, type MemoryKind } from "../core/types.ts";
import { parseEntry, slugify } from "../modules/knowledge/entry.ts";
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import { receivedRow } from "../modules/knowledge/index-store.ts";
import { openStore } from "../modules/knowledge/store-open.ts";
import type { KnowledgeStore } from "../modules/knowledge/types.ts";
import { aliasBoundTo, boundAliasesOf } from "../sharing/levels.ts";
import { loadPolicy } from "../sharing/policy.ts";
import type { OutgoingMemory, SharingPolicy } from "../sharing/types.ts";
import {
  deleteReceivedMemory,
  insertReceivedMemory,
  updateReceivedMemory,
} from "../store/memories.ts";
import { type FeedItemShape, type PullPageShape, parseEntryUid } from "../team/contract.ts";
import { type ClientFailed, SyncClient } from "./client.ts";
import { applyOwnRevision } from "./conflicts.ts";
import type { SyncContext } from "./context.ts";
import {
  clearSent,
  deletePendingRows,
  deletePendingRowsUpTo,
  deleteReceivedMemoryRow,
  entryLedgerUids,
  markWithdrawn,
  pendingRows,
  purgedKey,
  receivedMemoryLedger,
  receivedMemoryRow,
  sentRow,
  writePendingRow,
  writeReceivedMemoryRow,
} from "./ledger.ts";
import { logError } from "./log.ts";
import { deleteReceived, projectIdOf, reconcileReceived, writeReceived } from "./received.ts";
import type { PullOutcome } from "./run.ts";
import {
  acceptableContract,
  heldByContract,
  readTokens,
  type ServerRow,
  type Stopped,
  setContract,
  setInstance,
  setStopped,
} from "./servers.ts";
import {
  type CursorRef,
  clearName,
  cursorsOf,
  failureAnswer,
  flaggedNames,
  flagName,
  guarded,
  recordAnswer,
  setCursor,
  updateCursors,
  updateState,
} from "./state.ts";

/** The main pull names at most this many aliases (the server's `aliasesPerPull`). */
export const MAIN_SET = 100;
/** The server holds a pull this long; the client's deadline adds ten seconds. */
export const PULL_WAIT_S = 25;
export const PULL_DEADLINE_MS = 35_000;
/** A row whose target is dirty or locked is retried this many times before it is set aside. */
export const PENDING_AFTER_TRIES = 10;
/** A pending row is re-applied from its payload this often. */
export const PENDING_RETRY_MS = 3_600_000;

export interface PullResult extends PullOutcome {
  applied: number;
  skipped: number;
  /** The row the cursor stopped at, when a target was dirty or locked. */
  stoppedAt: number | null;
}

// --- The aliases the pull names -----------------------------------------------------------------

/**
 * The aliases the pull names: the team aliases of the enabled projects bound to the server above
 * Nothing, by bytes, less the shared names while the server speaks 1 (ADR 0028: names held).
 */
export function boundAliases(ctx: SyncContext, server: ServerRow): string[] {
  return boundAliasesOf(ctx.db, server.serverId).filter((alias) => !heldByContract(server, alias));
}

/**
 * The main set and the extras as this pull names them (D-9, as the server answers it): an alias
 * in the main set stays while it is named; one that stops being named leaves; a free slot is
 * filled by the first extra alias by its bytes; a new alias joins the main set first when a
 * slot is free. The aliases that joined the main set get a one-alias snapshot.
 */
export function planAliases(
  current: { mainAliases: string[]; extra: Record<string, number> },
  named: string[],
): { main: string[]; extra: string[]; joined: string[] } {
  const namedSet = new Set(named);
  const main = current.mainAliases.filter((alias) => namedSet.has(alias));
  const inMain = new Set(main);
  const rest = named.filter((alias) => !inMain.has(alias));
  const joined: string[] = [];
  for (const alias of rest) {
    if (main.length >= MAIN_SET) break;
    main.push(alias);
    inMain.add(alias);
    joined.push(alias);
  }
  const extra = rest.filter((alias) => !inMain.has(alias));
  return { main, extra, joined };
}

/**
 * The person joined a re-created name again (ADR 0028): its flag goes, and the alias leaves the
 * main set and its extra cursor, so the next pull reads it from the start as a newly bound alias
 * and applies the items the flag had skipped.
 */
export function rejoinName(ctx: SyncContext, serverId: string, alias: string): void {
  clearName(ctx, serverId, alias, "recreated");
  updateCursors(ctx, serverId, (cursors) => {
    const { [alias]: _dropped, ...extra } = cursors.extra;
    return { ...cursors, mainAliases: cursors.mainAliases.filter((each) => each !== alias), extra };
  });
}

// --- The page's rows --------------------------------------------------------------------------------

const memoryKindOf = (kind: string): MemoryKind =>
  (MEMORY_KINDS as readonly string[]).includes(kind) ? (kind as MemoryKind) : "discovery";
const importanceOf = (value: number): number =>
  Math.min(5, Math.max(1, Math.round(Number.isFinite(value) ? value : 3)));
const statusOf = (status: string): "active" | "superseded" | "archived" =>
  status === "superseded" || status === "archived" ? status : "active";

/** The `(title, body)` hash the dedupe of copied stores compares (ADR 0026). */
export const dedupeKey = (title: string, body: string): string =>
  createHash("sha256").update(`${title}\n${body}`).digest("hex").slice(0, 16);

/** The dedupe map of a project's memories, built once per page outside the transaction. */
export function dedupeKeys(ctx: SyncContext, projectId: number): Map<string, number> {
  const rows = ctx.db
    .query<{ id: number; title: string; body: string }, [number]>(
      "SELECT id, title, body FROM memories WHERE project_id = ?",
    )
    .all(projectId);
  return new Map(rows.map((row) => [dedupeKey(row.title, row.body), row.id]));
}

type Outcome = "applied" | "skipped" | "retry";

interface Page {
  server: ServerRow;
  client: SyncClient;
  knowledge: KnowledgeStore;
  dedupe: Map<number, Map<string, number>>;
  /** The policy as loaded for this pull: the level rows' name ids, for the re-created check. */
  policy: SharingPolicy;
}

/**
 * The name re-created on the server (ADR 0028): an `upsert` under a shared name whose `nameId`
 * is not null and differs from the id the level row bound to that name holds. The item is
 * skipped and the name flagged, with the new id and the item's member; the person joins again.
 * A level row with no id (a binding written before the registry held one) has nothing to
 * compare and is never flagged.
 */
function recreatedName(ctx: SyncContext, page: Page, item: FeedItemShape): boolean {
  if (item.nameId === null || item.remoteAlias === null) return false;
  const row = [...page.policy.levels.values()].find(
    (level) => level.destination === page.server.serverId && level.boundAlias === item.remoteAlias,
  );
  if (row === undefined || row.nameId === null || row.nameId === item.nameId) return false;
  flagName(ctx, page.server.serverId, item.remoteAlias, "recreated", {
    id: item.nameId,
    member: item.member,
  });
  return true;
}

/** One feed row applied; `retry` when its target is dirty or locked (the cursor stops at it). */
function applyRow(ctx: SyncContext, page: Page, item: FeedItemShape): Outcome {
  const { server } = page;
  const serverId = server.serverId;
  const at = ctx.clock.now;
  if (item.kind === "entry") {
    if (item.op === "upsert") {
      const own = sentRow(ctx.db, serverId, "entry", item.uid);
      if (own !== null) {
        if (own.hash === item.hash) return "skipped";
        if (item.payload === undefined || !("frontmatter" in item.payload)) return "skipped";
        const outcome = applyOwnRevision(
          ctx,
          server,
          {
            uid: item.uid,
            revision: item.revision,
            hash: item.hash,
            text: item.payload.frontmatter + item.payload.body,
            member: item.member,
          },
          page.knowledge,
        );
        if (outcome.kind === "skipped" && (outcome.why === "dirty" || outcome.why === "locked"))
          return "retry";
        return outcome.kind === "skipped" ? "skipped" : "applied";
      }
      const existing = receivedRow(ctx.db, serverId, item.uid);
      if (existing !== null && existing.hash === item.hash) return "skipped";
      if (item.payload === undefined || !("frontmatter" in item.payload)) return "skipped";
      if (recreatedName(ctx, page, item)) return "skipped";
      const parsed = parseEntryUid(item.uid);
      if (parsed === null) return "skipped";
      const text = item.payload.frontmatter + item.payload.body;
      const entry = parseEntry(text, "x", null);
      writeReceived(
        ctx,
        {
          serverId,
          uid: item.uid,
          scope: parsed.scope,
          remoteAlias: parsed.remoteAlias,
          member: item.member,
          uuid: parsed.uuid,
          // The feed carries no slug: the title's, as the entry module slugs it.
          slug: slugify(entry.title),
          text,
          hash: item.hash,
          revision: item.revision,
        },
        { at },
      );
      return "applied";
    }
    // A tombstone or a purge of an entry.
    const own = sentRow(ctx.db, serverId, "entry", item.uid);
    if (own !== null) {
      if (item.op === "purge") purgedKey(ctx, serverId, "entry", item.uid, at);
      else if (own.withdrawnAt === null)
        markWithdrawn(ctx, serverId, "entry", item.uid, at, "withdrawn-by-admin");
      return "applied";
    }
    if (
      item.op === "tombstone" &&
      item.movedTo !== undefined &&
      readsRange(ctx, serverId, item.movedTo)
    ) {
      // The upsert under the new range follows in the same page; the copy is left for it.
      return "skipped";
    }
    return deleteReceived(ctx, serverId, item.uid) ? "applied" : "skipped";
  }
  // A memory row.
  if (item.op === "upsert") {
    const payload = item.payload as OutgoingMemory | undefined;
    if (payload === undefined || !("memoryKind" in payload)) return "skipped";
    if (item.member.id === server.memberId && item.device === undefined) {
      // This member's own: an echo of this device, or another device's. Only an admin's
      // feed names the device; without it the uid's alias tells this device from another.
      if (item.uid.startsWith(`remote:${server.deviceAlias}:`)) return "skipped";
    }
    const projectId = projectIdOf(ctx, item.remoteAlias);
    if (projectId === 0) return "skipped";
    const known = receivedMemoryRow(ctx.db, serverId, item.uid);
    if (known !== null && known.hash === item.hash) return "skipped";
    if (recreatedName(ctx, page, item)) return "skipped";
    const dedupe = page.dedupe.get(projectId) ?? dedupeKeys(ctx, projectId);
    page.dedupe.set(projectId, dedupe);
    const key = dedupeKey(payload.title, payload.body);
    const provenance = {
      serverId,
      remoteUid: item.uid,
      memberId: item.member.id,
      memberName: item.member.name,
      revision: item.revision,
      hash: item.hash,
      remoteKind: payload.memoryKind,
      remoteImportance: payload.importance,
      remoteStatus: payload.status,
    };
    const same = dedupe.get(key);
    // Every write of the memory row goes through the store's own writers (src/store/memories.ts).
    guarded(ctx, () => {
      if (known !== null && known.memoryId !== null) {
        // A later revision of a known uid: the row updated, or deduped when it now equals another.
        if (same !== undefined && same !== known.memoryId) {
          deleteReceivedMemory(ctx.db, known.memoryId);
          writeReceivedMemoryRow(ctx, { ...provenance, memoryId: null }, item.uid, at);
        } else {
          updateReceivedMemory(ctx.db, known.memoryId, {
            kind: memoryKindOf(payload.memoryKind),
            title: payload.title,
            body: payload.body as Redacted,
            importance: importanceOf(payload.importance),
            status: statusOf(payload.status),
            createdAt: payload.createdAt,
            now: at,
          });
          dedupe.set(key, known.memoryId);
          writeReceivedMemoryRow(ctx, { ...provenance, memoryId: known.memoryId }, item.uid, at);
        }
        return;
      }
      if (same !== undefined) {
        // The dedupe of copied stores: not inserted, its received row written all the same.
        writeReceivedMemoryRow(ctx, { ...provenance, memoryId: null }, item.uid, at);
        return;
      }
      const memoryId = insertReceivedMemory(
        ctx.db,
        {
          projectId,
          kind: memoryKindOf(payload.memoryKind),
          title: payload.title,
          body: payload.body as Redacted,
          terms: "",
          importance: importanceOf(payload.importance),
          branch: null,
          commit: null,
          origin: "imported",
          judge: `team:${serverId}`,
          judgeVersion: "1",
          sourceTurnId: null,
          files: [],
          now: at,
        },
        { status: statusOf(payload.status), createdAt: payload.createdAt },
      );
      dedupe.set(key, memoryId);
      writeReceivedMemoryRow(ctx, { ...provenance, memoryId }, item.uid, at);
    });
    return "applied";
  }
  // A memory tombstone or purge: the copy goes through the one deletion.
  const known = receivedMemoryRow(ctx.db, serverId, item.uid);
  if (known === null) return "skipped";
  forgetReceivedMemory(ctx, serverId, item.uid, known.memoryId);
  return "applied";
}

/**
 * A received memory forgotten: through the store's `deleteReceivedMemory` when a memory row
 * holds it (which takes its provenance and ledger rows with it), else the ledger's row of a
 * deduped uid alone. One rule, two tables' owners.
 */
function forgetReceivedMemory(
  ctx: SyncContext,
  serverId: string,
  uid: string,
  memoryId: number | null,
): void {
  guarded(ctx, () => {
    if (memoryId !== null) deleteReceivedMemory(ctx.db, memoryId);
    else deleteReceivedMemoryRow(ctx, serverId, uid);
  });
}

/**
 * Whether this machine's pull of the server names the range an entry uid is in: every
 * workspace and shared item, and a project's while an enabled project is bound to the server
 * under its alias. A move into a range it does not read is a deletion here.
 */
function readsRange(ctx: SyncContext, serverId: string, uid: string): boolean {
  const parsed = parseEntryUid(uid);
  if (parsed === null) return false;
  if (parsed.scope !== "project") return true;
  return aliasBoundTo(ctx.db, serverId, parsed.remoteAlias);
}

/**
 * A page applied row by row, each row in one short transaction (the files and the vectors
 * happen outside it). A row whose target is dirty or locked stops the cursor at its `seq`
 * and is retried by the next pull; after ten tries it is set aside with its payload. A row
 * that fails for any other reason is set aside at once, its reason named, so no revision is
 * lost behind a moving cursor. The cursor is saved after the page, never moving backwards.
 */
function applyPage(
  ctx: SyncContext,
  page: Page,
  items: FeedItemShape[],
  tries: Map<string, number>,
): { applied: number; skipped: number; stoppedAt: number | null } {
  let applied = 0;
  let skipped = 0;
  const setAside = (item: FeedItemShape, reason: string, tried: number) => {
    writePendingRow(ctx, {
      serverId: page.server.serverId,
      seq: item.seq,
      uid: item.uid,
      kind: item.kind,
      payload: JSON.stringify(item),
      reason,
      tries: tried,
      at: ctx.clock.now,
    });
    tries.delete(item.uid);
    skipped++;
  };
  for (const item of items) {
    let outcome: Outcome;
    try {
      outcome = applyRow(ctx, page, item);
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === "locked") outcome = "retry";
      else {
        logError(ctx, page.server.serverId, "apply", error);
        const message = error instanceof Error ? error.message : String(error);
        setAside(item, `apply: ${redact(message).slice(0, 200)}`, 1);
        continue;
      }
    }
    if (outcome === "retry") {
      const tried = (tries.get(item.uid) ?? 0) + 1;
      tries.set(item.uid, tried);
      if (tried < PENDING_AFTER_TRIES) return { applied, skipped, stoppedAt: item.seq };
      setAside(item, "dirty or locked", tried);
      continue;
    }
    // A row of a uid that applied drops the uid's pending rows up to its seq: the one rule the
    // hourly re-apply follows too (a newer row set aside after a snapshot restart stays).
    deletePendingRowsUpTo(ctx, page.server.serverId, item.uid, item.seq);
    if (outcome === "applied") applied++;
    else skipped++;
  }
  return { applied, skipped, stoppedAt: null };
}

/** The retry counts per server, kept in memory across pulls. */
const retries = new Map<string, Map<string, number>>();
/** When each server's pending rows were last re-applied. */
const pendingTried = new Map<string, number>();
/** Where the rotation of the extra aliases stands per server. */
const extraCursor = new Map<string, number>();
/** When each server's extra aliases were last pulled. */
const extraPulled = new Map<string, number>();
/** The cursors whose snapshot completed, per server: a cut snapshot restarts from the first that did not. */
const snapshotDone = new Map<string, Set<string>>();

const cursorKey = (which: CursorRef): string =>
  which === "main" ? "main" : `extra:${which.extra}`;

/** Forgets the in-memory state: a test's clean slate. */
export function resetInbound(): void {
  retries.clear();
  pendingTried.clear();
  extraCursor.clear();
  extraPulled.clear();
  snapshotDone.clear();
}

// --- The failures -------------------------------------------------------------------------------

/** What a failed pull does to the server's row: a stop with its remedy, or a counted failure. */
function failed(ctx: SyncContext, server: ServerRow, failure: ClientFailed, at: number): void {
  const stop = (why: Stopped) => {
    setStopped(ctx.db, server.serverId, why);
    recordAnswer(ctx, server.serverId, { kind: "pull", ok: false, at, error: `stopped: ${why}` });
  };
  switch (failure.kind) {
    case "unauthorized":
      stop(
        failure.instance === null || failure.instance === server.instance
          ? "unauthorized"
          : "rejoin",
      );
      return;
    case "disabled":
      stop("disabled");
      return;
    case "contract":
      stop("contract");
      return;
    case "gone":
      updateState(ctx, server.serverId, { snapshotDue: true });
      recordAnswer(ctx, server.serverId, {
        kind: "pull",
        ok: false,
        at,
        error: "cursor gone: snapshot due",
      });
      return;
    case "aborted":
      return;
    default:
      recordAnswer(ctx, server.serverId, failureAnswer("pull", failure, at));
  }
}

// --- The pull -------------------------------------------------------------------------------------

/**
 * One pull of a server: the reconcile of unbound aliases, the aliases planned, a snapshot when
 * one is due (every cursor from zero until `more` is false, the flag cleared only after the
 * last), else the main cursor held with `wait` and, at the sixty-second mark, the extra aliases
 * in rotation; each page applied and its cursor saved.
 */
export async function pullOnce(
  ctx: SyncContext,
  server: ServerRow,
  options: { wait: boolean; signal?: AbortSignal },
): Promise<PullResult> {
  const serverId = server.serverId;
  const none: PullResult = { ok: true, held: false, applied: 0, skipped: 0, stoppedAt: null };
  const token = readTokens(ctx.dataDir)[serverId];
  if (token === undefined) return { ...none, ok: false };
  const client = new SyncClient(ctx, { url: server.url, token, contract: server.contract });
  const knowledge = openStore({
    db: ctx.db,
    dataDir: ctx.dataDir,
    env: ctx.env,
    now: () => ctx.clock.now,
  });
  const page: Page = {
    server,
    client,
    knowledge,
    dedupe: new Map(),
    policy: loadPolicy(ctx.db, ctx.dataDir, ctx.env, serverId),
  };
  const tries = retries.get(serverId) ?? new Map<string, number>();
  retries.set(serverId, tries);

  // Before the first page: the unbound aliases' copies go; a failure holds the page.
  try {
    reconcileReceived(ctx, serverId);
  } catch (error) {
    logError(ctx, serverId, "reconcile", error);
    recordAnswer(ctx, serverId, {
      kind: "pull",
      ok: false,
      at: ctx.clock.now,
      error: `reconcile: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { ...none, ok: false };
  }
  // The pending rows, re-applied from their payload once an hour, oldest first. A row that
  // applies drops itself and every older row of its uid (an older one that still fails must
  // never come back over the later revision); a newer row of the uid that still fails stays
  // set aside.
  const lastPending = pendingTried.get(serverId) ?? 0;
  if (ctx.clock.now - lastPending >= PENDING_RETRY_MS) {
    pendingTried.set(serverId, ctx.clock.now);
    for (const row of pendingRows(ctx.db, serverId)) {
      try {
        const item = JSON.parse(row.payload) as FeedItemShape;
        const outcome = applyRow(ctx, page, item);
        if (outcome !== "retry") deletePendingRowsUpTo(ctx, serverId, row.uid, row.seq);
      } catch (error) {
        logError(ctx, serverId, "pending", error);
      }
    }
  }

  const writePlan = (named: string[]) => {
    const planned = planAliases(cursorsOf(ctx.db, serverId), named);
    // The plan written back: the main set as named now, the extras' cursors kept.
    updateCursors(ctx, serverId, (current) => ({
      main: current.main,
      mainAliases: planned.main,
      extra: Object.fromEntries(planned.extra.map((alias) => [alias, current.extra[alias] ?? 0])),
    }));
    return planned;
  };
  let plan = writePlan(boundAliases(ctx, server));
  const result: PullResult = { ...none };
  // The live path down (ADR 0028): one 409 with an accepted value below the contract spoken
  // sets the row, re-plans without the shared names and repeats the request once; a second
  // 409 stops the server as `contract`.
  let downgraded = false;
  const fetchPage = async (input: {
    since: number;
    scope: "all" | "project";
    projects: string[];
    wait: number;
  }) => {
    const requestOptions = {
      deadlineMs: PULL_DEADLINE_MS,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    let answer = await client.pull(
      { since: input.since, scope: input.scope, projects: input.projects, wait: input.wait },
      requestOptions,
    );
    if (!answer.ok && answer.kind === "contract" && !downgraded) {
      const next = acceptableContract(answer.accepted, server.contract);
      if (next !== null) {
        downgraded = true;
        guarded(ctx, () => setContract(ctx.db, serverId, next));
        client.speak(next);
        server = { ...server, contract: next };
        page.server = server;
        plan = writePlan(boundAliases(ctx, server));
        const projects = input.projects.filter((alias) => !heldByContract(server, alias));
        if (input.scope === "project" && projects.length === 0) {
          // The one alias asked for is held now: nothing to read under it.
          return {
            serverId,
            instance: server.instance,
            next: input.since,
            more: false,
            snapshot: false,
            items: [],
          } satisfies PullPageShape;
        }
        answer = await client.pull(
          { since: input.since, scope: input.scope, projects, wait: input.wait },
          requestOptions,
        );
      }
    }
    const at = ctx.clock.now;
    if (!answer.ok) {
      failed(ctx, server, answer, at);
      return null;
    }
    recordAnswer(ctx, serverId, { kind: "pull", ok: true, at, requestId: answer.requestId });
    if (answer.body.instance !== server.instance) {
      // The server was rebuilt: the cursors belong to the old instance, and so does whatever
      // of a snapshot completed.
      guarded(ctx, () => {
        setInstance(ctx.db, serverId, answer.body.instance);
        deletePendingRows(ctx, serverId);
      });
      snapshotDone.delete(serverId);
      server = { ...server, instance: answer.body.instance, snapshotDue: true };
      page.server = server;
    }
    return answer.body;
  };
  const applyAndSave = (body: PullPageShape, which: CursorRef): boolean => {
    const outcome = applyPage(ctx, page, body.items, tries);
    result.applied += outcome.applied;
    result.skipped += outcome.skipped;
    if (outcome.stoppedAt !== null) {
      // The cursor stops just before the row; the next pull retries it.
      const before = body.items.filter((item) => item.seq < (outcome.stoppedAt as number));
      const last = before.at(-1)?.seq;
      if (last !== undefined) setCursor(ctx, serverId, which, last);
      result.stoppedAt = outcome.stoppedAt;
      return false;
    }
    setCursor(ctx, serverId, which, body.next);
    return true;
  };

  // A snapshot: every cursor from zero until `more` is false, each compared after its last
  // page over everything its pages showed; a cursor that completed is not pulled again when
  // a cut snapshot restarts, and the flag clears only after the last.
  if (server.snapshotDue) {
    const done = (): Set<string> => {
      let set = snapshotDone.get(serverId);
      if (set === undefined) {
        set = new Set();
        snapshotDone.set(serverId, set);
      }
      return set;
    };
    const targets: CursorRef[] = ["main", ...plan.extra.map((alias) => ({ extra: alias }))];
    for (const which of targets) {
      if (done().has(cursorKey(which))) continue;
      if (which !== "main" && heldByContract(server, which.extra)) continue;
      const seen = new Set<string>();
      const tombstoned = new Set<string>();
      let since = 0;
      for (;;) {
        const body = await fetchPage({
          since,
          scope: which === "main" ? "all" : "project",
          projects: which === "main" ? plan.main : [which.extra],
          wait: 0,
        });
        if (body === null) return { ...result, ok: false };
        for (const item of body.items) {
          seen.add(item.uid);
          if (item.kind === "entry" && item.op === "tombstone") tombstoned.add(item.uid);
        }
        if (!applyAndSave(body, which)) return { ...result, ok: false };
        if (!body.more) break;
        since = body.next;
      }
      compareSnapshot(ctx, serverId, which, plan, seen, tombstoned);
      done().add(cursorKey(which));
    }
    snapshotDone.delete(serverId);
    updateState(ctx, serverId, { snapshotDue: false });
    return result;
  }

  // A newly bound alias: its one-alias snapshot, after it joined the main set.
  for (const alias of plan.joined) {
    if (heldByContract(server, alias)) continue;
    let since = 0;
    for (;;) {
      const body = await fetchPage({ since, scope: "project", projects: [alias], wait: 0 });
      if (body === null) return { ...result, ok: false };
      const outcome = applyPage(ctx, page, body.items, tries);
      result.applied += outcome.applied;
      result.skipped += outcome.skipped;
      if (outcome.stoppedAt !== null || !body.more) break;
      since = body.next;
    }
  }

  // The main pull, held when asked.
  const main = await fetchPage({
    since: cursorsOf(ctx.db, serverId).main,
    scope: "all",
    projects: plan.main,
    wait: options.wait ? PULL_WAIT_S : 0,
  });
  if (main === null) return { ...result, ok: false };
  result.held = options.wait;
  if (!applyAndSave(main, "main")) return { ...result, ok: false };
  if (options.wait && main.items.length === 0) {
    // An empty held page back too soon: the server holds its cap for this device, or closed
    // the hold; the loop backs off as for a failure, and the extra aliases wait for the next
    // pull, so that their answer does not undo the backoff.
    const held = ctx.clock.now - (server.lastPullAt ?? 0);
    if (held < 1_000) {
      recordAnswer(ctx, serverId, {
        kind: "pull",
        ok: false,
        at: ctx.clock.now,
        error: "held pull answered at once",
      });
      return { ...result, ok: false };
    }
  }

  // The extra aliases, one each, at the sixty-second mark, in rotation.
  const extras = plan.extra;
  if (extras.length > 0 && ctx.clock.now - (extraPulled.get(serverId) ?? 0) >= 60_000) {
    extraPulled.set(serverId, ctx.clock.now);
    const start = extraCursor.get(serverId) ?? 0;
    const alias = extras[start % extras.length] as string;
    extraCursor.set(serverId, (start + 1) % extras.length);
    const body = await fetchPage({
      since: cursorsOf(ctx.db, serverId).extra[alias] ?? 0,
      scope: "project",
      projects: [alias],
      wait: 0,
    });
    if (body === null) return { ...result, ok: false };
    if (!applyAndSave(body, { extra: alias })) return { ...result, ok: false };
  }
  return result;
}

/** The team aliases of every project, by project id: what names a received memory's project. */
function projectAliases(ctx: SyncContext): Map<number, string[]> {
  const byProject = new Map<number, string[]>();
  for (const row of ctx.db
    .query<{ project_id: number; alias: string }, []>(
      `SELECT project_id, alias FROM project_aliases WHERE ${TEAM_ALIAS_SQL}`,
    )
    .all()) {
    if (!isTeamAlias(row.alias)) continue;
    const aliases = byProject.get(row.project_id) ?? [];
    aliases.push(row.alias);
    byProject.set(row.project_id, aliases);
  }
  return byProject;
}

/**
 * After a snapshot's last page, over every page of it and the cursor's own scopes and
 * aliases: a `received` entry row absent from it is dropped with its copy; a received memory
 * absent from it is deleted with its provenance (a deduped uid is forgotten, so a later copy
 * is weighed again); a `sent` row absent from it is cleared (re-sent on base 0); a tombstone
 * for a sent uid sets its row withdrawn by the admin. Nothing of the person's own is deleted.
 */
function compareSnapshot(
  ctx: SyncContext,
  serverId: string,
  which: CursorRef,
  plan: { main: string[] },
  seen: ReadonlySet<string>,
  tombstoned: ReadonlySet<string>,
): void {
  // A name flagged re-created is out of the comparison: its rows are neither counted as seen
  // nor dropped while the flag stands (ADR 0028).
  const flagged = flaggedNames(ctx.db, serverId);
  const aliases = (which === "main" ? plan.main : [which.extra]).filter(
    (alias) => flagged.get(alias) !== "recreated",
  );
  const inScope = (uid: string) => {
    const parsed = parseEntryUid(uid);
    if (parsed === null) return false;
    if (parsed.scope === "project") return aliases.includes(parsed.remoteAlias);
    return which === "main";
  };
  for (const row of entryLedgerUids(ctx.db, serverId)) {
    if (seen.has(row.uid) || !inScope(row.uid)) continue;
    if (row.direction === "received") deleteReceived(ctx, serverId, row.uid);
    else clearSent(ctx, serverId, "entry", row.uid);
  }
  // A memory's project tells its alias; a deduped row names no memory, so the main cursor,
  // which names every bound alias, owns it.
  const byProject = projectAliases(ctx);
  const memoryInScope = (projectId: number | null) =>
    projectId === null
      ? which === "main"
      : (byProject.get(projectId) ?? []).some((alias) => aliases.includes(alias));
  for (const row of receivedMemoryLedger(ctx.db, serverId)) {
    if (seen.has(row.uid) || !memoryInScope(row.projectId)) continue;
    forgetReceivedMemory(ctx, serverId, row.uid, row.memoryId);
  }
  for (const uid of tombstoned) {
    const own = sentRow(ctx.db, serverId, "entry", uid);
    if (own !== null && own.withdrawnAt === null)
      markWithdrawn(ctx, serverId, "entry", uid, ctx.clock.now, "withdrawn-by-admin");
  }
}
