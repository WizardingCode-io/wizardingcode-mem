// The viewer's client for /api. The token comes from the URL the binary opened.
import type { HistoryOffer, HistoryProgress, HistoryStatus, PastSearch } from "./history";
import type { LinkKind, LinksList, LinksOffer, LinkView, RulesList } from "./links";
import type { ModuleInfo } from "./modules";
import type { SemanticStatus } from "./semantic";
import type { Level, Reason, Root } from "../../src/sharing/types.ts";

// The levels, their labels and the Sharing page's patch are the engine's own, shared as
// `modules.ts` shares the memory module's views: one rule, read by the server and the page.
export { LEVEL_LABELS, LEVELS, type Level, type Root, widens } from "../../src/sharing/types.ts";
export { buildSharingPatch } from "../../src/sharing/patch.ts";
export type { SemanticStatus } from "./semantic";
export type { ModuleInfo, ModuleViewInfo } from "./modules";
export type { AcceptedRule, LinkKind, LinksList, LinksOffer, LinkView, ProposedRule, RulesList } from "./links";
export type { HistoryOffer, HistoryProgress, HistoryQueue, HistoryRun, HistoryRunState, HistoryStatus, PastSearch, PastTurn } from "./history";

export const TOKEN = new URLSearchParams(location.search).get("token") ?? "";

export interface Project {
  id: number;
  name: string;
  key: string;
  active: number;
  archived: number;
  superseded: number;
  stale: number;
  lastActivity: number | null;
  /** What it shares with the team's server, as the policy reads now. */
  sharing: Level;
  /** `allowed` for a level in force, else what makes it share nothing. */
  sharingReason: Reason;
  /** It has a host-led git remote, one name a team can match it by. */
  remote: boolean;
  /** The slug of its shared name (ADR 0028), the other name a team can match it by; null without one. */
  sharedName: string | null;
  /** What the level in force is bound by; null at Nothing. */
  boundTo: "remote" | "name" | null;
  /** Its imported memories, which stay on this machine whatever the level. */
  imported: number;
  /** The bound shared name's state; null when the level is not bound by a name. */
  nameState: "ok" | "missing" | "recreated" | "purged" | null;
  /** Memory is off for it. */
  disabled: boolean;
  /** The server its level binds it to; null when none. */
  server: { id: string; name: string } | null;
}
/** One shared name on a server, as its registry lists it (ADR 0028). */
export interface NameItem {
  alias: string;
  id: string;
  createdAt: number;
  createdBy: { id: string; name: string };
  entries: number;
  memories: number;
  lastChangeAt: number | null;
}
/** One shared name bound to a server from this machine, with what was received under it. */
export interface NameStatus {
  alias: string;
  slug: string;
  entries: number;
  memories: number;
  members: number;
  lastAt: number | null;
  state: "ok" | "missing" | "recreated" | "purged";
  recreatedBy: string | null;
}
export type Kind = "decision" | "fix" | "gotcha" | "convention" | "change" | "discovery";
export const KINDS: Kind[] = ["decision", "fix", "gotcha", "convention", "change", "discovery"];
export interface MemoryItem {
  id: number;
  projectId: number;
  kind: Kind;
  title: string;
  importance: number;
  status: "active" | "archived" | "superseded";
  stale: number;
  judge: string;
  origin: string;
  branch: string | null;
  useCount: number;
  createdAt: number;
  updatedAt: number;
  files: string[];
}
export interface MemoryDetail extends MemoryItem {
  body: string;
  judgeVersion: string;
  evidenceCount: number;
  supersededBy: number | null;
  fileRoles: { path: string; role: string }[];
  source: { turnId: number; agent: string; prompt: string; startedAt: number } | null;
}
export interface TurnItem {
  id: number;
  agent: string;
  state: string;
  completeness: string;
  prompt: string;
  startedAt: number;
  endedAt: number | null;
  lastError: string | null;
  memoryIds: number[];
}
export interface TurnDetail extends Omit<TurnItem, "memoryIds"> {
  finalText: string | null;
  filesRead: string[];
  filesChanged: string[];
  commands: string[];
  errors: string[];
  memories: { id: number; title: string; kind: Kind }[];
}
export interface ProjectStats {
  byKind: Record<Kind, number>;
  byStatus: { active: number; archived: number; superseded: number };
  stale: number;
  byImportance: Record<"1" | "2" | "3" | "4" | "5", number>;
  byJudge: Record<string, number>;
  turns: Record<string, number>;
  weekly: { weekStart: number; memories: number; turns: number }[];
  hooks: { event: string; p50: number; p95: number; runs: number }[];
}
export interface SearchHit {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  kind: Kind;
  importance: number;
}

export type SettingSource = "env" | "file" | "default";
export type PublicSetting =
  | { value: string | null; source: SettingSource }
  | { secret: true; set: boolean; fingerprint: string | null; source: SettingSource };
export type SettingKey =
  | "TYPESAFE_API_KEY"
  | "WIZARDINGCODE_MEM_TYPESAFE"
  | "WIZARDINGCODE_MEM_SEMANTIC"
  | "WIZARDINGCODE_MEM_RETENTION_DAYS"
  | "WIZARDINGCODE_MEM_HISTORY_DAYS"
  | "WIZARDINGCODE_MEM_UI_AUTO_OPEN"
  | "WIZARDINGCODE_MEM_UPDATE"
  | "WIZARDINGCODE_MEM_STORE_DIR"
  | "WIZARDINGCODE_MODULES"
  | "WIZARDINGCODE_MEM_SHARE_ROOTS"
  | "WIZARDINGCODE_MEM_SHARE_AREAS"
  | "WIZARDINGCODE_MEM_AUTHOR"
  | "WIZARDINGCODE_MEM_BACKUP_TO"
  | "WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS"
  | "WIZARDINGCODE_MEM_BACKUP_KEEP"
  | "WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT"
  | "WIZARDINGCODE_MEM_BACKUP_S3_REGION"
  | "WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY"
  | "WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY";
export type SettingsView = { dataDir: string; settings: Record<SettingKey, PublicSetting> };
export type SettingsPatch = Partial<Record<SettingKey, string | number | boolean | null>>;
export interface Check {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
}
export interface CompactReport {
  dryRun: boolean;
  turns: number;
  sessions: number;
  hookRuns: number;
  /** The knowledge_shown rows of gone sessions and repositories (0 with no knowledge tables). */
  knowledgeShown: number;
  bytesBefore: number;
  bytesAfter: number;
}
export interface StorageInfo {
  dataDir: string;
  storeDir: string;
  dbBytes: number;
  busy: boolean;
  recentSessions: number;
}
export interface TargetReport {
  path: string;
  exists: boolean;
  hasDb: boolean;
  writable: boolean;
  network: boolean;
  fsType: string | null;
  warnings: string[];
}
export type MoveOutcome =
  | { ok: true; to: string; keptOld: string; bytes: number }
  | { ok: false; reason: string; detail: string };
export interface BackupEntry {
  name: string;
  bytes: number;
  at: number;
  version: number;
}
export interface BackupsView {
  target: { kind: "folder" | "s3"; label: string } | null;
  last: { name: string; bytes: number; at: number; label: string } | null;
  due: boolean;
  entries: BackupEntry[];
  error?: string;
}
export type BackupOutcome =
  | { ok: true; name: string; bytes: number }
  | { ok: false; reason: string; detail: string };
export type RestoreOutcome =
  | { ok: true; replaced: string; historyRemoved: boolean; sharingReset: number }
  | { ok: false; reason: string; detail: string };
/** What would leave for the team's server under a policy (`Report` in src/sharing/report.ts). */
export interface SharingReport {
  counts: { entries: number; memories: number };
  perRoot: Record<Root, { entries: number; areaTotals: Record<string, number> }>;
  perProject: { id: number; level: Level; entries: number; memories: number }[];
  items?: {
    entries: { scope: string; projectId: number; slug: string; title: string; area: string }[];
    memories: { id: number; projectId: number; title: string }[];
    more: { entries: number; memories: number };
  };
}
/** One change to what is shared, as the log keeps it. */
export interface SharingChange {
  id: number;
  at: number;
  source: "viewer" | "cli" | "restore" | "file" | "system";
  /** `project:<id>`, `roots`, `areas` or `levels`. */
  what: string;
  old: string;
  new: string;
}
/** The Sharing page's view: the policy in force and what would leave under it. */
export interface SharingView {
  epoch: number;
  closed: boolean;
  roots: Root[];
  areas: string[];
  inert: string[];
  problems: string[];
  lastChange: SharingChange | null;
  taxonomies: Record<Root, { id: string; label: string }[] | null>;
  levels: Record<Level, number>;
  report: SharingReport;
}
/** A change about to be made, for its preview: a project's level, the roots, the areas. */
export interface PolicyChange {
  level?: { projectId: number; level: Level; server?: string };
  roots?: Root[];
  areas?: string[];
}
/** The sync as `GET /api/sync` says it (the `sync` object of `status --json`). */
export interface SyncInfo {
  state: "running" | "stopped" | "failed" | "idle";
  pid: number | null;
  alive: boolean | null;
  idleSince: number | null;
  stoppedBy: string | null;
  failedStart: { at: number; reason: string; nextTryAt: number } | null;
}
/** One listed server, as `GET /api/servers` lists it; never a token. */
export interface ServerEntry {
  id: string;
  name: string;
  host: string;
  url: string;
  member: string;
  role: string;
  state: "pending" | "token missing" | "ok" | "stopped";
  remedy: string | null;
  cursor: number;
  lastPushAt: number | null;
  lastPushOkAt: number | null;
  lastPullAt: number | null;
  lastPullOkAt: number | null;
  backlog: number;
  dirty: number;
  pending: number;
  conflicts: number;
  hold: { reason: "restore" | "bulk"; count: number } | null;
  /** The contract spoken to the server; shared names need 2 (ADR 0028). */
  contract: number;
  /** The row speaks 1 while a shared name is bound: nothing of those projects moves. */
  namesHeld: boolean;
  /** The shared names bound to the server from this machine. */
  names: NameStatus[];
  lastSyncAt: number | null;
  muted: boolean;
}
export interface ServersView {
  sync: SyncInfo;
  servers: ServerEntry[];
  /** Set when the list could not be read; the page says so in one sentence. */
  error?: string;
}
/** A join's answer: the row is pending until the yes; the counts say what would leave. */
export interface AddedServer {
  confirm: true;
  server: { id: string; name: string; member: string; role: string };
  counts: { entries: number; memories: number; byProject: { project: number; entries: number; memories: number }[] };
}
/** What a resume would release for one server, per project. */
export interface ResumePreviewEntry {
  serverId: string;
  name: string;
  hold: { reason: "restore" | "bulk"; at: number; count: number } | null;
  perProject: { projectId: number | null; count: number; uids: string[] }[];
  total: number;
}
/** A refused route, with the status and the body the page switches on (`error`, and its details). */
export class RouteError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
  }
}
/** A replacement either ran, or the count moved since it was shown (`stale`). */
export type ReplaceOutcome =
  | { ok: true; projects: number; archived: number; spared: number }
  | { ok: false; stale: true; count: number };
/** A refused settings change: one message per key. */
export class SettingsError extends Error {
  constructor(public errors: Partial<Record<SettingKey, string>>) {
    super("some settings could not be saved");
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
    if (body.errors) throw new SettingsError(body.errors);
    throw new RouteError(res.status, { error: body.error ?? res.statusText, ...body });
  }
  return (await res.json()) as T;
}

/**
 * A route that answers an expected refusal as `200 { ok: false, error }` (the servers' add and
 * its yes: a refused code, a URL that is not a server's), raised here as the route error the
 * pages switch on, so the browser logs nothing for an outcome the page shows as a sentence.
 */
function okOrThrow<T extends { ok?: boolean; error?: string }>(body: T): T {
  if (body.ok === false) throw new RouteError(200, { ...body, error: body.error ?? "refused" });
  return body;
}

export const api = {
  /** The modules on, in order, with their views. */
  modules: () => call<ModuleInfo[]>("/api/modules"),
  overview: () =>
    call<{ version: string; dataDir: string; storeDir: string; projects: Project[] }>("/api/overview"),
  memories: (params: Record<string, string | number>) =>
    call<{ total: number; items: MemoryItem[] }>(
      `/api/memories?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`,
    ),
  memory: (id: number) => call<MemoryDetail>(`/api/memories/${id}`),
  setStatus: (id: number, status: "active" | "archived") =>
    call<MemoryDetail>(`/api/memories/${id}`, { method: "POST", body: JSON.stringify({ status }) }),
  edit: (id: number, changes: Partial<Pick<MemoryDetail, "title" | "body" | "kind" | "importance">>) =>
    call<MemoryDetail>(`/api/memories/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  turns: (projectId: number, limit = 100) =>
    call<TurnItem[]>(`/api/turns?project=${projectId}&limit=${limit}`),
  turn: (id: number) => call<TurnDetail>(`/api/turns/${id}`),
  stats: (projectId: number) => call<ProjectStats>(`/api/projects/${projectId}/stats`),
  /** With a project: that project and the ones linked to it; without, every project. */
  search: (q: string, limit = 20, projectId: number | null = null) =>
    call<SearchHit[]>(
      `/api/search?q=${encodeURIComponent(q)}&limit=${limit}${projectId === null ? "" : `&project=${projectId}`}`,
    ),
  /** This tab is here: the server keeps running and opens no second tab. */
  ping: () =>
    fetch("/api/ping", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } }).catch(
      () => undefined,
    ),
  /** This tab is going away. */
  bye: () =>
    fetch("/api/bye", {
      method: "POST",
      keepalive: true,
      headers: { Authorization: `Bearer ${TOKEN}` },
    }).catch(() => undefined),
  settings: () => call<SettingsView>("/api/settings"),
  /** With `confirm`, the person said yes to sharing more: the server requires it to widen. With `server`, the sharing keys edit that server's lists. */
  saveSettings: (patch: SettingsPatch, options?: { confirm?: boolean; server?: string }) =>
    call<SettingsView>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...patch,
        ...(options?.confirm ? { confirm: true } : {}),
        ...(options?.server ? { server: options.server } : {}),
      }),
    }),
  /** What may leave for the team's server; with `list`, each item that would; with `server`, under that server's lists. */
  sharing: (list = false, server?: string) =>
    call<SharingView>(`/api/sharing?${new URLSearchParams({ ...(list ? { list: "1" } : {}), ...(server ? { server } : {}) })}`),
  /** What would leave once a change is made. Writes nothing. */
  sharingPreview: (change: PolicyChange) =>
    call<{ report: SharingReport }>("/api/sharing/preview", { method: "POST", body: JSON.stringify(change) }),
  /** Sets what one project shares; a wider level needs `confirm`; with several servers, `server` names the one; `as` binds it under a shared name, created with `create` (ADR 0028). */
  setProjectSharing: (id: number, level: Level, confirm: boolean, server?: string, as?: string, create?: boolean) =>
    call<{ level: Level; old: Level; boundAlias: string; sharedName: string | null }>(`/api/projects/${id}/sharing`, {
      method: "PUT",
      body: JSON.stringify({
        level,
        ...(confirm ? { confirm: true } : {}),
        ...(server ? { server } : {}),
        ...(as ? { as } : {}),
        ...(create ? { create: true } : {}),
      }),
    }),
  /** What setting a level under a shared name would do: the alias it would bind to, and whether the name is new to the project. Writes nothing. */
  previewProjectSharing: (id: number, level: Level, as?: string, server?: string) =>
    call<{ ok: true; boundAlias: string; named: boolean }>(`/api/projects/${id}/sharing/preview`, {
      method: "POST",
      body: JSON.stringify({ level, ...(as ? { as } : {}), ...(server ? { server } : {}) }),
    }),
  /** The project leaves its shared name, at Nothing. */
  forgetProjectName: (id: number) =>
    call<{ forgotten: true; sharedName: string }>(`/api/projects/${id}/name`, { method: "DELETE" }),
  /** The shared names a server holds, up to the first 1,000. */
  serverNames: (id: string) => call<{ names: NameItem[]; truncated: boolean }>(`/api/servers/${id}/names`),
  /** The team servers and the sync (ADR 0027); no token in any answer. */
  servers: () =>
    call<ServersView>("/api/servers").then((view) => {
      if (view.error !== undefined) throw new RouteError(200, { error: view.error });
      return view;
    }),
  sync: () => call<SyncInfo>("/api/sync"),
  runSync: () => call<{ started: boolean }>("/api/sync/run", { method: "POST", body: "{}" }),
  addServer: (input: { url: string; code: string; label?: string; name?: string }) =>
    call<AddedServer & { ok?: boolean; error?: string }>("/api/servers", { method: "POST", body: JSON.stringify(input) }).then(okOrThrow),
  confirmServer: (url: string) =>
    call<{ ok?: boolean; error?: string; confirmed?: true }>("/api/servers", { method: "POST", body: JSON.stringify({ url, yes: true }) }).then(okOrThrow),
  rejoinServer: (id: string, code: string) =>
    call<{ rejoined: true }>(`/api/servers/${id}/rejoin`, { method: "POST", body: JSON.stringify({ code }) }),
  removeServer: (id: string, options: { withdraw?: boolean; yes?: boolean }) =>
    call<{ removed: true }>(`/api/servers/${id}`, { method: "DELETE", body: JSON.stringify(options) }),
  muteServer: (id: string, muted: boolean, member?: string) =>
    call<{ muted: boolean }>(`/api/servers/${id}/${muted ? "mute" : "unmute"}`, {
      method: "POST",
      body: JSON.stringify(member === undefined ? {} : { member }),
    }),
  resumeServer: (id: string, yes: boolean) =>
    call<{ preview?: ResumePreviewEntry[]; resumed?: true }>(`/api/servers/${id}/resume`, {
      method: "POST",
      body: JSON.stringify(yes ? { yes: true } : {}),
    }),
  doctor: () => call<Check[]>("/api/doctor"),
  backups: () => call<BackupsView>("/api/backups"),
  backupNow: () => call<BackupOutcome>("/api/backups", { method: "POST", body: "{}" }),
  testBackups: () =>
    call<{ ok: boolean; label: string; entries?: number; detail?: string }>("/api/backups/test", {
      method: "POST",
      body: "{}",
    }),
  restoreBackup: (name: string) =>
    call<RestoreOutcome>("/api/backups/restore", {
      method: "POST",
      body: JSON.stringify({ name, confirm: true }),
    }),
  storage: () => call<StorageInfo>("/api/storage"),
  inspectTarget: (path: string) =>
    call<TargetReport>("/api/storage/inspect", { method: "POST", body: JSON.stringify({ path }) }),
  moveStore: (path: string) =>
    call<MoveOutcome>("/api/storage/move", {
      method: "POST",
      body: JSON.stringify({ path, confirm: true }),
    }),
  history: () => call<HistoryStatus>("/api/history"),
  /** Past conversations: by their words, or the latest without any; one project or all. */
  historySearch: (q: string, projectId: number | null, limit: number) => {
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (projectId !== null) params.set("project", String(projectId));
    return call<PastSearch>(`/api/history/search?${params}`);
  },
  historyProgress: () => call<HistoryProgress>("/api/history/progress"),
  /** The one-time offer: light, for every page load. */
  historyOffer: () => call<HistoryOffer>("/api/history/offer"),
  /** Starts a background run; `started: false` when one is already going. */
  historyImport: () => call<{ started: boolean }>("/api/history/import", { method: "POST", body: "{}" }),
  historyIndex: () => call<{ started: boolean }>("/api/history/index", { method: "POST", body: "{}" }),
  historyForget: () => call<{ forgotten: true }>("/api/history/forget", { method: "POST", body: "{}" }),
  /** Archives the imports now covered by history, if `expected` is still the count. */
  replaceImports: async (expected: number): Promise<ReplaceOutcome> => {
    const res = await fetch("/api/history/replace-imports", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ expected }),
    });
    const body = (await res.json().catch(() => ({}))) as { count?: number; error?: string; projects?: number; archived?: number; spared?: number };
    if (res.status === 409 && typeof body.count === "number") return { ok: false, stale: true, count: body.count };
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    return { ok: true, projects: body.projects ?? 0, archived: body.archived ?? 0, spared: body.spared ?? 0 };
  },
  restoreImports: () => call<{ restored: number }>("/api/history/restore-imports", { method: "POST", body: "{}" }),
  dismissHistoryOffer: () => call<{ dismissed: true }>("/api/history/offer/dismiss", { method: "POST", body: "{}" }),
  links: () => call<LinksList>("/api/links"),
  /** Links two projects by hand: confirmed at once. */
  link: (from: number, to: number, kind: LinkKind) =>
    call<LinkView>("/api/links", { method: "POST", body: JSON.stringify({ from, to, kind }) }),
  /** Confirm or reject a suggestion; unlink a confirmed link. */
  decideLink: (id: number, change: "confirm" | "reject" | "unlink") =>
    call<LinkView>(`/api/links/${id}/${change}`, { method: "POST", body: "{}" }),
  linksOffer: () => call<LinksOffer>("/api/links/offer"),
  dismissLinksOffer: () => call<{ dismissed: true }>("/api/links/offer/dismiss", { method: "POST", body: "{}" }),
  rules: () => call<RulesList>("/api/rules"),
  /** Make a proposal yours, or reject it. */
  decideRule: (proposalId: number, change: "accept" | "reject") =>
    call<{ userMemoryId: number } | { rejected: true }>(`/api/rules/${proposalId}/${change}`, { method: "POST", body: "{}" }),
  /** Take back one of your rules: it is archived and the project copies return. */
  undoRule: (memoryId: number) => call<{ undone: true }>(`/api/rules/${memoryId}/undo`, { method: "POST", body: "{}" }),
  semantic: () => call<SemanticStatus>("/api/semantic"),
  /** Downloads the model, then gives the memories their vectors; `started: false` when one is going. */
  semanticDownload: () => call<{ started: boolean }>("/api/semantic/download", { method: "POST", body: "{}" }),
  semanticBackfill: () => call<{ started: boolean }>("/api/semantic/backfill", { method: "POST", body: "{}" }),
  semanticSwitch: (on: boolean) => call<SemanticStatus>(`/api/semantic/${on ? "on" : "off"}`, { method: "POST", body: "{}" }),
  semanticDelete: () => call<SemanticStatus>("/api/semantic/delete", { method: "POST", body: "{}" }),
  compact: (dryRun: boolean) =>
    call<CompactReport>("/api/compact", { method: "POST", body: JSON.stringify({ dryRun }) }),
};
