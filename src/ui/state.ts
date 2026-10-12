// Where the running viewer is: a small file in the brand's home directory, readable by its
// owner only, so that a session starting later can show the viewer that is already
// there instead of starting another. A viewer that died leaves a stale file; a probe
// tells the two apart, so the file is never trusted on its own.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const UI_STATE_FILE = "ui.json";

export interface UiState {
  pid: number;
  origin: string;
  token: string;
  startedAt: number;
}

function parse(path: string): UiState | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<UiState>;
    return typeof parsed.pid === "number" &&
      typeof parsed.origin === "string" &&
      typeof parsed.token === "string" &&
      typeof parsed.startedAt === "number"
      ? { pid: parsed.pid, origin: parsed.origin, token: parsed.token, startedAt: parsed.startedAt }
      : null;
  } catch {
    return null;
  }
}

/**
 * The state lives at the brand level (`homeDir`), shared by every module. A file left
 * by an older version in the memory data directory (`legacyDir`) is moved there on
 * read. Sessions starting together may all do the move: the brand file is created
 * exclusively, the old one removed with `force`, and a reader that lost the race looks
 * at the brand file again, so every one of them sees the same single app.
 */
export function readUiState(homeDir: string, legacyDir?: string): UiState | null {
  const brandPath = join(homeDir, UI_STATE_FILE);
  const current = parse(brandPath);
  const oldPath = legacyDir === undefined ? undefined : join(legacyDir, UI_STATE_FILE);
  if (oldPath === undefined || oldPath === brandPath) return current;
  if (current !== null) {
    rmSync(oldPath, { force: true });
    return current;
  }
  const old = parse(oldPath);
  if (old === null) return parse(brandPath);
  try {
    mkdirSync(homeDir, { recursive: true, mode: 0o700 });
    writeFileSync(brandPath, JSON.stringify(old), { mode: 0o600, flag: "wx" });
  } catch {
    // Another session moved it first (or the directory is not writable): fall through.
  }
  rmSync(oldPath, { force: true });
  return parse(brandPath) ?? old;
}

/**
 * Records this viewer. `exclusive` refuses when a file is already there, so that two
 * viewers racing to start leave exactly one on record; the other one stands down.
 */
export function writeUiState(homeDir: string, state: UiState, exclusive = false): boolean {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(homeDir, UI_STATE_FILE), JSON.stringify(state), {
      mode: 0o600,
      flag: exclusive ? "wx" : "w",
    });
    return true;
  } catch (error) {
    if (exclusive && (error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** Removes the record, but only the given viewer's own. */
export function clearUiState(homeDir: string, pid?: number, legacyDir?: string): void {
  if (pid !== undefined && readUiState(homeDir, legacyDir)?.pid !== pid) return;
  rmSync(join(homeDir, UI_STATE_FILE), { force: true });
}

/** True when a viewer answers at the recorded address with the recorded token. */
export async function probeUi(state: UiState, timeoutMs = 300): Promise<boolean> {
  try {
    const response = await fetch(`${state.origin}/api/ping`, {
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Asks a live viewer to show itself; it decides whether a tab is already there. */
export async function askToOpen(state: UiState, timeoutMs = 2000): Promise<boolean> {
  try {
    const response = await fetch(`${state.origin}/api/open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
