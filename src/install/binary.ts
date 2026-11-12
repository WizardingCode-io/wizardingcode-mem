import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isVersion, olderThan } from "../util/version.ts";

/** How long a staged binary gets to answer `--version` before it counts as not answering. */
const VERSION_TIMEOUT_MS = 10_000;

/** Where the staged binary lives: the one path the hosts' configuration points at. */
export function stagedPath(dataDir: string): string {
  return join(
    dataDir,
    "bin",
    process.platform === "win32" ? "wizardingcode-mem.exe" : "wizardingcode-mem",
  );
}

/** The version a staged binary answers, or null when it cannot be run or answers anything else. */
export function stagedVersion(target: string, timeoutMs = VERSION_TIMEOUT_MS): string | null {
  try {
    const out = Bun.spawnSync([target, "--version"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: timeoutMs,
    });
    const answer = out.stdout.toString().trim();
    return out.exitCode === 0 && isVersion(answer) ? answer : null;
  } catch {
    return null;
  }
}

/**
 * Copies the binary to a stable place inside the data directory and returns that path.
 * Host configuration points there, so it keeps working when the download is deleted,
 * a version manager switches, or a plugin directory moves.
 *
 * The staged binary only moves forward: one of a higher version than `options.version`
 * (the source's) is left in place and named in `kept`, unless `options.force`. One of the
 * same or a lower version, and one that does not answer `--version` with a version, is
 * replaced.
 */
export function stageBinary(
  source: string,
  dataDir: string,
  options: { version: string; force: boolean },
): { path: string; kept: string | null } {
  const target = stagedPath(dataDir);
  const dir = dirname(target);
  if (resolve(source) === resolve(target)) return { path: target, kept: null };
  if (!options.force && existsSync(target)) {
    const staged = stagedVersion(target);
    if (staged !== null && olderThan(options.version, staged))
      return { path: target, kept: staged };
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = `${target}.new`;
  copyFileSync(source, temporary);
  chmodSync(temporary, 0o755);
  renameSync(temporary, target);
  return { path: target, kept: null };
}
