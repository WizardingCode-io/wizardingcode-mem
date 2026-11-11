// A teammate's revision of an own entry (ADR 0027, D-2 and D-8): applied to the file verbatim
// but for the local pin, the ledger moved to it, and, when a local edit was in flight, the
// person's text kept as a proposal with a conflicts row. The rollback test lives in the
// outbound side's answers; what reaches here is a revision the server holds above ours.
import { join } from "node:path";
import { agentName } from "../core/agent-name.ts";
import { parseEntry } from "../modules/knowledge/entry.ts";
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import { hashOf, openRepo, readRegularFile, statusOf } from "../modules/knowledge/repo.ts";
import { applyRevision, proposeConflict } from "../modules/knowledge/store.ts";
import { openStore } from "../modules/knowledge/store-open.ts";
import type { KnowledgeStore, ScopeRef, SyncWriter } from "../modules/knowledge/types.ts";
import { parseEntryUid } from "../team/contract.ts";
import type { SyncContext } from "./context.ts";
import { closeConflict, openConflicts, sentRow, writeApplied, writeConflict } from "./ledger.ts";
import { logError } from "./log.ts";
import type { ServerRow } from "./servers.ts";

export { closeConflict };

/** What the pull hands here: the server's revision of an own entry, its text whole. */
export interface RemoteRevision {
  uid: string;
  revision: number;
  hash: string;
  /** `frontmatter + body` as the server holds it. */
  text: string;
  member: { id: string; name: string };
}

export type ApplyOutcome =
  | { kind: "applied"; version: number; hash: string }
  | { kind: "conflict"; version: number; hash: string; proposalId: string }
  | {
      kind: "skipped";
      why: "not-own" | "echo" | "unknown" | "dirty" | "locked";
    };

/** The enabled project an alias names, the lowest id when two share it. */
export function projectByAlias(ctx: SyncContext, alias: string): number | null {
  return (
    ctx.db
      .query<{ project_id: number }, [string]>(
        `SELECT a.project_id FROM project_aliases a JOIN projects p ON p.id = a.project_id
          WHERE a.alias = ? AND p.disabled = 0 ORDER BY a.project_id LIMIT 1`,
      )
      .get(alias)?.project_id ?? null
  );
}

/** The repository reference an entry uid names on this machine; null when none. */
export function refOfUid(ctx: SyncContext, uid: string): ScopeRef | null {
  const parsed = parseEntryUid(uid);
  if (parsed === null) return null;
  if (parsed.scope !== "project") return { scope: parsed.scope };
  const projectId = projectByAlias(ctx, parsed.remoteAlias);
  return projectId === null ? null : { scope: "project", projectId };
}

interface Indexed {
  slug: string;
  path: string;
  hash: string;
}

function indexedEntry(ctx: SyncContext, repoId: number, uuid: string): Indexed | null {
  return ctx.db
    .query<Indexed, [number, string]>(
      "SELECT slug, path, hash FROM knowledge_entries WHERE repo_id = ? AND id = ?",
    )
    .get(repoId, uuid);
}

/**
 * Applies a teammate's revision to the person's own entry. Skipped when the uid is not an own
 * item of the server (a received copy is the received store's), when it is an echo of what
 * was sent, when the entry is unknown here, when its path is dirty (retried by the next pull)
 * or when another write holds the repository. Otherwise the file takes the text verbatim but
 * for the local `pinned` line, the `applied` row is written and the sent row moved, and, when
 * the file's hash before the apply differed from the sent row's `local_hash` (a local edit in
 * flight), the person's text becomes a proposal and a conflicts row keeps everything.
 */
export function applyOwnRevision(
  ctx: SyncContext,
  server: ServerRow,
  remote: RemoteRevision,
  knowledge?: KnowledgeStore,
): ApplyOutcome {
  const serverId = server.serverId;
  const own = sentRow(ctx.db, serverId, "entry", remote.uid);
  if (own === null) return { kind: "skipped", why: "not-own" };
  if (own.hash === remote.hash && own.version === remote.revision)
    return { kind: "skipped", why: "echo" };
  const parsed = parseEntryUid(remote.uid);
  const ref = refOfUid(ctx, remote.uid);
  if (parsed === null || ref === null) return { kind: "skipped", why: "unknown" };
  const store =
    knowledge ??
    openStore({ db: ctx.db, dataDir: ctx.dataDir, env: ctx.env, now: () => ctx.clock.now });
  const repo = openRepo(store, ref);
  if (repo === null) return { kind: "skipped", why: "unknown" };
  const indexed = indexedEntry(ctx, repo.id, parsed.uuid);
  if (indexed === null) return { kind: "skipped", why: "unknown" };
  if (statusOf(store, repo, [indexed.path]).length > 0) return { kind: "skipped", why: "dirty" };
  const bytes = readRegularFile(join(repo.path, ...indexed.path.split("/")));
  if (bytes === null) return { kind: "skipped", why: "unknown" };
  const localText = new TextDecoder().decode(bytes);
  // The file's own hash, not the index's: an edit committed by hand before the index was
  // refreshed is an edit in flight all the same.
  const fileHash = hashOf(bytes);
  const edited = own.localHash !== "" && own.localHash !== fileHash;
  const writer: SyncWriter = {
    kind: "sync",
    serverId,
    serverName: server.name,
    member: remote.member,
  };
  let applied: { version: number; hash: string };
  try {
    applied = applyRevision(store, ref, parsed.uuid, remote.text, writer, {
      uid: remote.uid,
      revision: remote.revision,
    });
  } catch (error) {
    if (error instanceof KnowledgeError && error.code === "locked")
      return { kind: "skipped", why: "locked" };
    throw error;
  }
  const at = ctx.clock.now;
  writeApplied(ctx, serverId, remote.uid, {
    revision: remote.revision,
    hash: remote.hash,
    localHash: applied.hash,
    instance: server.instance,
    at,
    // The ledger keeps the reviser's name as the agents see it (the hook's marker reads it),
    // the member id standing in for an empty one, as the git author does.
    reason: agentName(remote.member.name) || remote.member.id,
  });
  if (!edited) return { kind: "applied", ...applied };
  // The person's text, committed here and not yet sent, becomes a proposal on the new base.
  const local = parseEntry(localText, indexed.slug, null);
  let proposalId: string | null = null;
  try {
    proposalId = proposeConflict(store, ref, parsed.uuid, localText, writer, applied).id;
  } catch (error) {
    logError(ctx, serverId, "conflict", error);
  }
  writeConflict(ctx, serverId, remote.uid, {
    at,
    localText,
    localVersion: local.version,
    localHash: fileHash,
    serverRevision: remote.revision,
    serverHash: remote.hash,
    proposalId,
  });
  if (proposalId === null) return { kind: "applied", ...applied };
  return { kind: "conflict", ...applied, proposalId };
}

/**
 * At the sync's start: every open conflicts row whose proposal is no longer open, or is
 * gone, is closed, so a crash between the store's write and the close leaves no row open.
 */
export function closeOrphanConflicts(ctx: SyncContext, serverId?: string): number {
  let closed = 0;
  const now = ctx.clock.now;
  for (const row of openConflicts(ctx.db, serverId)) {
    if (row.proposalId === null) continue;
    const state = ctx.db
      .query<{ state: string }, [string]>("SELECT state FROM knowledge_proposals WHERE id = ?")
      .get(row.proposalId)?.state;
    if (state === "open") continue;
    closed += closeConflict(ctx.db, row.proposalId, now);
  }
  return closed;
}
