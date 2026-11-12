// A copy older than the staged binary hands a person's command over to it, so that the
// command never meets a store the newer binary migrated. Nothing here stages a binary:
// only `install` does.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { stagedPath, stagedVersion } from "../install/binary.ts";
import { defaultDataDir } from "../util/paths.ts";
import { isCompiled } from "../util/self.ts";
import { olderThan } from "../util/version.ts";

export type Decision = "skip" | "compare";
const HANDED = "WIZARDINGCODE_MEM_HANDED";

/** Whether this process may look at the staged binary at all. It compares no version. */
export function decide(input: {
  platform: string;
  compiled: boolean;
  /** This process's real path. */
  self: string;
  /** The staged binary's real path, or null when there is none. */
  staged: string | null;
  handed: boolean;
  /** The effective user, or null where there is none to compare. */
  uid: number | null;
  /** Who owns the folder the staged binary is in. */
  binOwner: number | null;
}): Decision {
  if (input.platform === "win32" || !input.compiled) return "skip";
  if (input.staged === null || input.self === input.staged || input.handed) return "skip";
  // Never run, as root or for another user, a file that user can write.
  if (input.uid === null || input.uid === 0 || input.binOwner !== input.uid) return "skip";
  return "compare";
}

/** The environment of the staged binary a command is handed to: it must not hand over again. */
export function handedEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...env, [HANDED]: "1" };
}

/** Runs the staged binary with these arguments; its exit code is the answer. */
export function handOver(
  path: string,
  argv: string[],
  say: () => void,
  fail: (message: string) => string = (message) =>
    `wizardingcode-mem: could not run ${path}: ${message}\n`,
): number {
  say();
  try {
    const handed = Bun.spawnSync([path, ...argv], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: handedEnv(process.env),
    });
    return handed.exitCode ?? 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(fail(message.split("\n")[0] ?? message));
    return 1;
  }
}

const owner = (path: string): number | null => {
  try {
    return lstatSync(path).uid;
  } catch {
    return null;
  }
};

/**
 * Before a reconciled command runs: the exit code of the staged binary it was handed to, or
 * null when the command runs here.
 */
export function reconcile(argv: string[]): { code: number } | null {
  // Read, then removed: nothing this command starts may inherit it.
  const handed = Boolean(process.env[HANDED]);
  delete process.env[HANDED];
  const path = stagedPath(defaultDataDir());
  const exists = existsSync(path);
  const decision = decide({
    platform: process.platform,
    compiled: isCompiled(),
    self: realpathSync(process.execPath),
    staged: exists ? realpathSync(path) : null,
    handed,
    uid: process.geteuid?.() ?? null,
    binOwner: exists ? owner(dirname(path)) : null,
  });
  if (decision === "skip") return null;
  const staged = stagedVersion(path);
  if (staged === null || !olderThan(pkg.version, staged)) return null;
  return {
    code: handOver(path, argv, () => {
      process.stderr.write(
        `wizardingcode-mem: running ${staged} from ${path}; this copy is ${pkg.version}\n`,
      );
    }),
  };
}
