/**
 * The embedding model as the rest of the product sees it: one file under the data directory,
 * opened lazily, once per process, and reopened when the file is replaced (a re-download, a
 * delete). Hooks never call this: it is for the viewer, the MCP server and the CLI.
 *
 * Packs are never modified in place (see openPack), so an old Model keeps answering from the
 * inode it mapped while a newer one is opened from the new file.
 */

import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadSettings } from "../settings/settings.ts";
import { logError } from "../util/log.ts";
import { embed } from "./embed.ts";
import { openPack, type Pack } from "./pack.ts";

export const MODEL_FILE = "potion-multilingual-128M.wcpack";
const MODEL_NAME = "potion-multilingual-128M";

export interface Model {
  pack: Pack;
  embed(text: string): Float32Array | null;
  /** `potion-multilingual-128M@<sha256 prefix>`: changes when the file's content does. */
  id: string;
}

export function modelPath(dataDir: string): string {
  return join(dataDir, "models", MODEL_FILE);
}

interface Signature {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

const sameFile = (a: Signature, b: Signature): boolean =>
  a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

interface Opened {
  path: string;
  signature: Signature;
  model: Model | null;
  reason: string | null;
}

let cached: Opened | null = null;

/** The most of the file the id looks at: the header and charsmap sit well inside it. */
export const ID_SAMPLE_BYTES = 1 << 20;

/** The first bytes of the file, at most ID_SAMPLE_BYTES; never the whole 146 MB pack. */
export function modelIdSample(path: string): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(ID_SAMPLE_BYTES);
    const n = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

/**
 * Changes when the header (model, revision, counts), the charsmap or the file size change, which
 * is what a different pack build does. A same-size edit confined to the rows would not change it;
 * packs are only ever replaced whole, and the download verifies the full sha256.
 */
function idOf(path: string, size: number): string {
  const hash = createHash("sha256").update(modelIdSample(path)).update(String(size));
  return `${MODEL_NAME}@${hash.digest("hex").slice(0, 12)}`;
}

function open(path: string, signature: Signature): Opened {
  const result = openPack(path);
  if (!result.ok) {
    logError("model", new Error(`${MODEL_FILE}: ${result.reason}`));
    return { path, signature, model: null, reason: result.reason };
  }
  try {
    const { pack } = result;
    const model: Model = {
      pack,
      embed: (text) => embed(pack, text),
      id: idOf(path, signature.size),
    };
    return { path, signature, model, reason: null };
  } catch (error) {
    result.pack.close();
    const reason = error instanceof Error ? error.message : String(error);
    return { path, signature, model: null, reason };
  }
}

function statOf(path: string): Signature | null {
  try {
    const s = statSync(path);
    return { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/** The model when present, valid and switched on; null otherwise. Cached per process. */
export function loadModel(options: {
  dataDir: string;
  env?: Record<string, string | undefined>;
}): Model | null {
  try {
    const env = options.env ?? process.env;
    if (loadSettings(env, options.dataDir).semantic === "off") return null;
    const path = modelPath(options.dataDir);
    const signature = statOf(path);
    if (!signature) {
      cached = null;
      return null;
    }
    // A failed open is cached too, so a corrupt file is parsed (and logged) once, not per call.
    if (!cached || cached.path !== path || !sameFile(cached.signature, signature)) {
      cached = open(path, signature);
    }
    return cached.model;
  } catch (error) {
    logError("model", error);
    return null;
  }
}

type ModelState = { present: boolean; bytes: number; enabled: boolean; reason: string | null };

/** Never throws: a failure is reported as the reason. */
export function modelState(dataDir: string): ModelState {
  try {
    return stateOf(dataDir);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { present: false, bytes: 0, enabled: false, reason };
  }
}

function stateOf(dataDir: string): ModelState {
  const enabled = loadSettings(process.env, dataDir).semantic === "on";
  const path = modelPath(dataDir);
  const signature = statOf(path);
  if (!signature) return { present: false, bytes: 0, enabled, reason: null };
  let reason: string | null = null;
  if (enabled) {
    if (!cached || cached.path !== path || !sameFile(cached.signature, signature)) {
      cached = open(path, signature);
    }
    reason = cached.reason;
  }
  return { present: true, bytes: signature.size, enabled, reason };
}
