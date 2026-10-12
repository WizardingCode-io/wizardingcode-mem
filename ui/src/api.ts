// The viewer's client for /api. The token comes from the URL the binary opened.
import type { HistoryOffer, HistoryProgress, HistoryStatus, PastSearch } from "./history";
import type { KnowledgeEntry, KnowledgeView, Promotion } from "./knowledge";
import type { LinkKind, LinksList, LinksOffer, LinkView, RulesList } from "./links";
import type { ModuleInfo } from "./modules";
import type { SemanticStatus } from "./semantic";

export type { SemanticStatus } from "./semantic";
export type { KnowledgeEntry, KnowledgeListEntry, KnowledgeView, Promotion } from "./knowledge";
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
  | "WIZARDINGCODE_MEM_RETENTION_DAYS"
  | "WIZARDINGCODE_MEM_UI_AUTO_OPEN"
  | "WIZARDINGCODE_MEM_STORE_DIR"
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
export type RestoreOutcome = { ok: true; replaced: string; historyRemoved: boolean } | { ok: false; reason: string; detail: string };
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
    throw new Error(body.error ?? res.statusText);
  }
  return (await res.json()) as T;
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
  saveSettings: (patch: SettingsPatch) =>
    call<SettingsView>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),
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
  /** The project's knowledge as its folder has it now (read only). */
  knowledge: (projectId: number) => call<KnowledgeView>(`/api/knowledge?project=${projectId}`),
  knowledgeEntry: (projectId: number, slug: string) =>
    call<KnowledgeEntry>(`/api/knowledge/entries/${encodeURIComponent(slug)}?project=${projectId}`),
  /** Memories proposed as knowledge, that could still be accepted. */
  promotions: (projectId: number) => call<Promotion[]>(`/api/knowledge/proposals?project=${projectId}`),
  /** Make knowledge (writes the entry file) or reject (never proposed again). */
  decidePromotion: (id: number, change: "accept" | "reject") =>
    call<{ slug: string; path: string } | { rejected: true }>(`/api/knowledge/proposals/${id}/${change}`, { method: "POST", body: "{}" }),
  compact: (dryRun: boolean) =>
    call<CompactReport>("/api/compact", { method: "POST", body: JSON.stringify({ dryRun }) }),
};
