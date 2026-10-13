// The product's settings: the environment first, then `<data dir>/env`, then the
// defaults. Keys are named exactly like the environment variables, so the file reads
// like a shell would. This runs on the hook path: node:fs only, one small file read.
import { isAbsolute, join, win32 } from "node:path";
import { keyFingerprint } from "../judge/key.ts";
import { ENV_FILE, readEnvFile, writeEnvFile } from "./env-file.ts";

export { ENV_FILE };

export const SETTING_KEYS = [
  "TYPESAFE_API_KEY",
  "WIZARDINGCODE_MEM_TYPESAFE",
  "WIZARDINGCODE_MEM_SEMANTIC",
  "WIZARDINGCODE_MEM_RETENTION_DAYS",
  "WIZARDINGCODE_MEM_HISTORY_DAYS",
  "WIZARDINGCODE_MEM_UI_AUTO_OPEN",
  "WIZARDINGCODE_MEM_STORE_DIR",
  "WIZARDINGCODE_MODULES",
  "WIZARDINGCODE_MEM_BACKUP_TO",
  "WIZARDINGCODE_MEM_BACKUP_EVERY_HOURS",
  "WIZARDINGCODE_MEM_BACKUP_KEEP",
  "WIZARDINGCODE_MEM_BACKUP_S3_ENDPOINT",
  "WIZARDINGCODE_MEM_BACKUP_S3_REGION",
  "WIZARDINGCODE_MEM_BACKUP_S3_ACCESS_KEY",
  "WIZARDINGCODE_MEM_BACKUP_S3_SECRET_KEY",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

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
  /** The modules on, as the comma list it was given; null means the default (memory). */
  modules: string | null;
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
  modules: "memory",
} as const;

const RETENTION = { min: 7, max: 3650 };
const HISTORY_DAYS = { min: 1, max: 3650 };
const EVERY_HOURS = { min: 0, max: 24 * 30 };
const KEEP = { min: 1, max: 1000 };

export type Source = "env" | "file" | "default";

type Env = Record<string, string | undefined>;

/** The raw value of each key and where it came from. */
function rawSettings(
  env: Env,
  dataDir: string,
): Record<SettingKey, { value: string | null; source: Source }> {
  const file = readEnvFile(join(dataDir, ENV_FILE));
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

export function loadSettings(env: Env = process.env, dataDir: string): Settings {
  const raw = rawSettings(env, dataDir);
  const value = (key: SettingKey) => raw[key].value;
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
  WIZARDINGCODE_MEM_STORE_DIR: () => "the store directory is changed by moving the store, not here",
  WIZARDINGCODE_MODULES: (v) => {
    const ids = moduleList(v).split(",");
    if (!ids.every((id) => MODULE_ID.test(id))) return "a comma list of module ids, such as memory";
    return ids.includes("memory")
      ? null
      : "memory is always on in this version: list it first, then the modules to add";
  },
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
    const problem = RULES[settingKey](text);
    if (problem !== null) errors[key] = problem;
    else changes[settingKey] = settingKey === "WIZARDINGCODE_MODULES" ? moduleList(text) : text;
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
  const raw = rawSettings(env, dataDir);
  const settings = loadSettings(env, dataDir);
  const defaults: Partial<Record<SettingKey, string>> = {
    WIZARDINGCODE_MEM_TYPESAFE: settings.typesafe,
    WIZARDINGCODE_MEM_SEMANTIC: settings.semantic,
    WIZARDINGCODE_MEM_RETENTION_DAYS: String(settings.retentionDays),
    WIZARDINGCODE_MEM_HISTORY_DAYS: String(settings.historyDays),
    WIZARDINGCODE_MEM_UI_AUTO_OPEN: settings.uiAutoOpen ? "on" : "off",
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
    } else {
      out[key] = { value: value ?? defaults[key] ?? null, source };
    }
  }
  return out;
}
