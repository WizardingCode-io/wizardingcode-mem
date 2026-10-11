/**
 * The one network access of the semantic feature, and only after the user asks for it: a fixed
 * URL, the size and sha256 pinned here, streamed to a private part file and renamed over the
 * final name only when both match. Whatever goes wrong, nothing is left under the final name
 * (a pack already there is replaced only by a verified one) and the part file is removed.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { MODEL_FILE, modelPath } from "./model.ts";

export const MODEL_URL =
  "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/model-potion-multilingual-128M-v1/potion-multilingual-128M.wcpack";
// Of the pack built in part 1; confirmed against the published asset in Task 7.
export const MODEL_SHA256 = "7d8362253e568e7bb24ff8be3f006f412973aa445a96c4c17b6f13a957825c6a";
export const MODEL_BYTES = 146383528;

export type DownloadResult = { ok: true; alreadyPresent?: true } | { ok: false; reason: string };

export interface DownloadOptions {
  dataDir: string;
  url?: string;
  sha256?: string;
  bytes?: number;
  fetch?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function sha256OfFile(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const chunk = Buffer.allocUnsafe(1 << 20);
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      hash.update(chunk.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function validPackAlreadyThere(path: string, sha256: string, bytes: number): boolean {
  try {
    return statSync(path).size === bytes && sha256OfFile(path) === sha256;
  } catch {
    return false;
  }
}

function remove(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}

export async function downloadModel(options: DownloadOptions): Promise<DownloadResult> {
  const url = options.url ?? MODEL_URL;
  const sha256 = options.sha256 ?? MODEL_SHA256;
  const bytes = options.bytes ?? MODEL_BYTES;
  const doFetch = options.fetch ?? fetch;
  const finalPath = modelPath(options.dataDir);
  const part = join(
    dirname(finalPath),
    `.${MODEL_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.part`,
  );
  let fd: number | null = null;
  try {
    mkdirSync(dirname(finalPath), { recursive: true });
    if (validPackAlreadyThere(finalPath, sha256, bytes)) return { ok: true, alreadyPresent: true };

    const response = await doFetch(url, { redirect: "follow" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason: `the server answered ${response.status} ${response.statusText}`.trim(),
      };
    }
    if ((response.headers.get("content-type") ?? "").toLowerCase().includes("text/html")) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason:
          "the server sent a web page (HTML) instead of the model; a proxy or captive portal may be in the way",
      };
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && Number(declared) !== bytes) {
      await response.body?.cancel().catch(() => {});
      return {
        ok: false,
        reason: `unexpected size: the server announced ${declared} bytes, expected ${bytes}`,
      };
    }
    if (!response.body) return { ok: false, reason: "the server sent no body" };

    fd = openSync(part, "w", 0o644);
    const hash = createHash("sha256");
    let done = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      done += value.length;
      if (done > bytes) {
        await reader.cancel().catch(() => {});
        return {
          ok: false,
          reason: `unexpected size: more than the expected ${bytes} bytes arrived`,
        };
      }
      hash.update(value);
      let offset = 0;
      while (offset < value.length) offset += writeSync(fd, value, offset, value.length - offset);
      options.onProgress?.(done, bytes);
    }
    closeSync(fd);
    fd = null;
    if (done !== bytes) {
      return {
        ok: false,
        reason: `unexpected size: ${done} bytes arrived, expected ${bytes} (${mb(done)} of ${mb(bytes)})`,
      };
    }
    if (hash.digest("hex") !== sha256) {
      return {
        ok: false,
        reason: "checksum (sha256) mismatch: the download is not the expected model",
      };
    }
    renameSync(part, finalPath);
    return { ok: true };
  } catch (error) {
    const message = messageOf(error);
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return {
      ok: false,
      reason: code === "ENOSPC" ? `the disk is full (${message})` : `download failed: ${message}`,
    };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    remove(part);
  }
}

/** Removes the pack. The vector tables are dropped by the tasks that create them. */
export function deleteModel(dataDir: string): void {
  remove(modelPath(dataDir));
}
