import { existsSync } from "node:fs";
import { ADAPTERS } from "../../adapters/index.ts";
import { backupDue } from "../../backup/schedule.ts";
import type { HookEvent } from "../../core/types.ts";
import { historyDbPath } from "../../history/path.ts";
import { handleHook } from "../../hooks/handle.ts";
import { loadSettings } from "../../settings/settings.ts";
import { type Db, openDb } from "../../store/db.ts";
import { errorLabel, logError } from "../../util/log.ts";
import { defaultDataDir, resolvePaths } from "../../util/paths.ts";
import { spawnDetached } from "../../util/self.ts";

// How long each event may wait for another process's database lock. The two events
// that sit between the user and the model get the least.
const BUSY_TIMEOUT_MS: Record<HookEvent, number> = {
  "session-start": 150,
  prompt: 100,
  "turn-end": 1000,
  "session-end": 1000,
  // Like a prompt: the agent waits for these before going on.
  "file-read": 100,
  "tool-failed": 100,
};

function isHookEvent(value: string | undefined): value is HookEvent {
  return value !== undefined && value in BUSY_TIMEOUT_MS;
}

const STDIN_TIMEOUT_MS = 1500;

/** The payload, or null when the host does not finish sending it in time. */
async function readStdin(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STDIN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Bun.stdin.text(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function spawnDistill(): void {
  // WIZARDINGCODE_MEM_DISTILL=off leaves queued turns for a later run, e.g. `wizardingcode-mem distill` by hand.
  if (process.env.WIZARDINGCODE_MEM_DISTILL !== "off") spawnDetached("distill");
}

/**
 * Indexes a finished session into the history index, but only for users who already
 * have one (they opted in by importing): one stat of a file, then a detached process.
 */
function spawnHistoryIndex(transcriptPath: string, agent: string): void {
  if (process.env.WIZARDINGCODE_MEM_DISTILL === "off") return;
  if (!existsSync(historyDbPath(resolvePaths().storeDir))) return;
  spawnDetached("history", "index", "--transcript", transcriptPath, "--agent", agent);
}

/**
 * Shows the viewer for a session that just began, unless no one would see it: a
 * non-interactive run (CI), a remote shell, a Linux box without a display, or the user
 * turned it off (WIZARDINGCODE_MEM_UI_AUTO_OPEN=off). The work happens in `ui --auto`,
 * detached; this costs one small file read and one spawn.
 */
function spawnViewer(): void {
  const env = process.env;
  if (env.WIZARDINGCODE_MEM_UI_AUTO_OPEN === "off") return;
  if (env.CI || env.SSH_CONNECTION || env.SSH_TTY) return;
  if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) return;
  if (!loadSettings(env, defaultDataDir()).uiAutoOpen) return;
  spawnDetached("ui", "--auto");
}

/**
 * An agent runs this binary twice per event when wizardingcode-mem is installed in it both
 * directly (its own hooks file) and as a plugin. The plugin's run is the one that knows
 * what it is (it passes --via-plugin; Claude Code also sets CLAUDE_PLUGIN_ROOT), so it is
 * the one that stands down when the direct install is there.
 */
async function standsDownAsPlugin(agent: string, flags: string[]): Promise<boolean> {
  const viaPlugin =
    flags.includes("--via-plugin") || (agent === "claude-code" && !!process.env.CLAUDE_PLUGIN_ROOT);
  if (!viaPlugin) return false;
  try {
    // Loaded only on the plugin's path: the direct install never pays for it.
    const { readFileSync } = await import("node:fs");
    const { inspectHooksFile } = await import("../../install/hooks-file.ts");
    const direct = async () => {
      switch (agent) {
        case "claude-code": {
          const { CLAUDE_CODE } = await import("../../install/claude-code.ts");
          const { claudeCodeContext } = await import("../../install/context.ts");
          return { spec: CLAUDE_CODE, path: claudeCodeContext("").settingsPath };
        }
        case "codex": {
          const { CODEX, codexContext } = await import("../../install/codex.ts");
          return { spec: CODEX, path: codexContext("").settingsPath };
        }
        case "cursor": {
          const { CURSOR, cursorContext } = await import("../../install/cursor.ts");
          return { spec: CURSOR, path: cursorContext("").settingsPath };
        }
        default:
          return null;
      }
    };
    const found = await direct();
    if (found === null) return false;
    return inspectHooksFile(found.spec, readFileSync(found.path, "utf8")).events.length > 0;
  } catch {
    return false;
  }
}

/**
 * `wizardingcode-mem hook <agent> <event>`: reads the host's payload on stdin, may print context.
 *
 * Fails open, always. The host must see a successful hook whatever happens here:
 * exit code 2 would block the user's action, and stray output would be read as context.
 */
export async function run(argv: string[]): Promise<number> {
  const started = performance.now();
  const [agent, event, ...flags] = argv;
  let db: Db | undefined;
  let outcome = "ok";
  try {
    const adapter = agent === undefined ? undefined : ADAPTERS[agent];
    if (adapter === undefined || !isHookEvent(event) || process.stdin.isTTY) return 0;
    if (agent !== undefined && (await standsDownAsPlugin(agent, flags))) return 0;
    const payload = await readStdin();
    if (payload === null) {
      // The host never closed the pipe. Leaving at once matters more than this event;
      // the pending read would otherwise keep the process alive.
      logError(`hook ${agent} ${event}`, new Error("stdin was not closed by the host"));
      process.exit(0);
    }
    const input = adapter.parse(event, payload);
    if (input === null || input.subagent) return 0;

    db = openDb({ busyTimeoutMs: BUSY_TIMEOUT_MS[event] });
    const out = handleHook(
      {
        db,
        now: Date.now,
        spawnDistill,
        spawnViewer,
        spawnHistoryIndex,
        backupDue: () => {
          const { backup } = loadSettings(process.env, defaultDataDir());
          return (
            backup.to !== null &&
            backup.everyHours > 0 &&
            backupDue(db as Db, backup.everyHours, Date.now())
          );
        },
        spawnBackup: () => spawnDetached("backup"),
        onError: (error) => logError(`hook ${agent} ${event} (lookup)`, error),
      },
      adapter,
      input,
    );
    if (out !== "") process.stdout.write(out);
  } catch (error) {
    outcome = errorLabel(error);
    logError(`hook ${agent} ${event}`, error);
  } finally {
    if (db !== undefined) {
      try {
        db.run("INSERT INTO hook_runs (at, agent, event, ms, outcome) VALUES (?, ?, ?, ?, ?)", [
          Date.now(),
          agent ?? "",
          event ?? "",
          Math.round(performance.now() - started),
          outcome,
        ]);
      } catch {
        // Metrics are best effort.
      }
      db.close();
    }
  }
  return 0;
}
