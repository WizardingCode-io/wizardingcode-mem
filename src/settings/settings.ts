// The product's settings: the environment first, then `<data dir>/env`, then the
// defaults. Keys are named exactly like the environment variables, so the file reads
// like a shell would. This runs on the hook path: node:fs only, one small file read.
// The two sharing keys are the exception to "the environment first": the file is the
// policy, and the environment can only narrow it (`effectiveSharing`).
import { isAbsolute, join, win32 } from "node:path";
import { keyFingerprint } from "../judge/key.ts";
import { isRoot, NONE, type Root, SHARE_AREA, shareListText } from "../sharing/types.ts";
import { ENV_FILE, readEnvFile, writeEnvFile } from "./env-file.ts";

export { ENV_FILE };

const SHARE_ROOTS = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const SHARE_AREAS = "WIZARDINGCODE_MEM_SHARE_AREAS";

export const SETTING_KEYS = [
  "TYPESAFE_API_KEY",
  "WIZARDINGCODE_MEM_TYPESAFE",
  "WIZARDINGCODE_MEM_SEMANTIC",
  "WIZARDINGCODE_MEM_RETENTION_DAYS",
  "WIZARDINGCODE_MEM_HISTORY_DAYS",
  "WIZARDINGCODE_MEM_UI_AUTO_OPEN",
  "WIZARDINGCODE_MEM_UPDATE",
  "WIZARDINGCODE_MEM_STORE_DIR",
  "WIZARDINGCODE_MODULES",
  SHARE_ROOTS,
  SHARE_AREAS,
  "WIZARDINGCODE_MEM_AUTHOR",
  "WIZARDINGCODE_MEM_BACKUP_TO",
  "WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS",
  "WIZARDINGCODE_MEM_BACKUP_KEEP",
  "WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT",
  "WIZARDINGCODE_MEM_BACKUP_S3_REGION",
  "WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY",
  "WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** The two lists that say what may leave this machine beside each project's own level. */
export type SharingKey = typeof SHARE_ROOTS | typeof SHARE_AREAS;
export const SHARING_KEYS: readonly SettingKey[] = [SHARE_ROOTS, SHARE_AREAS];

/** Values that never leave the machine in full: the API shows a fingerprint. */
const SECRET_KEYS: ReadonlySet<SettingKey> = new Set([
  "TYPESAFE_API_KEY",
  "WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY",
]);

export interface Settings {
  typesafeKey: string | null;
  /** `off` keeps the heuristic judge even with a key configured. */
  typesafe: "on" | "off";
  /** `off` never loads the embedding model, even when it is installed. */
  semantic: "on" | "off";
  retentionDays: number;
  /** How far back history is distilled. Older history is only indexed. */
  historyDays: number;
  uiAutoOpen: boolean;
  /** Where the database lives when it was moved away from the data directory. */
  storeDir: string | null;
  /**
   * The modules on, as the comma list it was given; null means the default,
   * `memory,knowledge`. An explicit `memory` turns knowledge off.
   */
  modules: string | null;
  /**
   * The roots and the root-qualified areas allowed to leave, as in force and sorted, and
   * what was emptied or ignored while reading them, one sentence each.
   */
  sharing: { roots: Root[]; areas: string[]; problems: string[] };
  /** The person's name on the knowledge they write; null falls back to the git name. */
  author: string | null;
  backup: {
    /** A folder, or `s3://bucket/prefix`. */
    to: string | null;
    /** 0 means only on demand. */
    everyHours: number;
    keep: number;
    s3: {
      endpoint: string | null;
      region: string | null;
      accessKey: string | null;
      secretKey: string | null;
    };
  };
}

export const DEFAULTS = {
  typesafe: "on",
  retentionDays: 90,
  historyDays: 180,
  uiAutoOpen: true,
  backupEveryHours: 24,
  backupKeep: 10,
  modules: "memory,knowledge",
} as const;

const RETENTION = { min: 7, max: 3650 };
const HISTORY_DAYS = { min: 1, max: 3650 };
const EVERY_HOURS = { min: 0, max: 24 * 30 };
const KEEP = { min: 1, max: 1000 };

export type Source = "env" | "file" | "default";

export type Env = Record<string, string | undefined>;

/**
 * The raw value of each key and where it came from, the environment winning over the file's
 * parsed map. The two sharing keys are not read from here: see `effectiveSharing`.
 */
function rawSettings(
  env: Env,
  file: Record<string, string | undefined>,
): Record<SettingKey, { value: string | null; source: Source }> {
  const out = {} as Record<SettingKey, { value: string | null; source: Source }>;
  for (const key of SETTING_KEYS) {
    const fromEnv = env[key]?.trim();
    if (fromEnv) out[key] = { value: fromEnv, source: "env" };
    else if (file[key]) out[key] = { value: file[key] as string, source: "file" };
    else out[key] = { value: null, source: "default" };
  }
  return out;
}

const onOff = (value: string | null, fallback: boolean): boolean =>
  value === "on" ? true : value === "off" ? false : fallback;

function integer(
  value: string | null,
  range: { min: number; max: number },
  fallback: number,
): number {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return n >= range.min && n <= range.max ? n : fallback;
}

const AUTHOR_MAX = 80;

/**
 * Why a text cannot be a person's author name; null when it can. A name starting with
 * `agent:` is refused: that prefix is how an agent's change is told from a person's.
 */
export function authorNameProblem(value: string): string | null {
  if (value.length === 0 || value.length > AUTHOR_MAX || /[\r\n]/.test(value)) {
    return `a name of 1 to ${AUTHOR_MAX} characters, on one line`;
  }
  return value.startsWith("agent:") ? "a person's name cannot start with agent:" : null;
}

// --- The sharing lists ---------------------------------------------------------------

/** What each sharing key lists: the noun a problem names, and the test a token must pass. */
const SHARE_LISTS: Record<SharingKey, { noun: string; valid: (token: string) => boolean }> = {
  [SHARE_ROOTS]: { noun: "root", valid: isRoot },
  [SHARE_AREAS]: { noun: "root-qualified area id", valid: (token) => SHARE_AREA.test(token) },
};

/**
 * A sharing list as written: trimmed, lower-cased, de-duplicated, sorted. `none`, an empty
 * text and an absent value are the empty list. It fails closed: one token that is not what
 * the key lists empties the whole list, and the problem names the token's position, never
 * its value.
 */
export function parseShareList(
  raw: string | null,
  key: SharingKey,
): { list: string[]; problem: string | null } {
  const tokens = (raw ?? "").split(",").map((token) => token.trim().toLowerCase());
  if (tokens.length === 1 && (tokens[0] === "" || tokens[0] === NONE)) {
    return { list: [], problem: null };
  }
  const { noun, valid } = SHARE_LISTS[key];
  const bad = tokens.findIndex((token) => !valid(token));
  if (bad !== -1) {
    return { list: [], problem: `${key}: token ${bad + 1} is not a ${noun}; the list was emptied` };
  }
  return { list: [...new Set(tokens)].sort(), problem: null };
}

/**
 * The environment may only narrow a sharing list: an id it names beyond the file's list is
 * ignored and counted, an id of the file's it leaves out is removed. A null environment
 * says nothing, and the file's list stands.
 */
export function narrowOnly(
  file: string[],
  env: string[] | null,
): { list: string[]; ignored: number; narrowed: boolean } {
  if (env === null) return { list: [...file], ignored: 0, narrowed: false };
  return {
    list: file.filter((id) => env.includes(id)),
    ignored: env.filter((id) => !file.includes(id)).length,
    narrowed: file.some((id) => !env.includes(id)),
  };
}

/** One sharing list in force, with the file's own list and how the two came apart. */
export interface EffectiveShareList {
  list: string[];
  /** The file's own list, before any environment: what a person chose. */
  fileList: string[];
  /** `env` only when the environment removed an id of the file's. */
  source: Source;
  /** How many ids the environment named beyond the file's list. */
  ignored: number;
  problems: string[];
}

/**
 * The two sharing lists in force. For these keys the file is the policy, so the file's
 * parsed map and the environment are read apart: an environment value is honoured only
 * where it narrows, and an empty variable is unset, as for every other key. An invalid token
 * in the environment empties the environment's list, which removes every id of the file's.
 * The problems come in a fixed order: the file's token, the environment's token, the count
 * of the ids the environment named beyond the file's.
 */
export function effectiveSharing(
  file: Record<string, string | undefined>,
  env: Env,
): Record<SharingKey, EffectiveShareList> {
  const one = (key: SharingKey): EffectiveShareList => {
    const inFile = parseShareList(file[key] ?? null, key);
    const fromEnv = env[key]?.trim();
    const inEnv = fromEnv ? parseShareList(fromEnv, key) : null;
    const { list, ignored, narrowed } = narrowOnly(inFile.list, inEnv?.list ?? null);
    const problems: string[] = [];
    if (inFile.problem !== null) problems.push(inFile.problem);
    if (inEnv !== null && inEnv.problem !== null) {
      problems.push(`the environment's ${inEnv.problem}`);
    }
    if (ignored > 0) {
      problems.push(`the environment's ${key} names ${ignored} more than the file; ignored`);
    }
    const source: Source = narrowed ? "env" : file[key] ? "file" : "default";
    return { list, fileList: inFile.list, source, ignored, problems };
  };
  return { [SHARE_ROOTS]: one(SHARE_ROOTS), [SHARE_AREAS]: one(SHARE_AREAS) };
}

/**
 * The release check's key as this process sees it, with where it came from: the lines a
 * person reads say so, since a variable exported in one shell does not reach a hook started
 * elsewhere. The value is not normalised: an unknown one must be seen as unknown.
 */
export function updateSetting(env: Env, dataDir: string): { value: string | null; source: Source } {
  return rawSettings(env, readEnvFile(join(dataDir, ENV_FILE))).WIZARDINGCODE_MEM_UPDATE;
}

export function loadSettings(env: Env = process.env, dataDir: string): Settings {
  const file = readEnvFile(join(dataDir, ENV_FILE));
  return settingsFrom(rawSettings(env, file), effectiveSharing(file, env));
}

/** The settings from the raw values and the sharing lists, both read from one parse of the file. */
function settingsFrom(
  raw: Record<SettingKey, { value: string | null; source: Source }>,
  sharing: Record<SharingKey, EffectiveShareList>,
): Settings {
  const value = (key: SettingKey) => raw[key].value;
  const author = value("WIZARDINGCODE_MEM_AUTHOR");
  return {
    typesafeKey: value("TYPESAFE_API_KEY"),
    typesafe: onOff(value("WIZARDINGCODE_MEM_TYPESAFE"), true) ? "on" : "off",
    semantic: onOff(value("WIZARDINGCODE_MEM_SEMANTIC"), true) ? "on" : "off",
    retentionDays: integer(
      value("WIZARDINGCODE_MEM_RETENTION_DAYS"),
      RETENTION,
      DEFAULTS.retentionDays,
    ),
    historyDays: integer(
      value("WIZARDINGCODE_MEM_HISTORY_DAYS"),
      HISTORY_DAYS,
      DEFAULTS.historyDays,
    ),
    uiAutoOpen: onOff(value("WIZARDINGCODE_MEM_UI_AUTO_OPEN"), DEFAULTS.uiAutoOpen),
    storeDir: value("WIZARDINGCODE_MEM_STORE_DIR"),
    modules: value("WIZARDINGCODE_MODULES"),
    sharing: {
      roots: sharing[SHARE_ROOTS].list.filter(isRoot),
      areas: sharing[SHARE_AREAS].list,
      problems: [...sharing[SHARE_ROOTS].problems, ...sharing[SHARE_AREAS].problems],
    },
    author: author !== null && authorNameProblem(author) === null ? author : null,
    backup: {
      to: value("WIZARDINGCODE_MEM_BACKUP_TO"),
      everyHours: integer(
        value("WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS"),
        EVERY_HOURS,
        DEFAULTS.backupEveryHours,
      ),
      keep: integer(value("WIZARDINGCODE_MEM_BACKUP_KEEP"), KEEP, DEFAULTS.backupKeep),
      s3: {
        endpoint: value("WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT"),
        region: value("WIZARDINGCODE_MEM_BACKUP_S3_REGION"),
        accessKey: value("WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY"),
        secretKey: value("WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY"),
      },
    },
  };
}

// --- Changes from the viewer -----------------------------------------------------

export type Patch = Record<string, unknown>;
export type Validated =
  | { ok: true; changes: Partial<Record<SettingKey, string | null>> }
  | { ok: false; errors: Partial<Record<string, string>> };

/** The absolute path test for both families of paths, whatever this machine is. */
const absolutePath = (value: string) => isAbsolute(value) || win32.isAbsolute(value);
const MODULE_ID = /^[a-z][a-z0-9-]*$/;
/** A comma list of module ids, spaces around them removed and lower-cased. */
const moduleList = (value: string) =>
  value
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .join(",");
const S3_URL = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[^\s]*)?$/i;

/** A sharing list as the file holds it: the parsed list as comma text, or `none`. */
const shareList = (key: SharingKey) => (value: string) =>
  shareListText(parseShareList(value, key).list);

/** How a value is written when that is not the text as given. */
const NORMALISED: Partial<Record<SettingKey, (value: string) => string>> = {
  WIZARDINGCODE_MODULES: moduleList,
  [SHARE_ROOTS]: shareList(SHARE_ROOTS),
  [SHARE_AREAS]: shareList(SHARE_AREAS),
};

/** How each key is checked; the message never repeats the value. */
const RULES: Record<SettingKey, (value: string) => string | null> = {
  TYPESAFE_API_KEY: (v) => (v === "" ? "the key cannot be empty; clear it instead" : null),
  WIZARDINGCODE_MEM_TYPESAFE: (v) => (v === "on" || v === "off" ? null : "on or off"),
  WIZARDINGCODE_MEM_SEMANTIC: (v) => (v === "on" || v === "off" ? null : "on or off"),
  WIZARDINGCODE_MEM_RETENTION_DAYS: (v) =>
    /^\d+$/.test(v) && Number(v) >= RETENTION.min && Number(v) <= RETENTION.max
      ? null
      : `a whole number of days from ${RETENTION.min} to ${RETENTION.max}`,
  WIZARDINGCODE_MEM_HISTORY_DAYS: (v) =>
    /^\d+$/.test(v) && Number(v) >= HISTORY_DAYS.min && Number(v) <= HISTORY_DAYS.max
      ? null
      : `a whole number of days from ${HISTORY_DAYS.min} to ${HISTORY_DAYS.max}`,
  WIZARDINGCODE_MEM_UI_AUTO_OPEN: (v) => (v === "on" || v === "off" ? null : "on or off"),
  WIZARDINGCODE_MEM_UPDATE: (v) => (v === "check" || v === "off" ? null : "check or off"),
  WIZARDINGCODE_MEM_STORE_DIR: () => "the store directory is changed by moving the store, not here",
  WIZARDINGCODE_MODULES: (v) => {
    const ids = moduleList(v).split(",");
    if (!ids.every((id) => MODULE_ID.test(id))) return "a comma list of module ids, such as memory";
    return ids.includes("memory")
      ? null
      : "memory is always on in this version: list it first, then the modules to add";
  },
  [SHARE_ROOTS]: (v) =>
    parseShareList(v, SHARE_ROOTS).problem === null
      ? null
      : "a comma list of workspace and shared, or none",
  [SHARE_AREAS]: (v) =>
    parseShareList(v, SHARE_AREAS).problem === null
      ? null
      : "a comma list of root-qualified area ids such as workspace:sales, or none",
  WIZARDINGCODE_MEM_AUTHOR: authorNameProblem,
  WIZARDINGCODE_MEM_BACKUP_TO: (v) =>
    absolutePath(v) || S3_URL.test(v) ? null : "an absolute folder path or s3://bucket/prefix",
  WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: (v) =>
    /^\d+$/.test(v) && Number(v) <= EVERY_HOURS.max
      ? null
      : `a whole number of hours from 0 (on demand only) to ${EVERY_HOURS.max}`,
  WIZARDINGCODE_MEM_BACKUP_KEEP: (v) =>
    /^\d+$/.test(v) && Number(v) >= KEEP.min && Number(v) <= KEEP.max
      ? null
      : `a whole number of copies to keep, from ${KEEP.min} to ${KEEP.max}`,
  WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT: (v) =>
    /^https?:\/\/\S+$/.test(v) ? null : "an http(s) URL",
  WIZARDINGCODE_MEM_BACKUP_S3_REGION: (v) =>
    v === "" ? "cannot be empty; clear it instead" : null,
  WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY: (v) =>
    v === "" ? "cannot be empty; clear it instead" : null,
  WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY: (v) =>
    v === "" ? "cannot be empty; clear it instead" : null,
};

/** Normalises what the viewer sends: booleans and numbers become the file's strings. */
function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "on" : "off";
  return null;
}

/** Every value is one line of the env file: a line break would write a second key. */
const ONE_LINE = "a value on one line";

export function validatePatch(patch: Patch): Validated {
  const changes: Partial<Record<SettingKey, string | null>> = {};
  const errors: Partial<Record<string, string>> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      errors[key] = "not a setting";
      continue;
    }
    const settingKey = key as SettingKey;
    if (value === null) {
      if (settingKey === "WIZARDINGCODE_MEM_STORE_DIR") errors[key] = RULES[settingKey]("") ?? "";
      else changes[settingKey] = null;
      continue;
    }
    const text = asString(value);
    if (text === null) {
      errors[key] = "a text value, a number or null";
      continue;
    }
    if (/[\r\n]/.test(text)) {
      errors[key] = ONE_LINE;
      continue;
    }
    const problem = RULES[settingKey](text);
    if (problem !== null) errors[key] = problem;
    else changes[settingKey] = NORMALISED[settingKey]?.(text) ?? text;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, changes };
}

export function saveSettings(
  dataDir: string,
  changes: Partial<Record<SettingKey, string | null>>,
): void {
  writeEnvFile(join(dataDir, ENV_FILE), changes);
}

// --- What the viewer may see ------------------------------------------------------

export interface PublicSetting {
  value: string | null;
  source: Source;
}
export interface PublicSecret {
  secret: true;
  set: boolean;
  fingerprint: string | null;
  source: Source;
}
export type PublicSettings = Record<SettingKey, PublicSetting | PublicSecret>;

/** Every setting with its source; secrets reduced to a fingerprint. Defaults are filled in. */
export function publicSettings(env: Env = process.env, dataDir: string): PublicSettings {
  const file = readEnvFile(join(dataDir, ENV_FILE));
  const raw = rawSettings(env, file);
  const sharing = effectiveSharing(file, env);
  const settings = settingsFrom(raw, sharing);
  const defaults: Partial<Record<SettingKey, string>> = {
    WIZARDINGCODE_MEM_TYPESAFE: settings.typesafe,
    WIZARDINGCODE_MEM_SEMANTIC: settings.semantic,
    WIZARDINGCODE_MEM_RETENTION_DAYS: String(settings.retentionDays),
    WIZARDINGCODE_MEM_HISTORY_DAYS: String(settings.historyDays),
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: settings.uiAutoOpen ? "on" : "off",
    WIZARDINGCODE_MEM_UPDATE: "check",
    WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS: String(settings.backup.everyHours),
    WIZARDINGCODE_MEM_BACKUP_KEEP: String(settings.backup.keep),
    WIZARDINGCODE_MODULES: DEFAULTS.modules,
  };
  const out = {} as PublicSettings;
  for (const key of SETTING_KEYS) {
    const { value, source } = raw[key];
    if (SECRET_KEYS.has(key)) {
      out[key] = {
        secret: true,
        set: value !== null,
        fingerprint: value === null ? null : keyFingerprint(value),
        source,
      };
    } else if (key === SHARE_ROOTS || key === SHARE_AREAS) {
      // Not the environment's to win: the value is the list in force, and the source is
      // the environment only where it narrowed the file's list.
      out[key] = { value: shareListText(sharing[key].list), source: sharing[key].source };
    } else {
      out[key] = { value: value ?? defaults[key] ?? null, source };
    }
  }
  return out;
}
