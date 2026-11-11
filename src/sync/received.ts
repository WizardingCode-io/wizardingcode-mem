// The received store (ADR 0027, D-6): teammates' entries as files under
// `knowledge/received/<serverId>/…`, verbatim so their hash is the server's, with their rows
// in `knowledge_received` (the module's index) and their `received` ledger rows. The folder is
// the truth: the sync's start re-indexes it. Every path is built from checked components,
// followed through real folders only, and looked at with the store's own guards.
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEntry } from "../modules/knowledge/entry.ts";
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import {
  dropReceivedRow,
  indexReceivedRow,
  type ReceivedRow,
  receivedRow,
  receivedRows,
  receivedServerIds,
} from "../modules/knowledge/index-store.ts";
import {
  hashOf,
  kindAt,
  knowledgeRoot,
  lookAt,
  namesIn,
  reachedByFolders,
  readRegularFile,
  refuseLinkedRootsAt,
} from "../modules/knowledge/repo.ts";
import { aliasBoundTo } from "../sharing/levels.ts";
import { entryUid } from "../sharing/types.ts";
import { deleteReceivedMemory } from "../store/memories.ts";
import { writeFileAtomic } from "../util/atomic-write.ts";
import { projectByAlias } from "./conflicts.ts";
import type { SyncContext } from "./context.ts";
import {
  deleteReceivedRow,
  deleteReceivedRows,
  deleteUnbound,
  receivedMemoryIds,
  receivedMemoryServerIds,
  unboundAliases,
  writeReceivedEntryRow,
} from "./ledger.ts";
import { checkComponent, isComponent, receivedFolder, receivedRelativePath } from "./naming.ts";
import { listServers } from "./servers.ts";
import { guarded } from "./state.ts";

export const RECEIVED_DIR = "received";
/** Each project folder under a server's tree names its alias, so a re-index can read it. */
const FOLDER_MANIFEST = "knowledge.json";

/** `knowledge/received/` of a data directory. */
export const receivedRoot = (dataDir: string): string => join(knowledgeRoot(dataDir), RECEIVED_DIR);

/** The folder of one server's copies, after the root's and its own linked-root guards. */
export function serverFolder(dataDir: string, serverId: string): string {
  const root = receivedRoot(dataDir);
  refuseLinkedRootsAt(root);
  const folder = join(root, checkComponent("server", serverId));
  refuseLinkedRootsAt(folder);
  return folder;
}

/** The project an alias names here (`projectByAlias`), as the received rows store it: 0 when none. */
export function projectIdOf(ctx: SyncContext, alias: string | null): number {
  return alias === null ? 0 : (projectByAlias(ctx, alias) ?? 0);
}

/**
 * The index row of a received file from its parsed text and its provenance: the one place that
 * reads an entry's fields into a `ReceivedRow` (a text with a problem is a draft), for the
 * write of a pulled entry and for the re-index from disk alike.
 */
function receivedRowOf(
  parsed: ReturnType<typeof parseEntry>,
  provenance: Omit<
    ReceivedRow,
    | "id"
    | "title"
    | "kind"
    | "area"
    | "context"
    | "subject"
    | "status"
    | "author"
    | "version"
    | "body"
  >,
): ReceivedRow {
  return {
    ...provenance,
    id: parsed.id,
    title: parsed.title,
    kind: parsed.kind,
    area: parsed.area,
    context: parsed.context,
    subject: parsed.subject,
    status: parsed.problem === null ? parsed.status : "draft",
    author: parsed.author,
    version: parsed.version,
    body: parsed.body,
  };
}

/** A received entry as the feed hands it over. */
export interface ReceivedEntry {
  serverId: string;
  uid: string;
  scope: "workspace" | "shared" | "project";
  remoteAlias: string | null;
  member: { id: string; name: string };
  uuid: string;
  slug: string;
  /** `frontmatter + body` as the server holds it. */
  text: string;
  hash: string;
  revision: number;
}

/** A folder made through real folders only, 0700, with the alias manifest for a project folder. */
function ensureFolder(root: string, relativeFolder: string, alias: string | null): string {
  if (!reachedByFolders(root, `${relativeFolder}/x`))
    throw new KnowledgeError(
      "invalid",
      `${relativeFolder} is reached through a link, and the received store never follows one`,
    );
  const folder = join(root, ...relativeFolder.split("/"));
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  if (alias !== null) {
    const manifest = join(folder, FOLDER_MANIFEST);
    if (lookAt(manifest) === null) writeFileAtomic(manifest, `${JSON.stringify({ alias })}\n`);
  }
  return folder;
}

/**
 * Writes a received entry: the file first (verbatim, so `hashOf` equals the server's), then,
 * in one transaction, the `knowledge_received` row with its search row and the `received`
 * ledger row. The file's hash is checked against the server's; a mismatch is refused.
 */
export function writeReceived(
  ctx: SyncContext,
  entry: ReceivedEntry,
  options: { at: number; projectId?: number },
): { path: string; row: ReceivedRow } {
  const relative = receivedRelativePath(
    entry.serverId,
    entry.scope,
    entry.remoteAlias,
    entry.member,
    entry.uuid,
    entry.slug,
  );
  const bytes = Buffer.from(entry.text, "utf8");
  if (hashOf(bytes) !== entry.hash)
    throw new KnowledgeError("invalid", `${entry.uid}: the text's hash is not the server's`);
  const root = receivedRoot(ctx.dataDir);
  refuseLinkedRootsAt(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const serverDir = join(root, entry.serverId);
  mkdirSync(serverDir, { recursive: true, mode: 0o700 });
  refuseLinkedRootsAt(serverDir);
  const folderRelative = `${entry.serverId}/${receivedFolder(entry.scope, entry.remoteAlias, entry.member)}`;
  ensureFolder(root, folderRelative, entry.scope === "project" ? entry.remoteAlias : null);
  const target = join(root, ...relative.split("/"));
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  writeFileAtomic(target, bytes);
  const row = receivedRowOf(parseEntry(entry.text, entry.slug, null), {
    serverId: entry.serverId,
    uid: entry.uid,
    scope: entry.scope,
    remoteAlias: entry.remoteAlias,
    projectId: options.projectId ?? projectIdOf(ctx, entry.remoteAlias),
    memberId: entry.member.id,
    memberName: entry.member.name,
    slug: entry.slug,
    path: relative,
    hash: entry.hash,
    revision: entry.revision,
    receivedAt: options.at,
  });
  guarded(ctx, () => {
    indexReceivedRow(ctx.db, row);
    writeReceivedEntryRow(ctx, entry.serverId, entry.uid, entry.revision, entry.hash, options.at);
  });
  return { path: relative, row };
}

/** Removes a received entry: its file, then its rows; false when there was no row. */
export function deleteReceived(ctx: SyncContext, serverId: string, uid: string): boolean {
  const row = receivedRow(ctx.db, serverId, uid);
  if (row === null) return false;
  removeFile(ctx.dataDir, row.path);
  guarded(ctx, () => {
    dropReceivedRow(ctx.db, serverId, uid);
    deleteReceivedRow(ctx, serverId, "entry", uid);
  });
  return true;
}

/** A received file removed by its relative path, through real folders only; a link is left alone. */
function removeFile(dataDir: string, relative: string): void {
  const root = receivedRoot(dataDir);
  if (kindAt(root) !== "folder") return;
  if (!reachedByFolders(root, relative)) return;
  const path = join(root, ...relative.split("/"));
  const found = lookAt(path);
  if (found === null || !found.isFile()) return;
  rmSync(path, { force: true });
}

/** A server's `.md` files under its tree, by folder: `shared`, `members/<id>`, `projects/<folder>`. */
function filesOf(
  dataDir: string,
  serverId: string,
): { folder: string; alias: string | null; member: string | null; names: string[] }[] {
  const serverDir = serverFolder(dataDir, serverId);
  if (kindAt(serverDir) !== "folder") return [];
  const found: { folder: string; alias: string | null; member: string | null; names: string[] }[] =
    [];
  const entriesOf = (relativeFolder: string) => {
    const folder = join(serverDir, ...relativeFolder.split("/"), "entries");
    const kind = kindAt(folder);
    if (kind === "absent") return [];
    if (kind !== "folder") throw new KnowledgeError("invalid", `${folder} is not a folder`);
    return namesIn(folder).filter((name) => name.endsWith(".md"));
  };
  if (kindAt(join(serverDir, "shared")) === "folder")
    found.push({ folder: "shared", alias: null, member: null, names: entriesOf("shared") });
  for (const group of ["members", "projects"] as const) {
    const groupDir = join(serverDir, group);
    const kind = kindAt(groupDir);
    if (kind === "absent") continue;
    if (kind !== "folder") throw new KnowledgeError("invalid", `${groupDir} is not a folder`);
    for (const name of namesIn(groupDir)) {
      if (kindAt(join(groupDir, name)) !== "folder") continue;
      if (group === "members") {
        checkComponent("member", name);
        found.push({
          folder: `members/${name}`,
          alias: null,
          member: name,
          names: entriesOf(`members/${name}`),
        });
      } else {
        checkComponent("project-folder", name);
        const manifest = readRegularFile(join(groupDir, name, FOLDER_MANIFEST));
        let alias: string | null = null;
        try {
          alias =
            manifest === null
              ? null
              : ((JSON.parse(new TextDecoder().decode(manifest)) as { alias?: string }).alias ??
                null);
        } catch {
          alias = null;
        }
        found.push({
          folder: `projects/${name}`,
          alias,
          member: null,
          names: entriesOf(`projects/${name}`),
        });
      }
    }
  }
  return found;
}

/**
 * The folder as the truth: every file under each listed server's tree is indexed (a row kept
 * where it exists, made from the file where none does), and a row whose file is gone is
 * dropped. A folder that cannot be looked at is a refusal, never an empty folder, so no row
 * is dropped for a folder that is merely unreadable.
 */
export function reindexReceived(ctx: SyncContext): { indexed: number; dropped: number } {
  let indexed = 0;
  let dropped = 0;
  const now = ctx.clock.now;
  for (const server of listServers(ctx.db)) {
    if (!isComponent("server", server.serverId)) {
      // A row whose id the store writes no path for has no folder here: nothing to index.
      ctx.log(
        `${server.serverId}: not an id the received store writes a path for; no folder is looked for`,
      );
      continue;
    }
    const rows = new Map(receivedRows(ctx.db, server.serverId).map((row) => [row.path, row]));
    const seen = new Set<string>();
    const passedBy = new Set<string>();
    for (const group of filesOf(ctx.dataDir, server.serverId)) {
      for (const name of group.names) {
        const relative = `${server.serverId}/${group.folder}/entries/${name}`;
        seen.add(relative);
        const existing = rows.get(relative);
        const bytes = readRegularFile(join(receivedRoot(ctx.dataDir), ...relative.split("/")));
        if (bytes === null) continue;
        const hash = hashOf(bytes);
        if (existing !== undefined && existing.hash === hash) continue;
        const text = new TextDecoder().decode(bytes);
        const slug = name.replace(/--[0-9a-f]{8}\.md$/, "");
        const parsed = parseEntry(text, slug, null);
        const scope: ReceivedRow["scope"] =
          group.folder === "shared" ? "shared" : group.member !== null ? "workspace" : "project";
        // A project folder with no alias names no uid (`entryUid` refuses one): its files are
        // passed by rather than indexed under a uid nothing can parse, and the log says so once
        // per folder, since a tombstone of theirs would then leave the file where it is.
        if (existing === undefined && scope === "project" && group.alias === null) {
          if (!passedBy.has(group.folder)) {
            passedBy.add(group.folder);
            ctx.log(
              `${server.serverId}/${group.folder}: no manifest alias; its files are not indexed`,
            );
          }
          continue;
        }
        const uid = existing?.uid ?? entryUid(scope, group.alias, parsed.id);
        const row = receivedRowOf(parsed, {
          serverId: server.serverId,
          uid,
          scope,
          remoteAlias: existing?.remoteAlias ?? group.alias,
          projectId: existing?.projectId ?? projectIdOf(ctx, group.alias),
          memberId: existing?.memberId ?? group.member ?? "",
          memberName: existing?.memberName ?? "",
          slug,
          path: relative,
          hash,
          revision: existing?.revision ?? 0,
          receivedAt: existing?.receivedAt ?? now,
        });
        guarded(ctx, () => indexReceivedRow(ctx.db, row));
        indexed++;
      }
    }
    for (const [path, row] of rows) {
      if (seen.has(path)) continue;
      guarded(ctx, () => {
        dropReceivedRow(ctx.db, row.serverId, row.uid);
      });
      dropped++;
    }
  }
  return { indexed, dropped };
}

/**
 * The one owner of a server's received deletion: the folder (through the guards: a link or
 * an unreadable folder is a refusal), then in one transaction the rows, their search rows,
 * the received memories and the `received` ledger rows. Called by `remove` and by the sync's
 * start for an orphan server id.
 */
export function deleteServerReceived(
  ctx: SyncContext,
  serverId: string,
): { rows: number; memories: number } {
  const folder = serverFolder(ctx.dataDir, serverId);
  const kind = kindAt(folder);
  if (kind === "other") throw new KnowledgeError("invalid", `${folder} is not a folder of its own`);
  if (kind === "folder") rmSync(folder, { recursive: true, force: true });
  return guarded(ctx, () => {
    let rows = 0;
    for (const row of receivedRows(ctx.db, serverId)) {
      if (dropReceivedRow(ctx.db, row.serverId, row.uid)) rows++;
    }
    const memories = receivedMemoryIds(ctx.db, serverId, null);
    for (const id of memories) deleteReceivedMemory(ctx.db, id);
    deleteReceivedRows(ctx, serverId);
    return { rows, memories: memories.length };
  });
}

/**
 * The server ids with received rows, received memories, or a folder under the received root,
 * but no server row: what a crashed `remove` or a restore left, and what the start deletes.
 */
export function orphanServerIds(ctx: SyncContext): string[] {
  const listed = new Set(listServers(ctx.db).map((server) => server.serverId));
  const found = new Set([...receivedServerIds(ctx.db), ...receivedMemoryServerIds(ctx.db)]);
  const root = receivedRoot(ctx.dataDir);
  const kind = kindAt(root);
  if (kind === "other") refuseLinkedRootsAt(root);
  if (kind === "folder") {
    for (const name of namesIn(root)) if (isComponent("server", name)) found.add(name);
  }
  return [...found].filter((id) => !listed.has(id)).sort();
}

/**
 * Before a pull's first page: for each alias the unbound list holds for the server, when an
 * enabled project is bound under it again the row is dropped and nothing is deleted; else the
 * files go first, then, in one transaction, the rows, the search rows, the received memories,
 * their provenance rows and the unbound row. A failure is thrown to the caller, which holds
 * the page and retries at the next pull.
 */
export function reconcileReceived(ctx: SyncContext, serverId: string): { aliases: string[] } {
  const done: string[] = [];
  for (const { alias } of unboundAliases(ctx.db, serverId)) {
    if (aliasBoundTo(ctx.db, serverId, alias)) {
      deleteUnbound(ctx, serverId, alias);
      continue;
    }
    const rows = receivedRows(ctx.db, serverId).filter((row) => row.remoteAlias === alias);
    for (const row of rows) removeFile(ctx.dataDir, row.path);
    const folderRelative = `${serverId}/${receivedFolder("project", alias, null)}`;
    const root = receivedRoot(ctx.dataDir);
    if (kindAt(root) === "folder" && reachedByFolders(root, `${folderRelative}/x`)) {
      const folder = join(root, ...folderRelative.split("/"));
      if (kindAt(folder) === "folder") rmSync(folder, { recursive: true, force: true });
    }
    guarded(ctx, () => {
      for (const row of rows) {
        dropReceivedRow(ctx.db, serverId, row.uid);
        deleteReceivedRow(ctx, serverId, "entry", row.uid);
      }
      for (const id of receivedMemoryIds(ctx.db, serverId, alias)) deleteReceivedMemory(ctx.db, id);
      deleteUnbound(ctx, serverId, alias);
    });
    done.push(alias);
  }
  return { aliases: done };
}
