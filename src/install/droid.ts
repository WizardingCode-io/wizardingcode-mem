import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defaultDataDir } from "../util/paths.ts";
import { run } from "./context.ts";
import {
  HOOK_TIMEOUT_SECONDS,
  type HostSpec,
  hasComments,
  type InstallContext,
  type InstallResult,
  inspectHooksFile,
  installHooksFile,
  type UninstallResult,
  uninstallHooksFile,
} from "./hooks-file.ts";
import { ourShellHookBinary, shellHookCommand } from "./shell-hook.ts";

// Factory Droid: hooks go in ~/.factory/hooks.json, keyed directly by event. Droid reads the
// "hooks" key of settings.json only when hooks.json is absent, so a hooks.json we create starts
// as a copy of those, and they keep running; settings.json itself is never written, and
// uninstall removes the hooks.json it created, putting Droid back on settings.json. MCP servers
// live in ~/.factory/mcp.json. No environment variable that moves ~/.factory is documented. The hook
// timeout is in seconds.

export type DroidContext = InstallContext & { mcpPath: string };

export const DROID: HostSpec = {
  agent: "droid",
  unwrapped: true,
  events: [
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "prompt"],
    ["Stop", "turn-end"],
    ["SessionEnd", "session-end"],
  ],
  entry: (binaryPath, event) => ({
    type: "command",
    command: shellHookCommand(binaryPath, "droid", event),
    timeout: HOOK_TIMEOUT_SECONDS,
  }),
  isOurs: (hook) => ourShellHookBinary(hook, "droid") !== null,
  binaryOf: (hook) => ourShellHookBinary(hook, "droid") ?? "",
  mcpAdd: () => [],
  mcpRemove: [],
  mcpFile: (context) => (context as DroidContext).mcpPath,
  seed: (context) => settingsHooks(join(dirname(context.settingsPath), "settings.json")),
  notes: [],
};

/** The hooks in Droid's settings.json, when it has any; throws, naming the file, when it cannot be read. */
function settingsHooks(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Its hooks have to be copied before hooks.json exists, or Droid stops running them.
    throw new Error(
      hasComments(text)
        ? `comments in ${path} are not supported yet; remove them and run this again`
        : `${path} is not valid JSON; fix it and run this again`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const hooks = (parsed as Record<string, unknown>).hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return null;
  return Object.keys(hooks).length > 0 ? (hooks as Record<string, unknown>) : null;
}

export const installDroid = (context: DroidContext): InstallResult =>
  installHooksFile(DROID, context);
export const uninstallDroid = (context: DroidContext): UninstallResult =>
  uninstallHooksFile(DROID, context);
export const inspectDroidSettings = (text: string, path = "hooks.json") =>
  inspectHooksFile(DROID, text, path);

export function droidContext(
  binaryPath: string,
  env: Record<string, string | undefined> = process.env,
): DroidContext & { configDir: string } {
  const configDir = join(env.HOME || homedir(), ".factory");
  return {
    configDir,
    settingsPath: join(configDir, "hooks.json"),
    mcpPath: join(configDir, "mcp.json"),
    dataDir: defaultDataDir(env),
    binaryPath,
    run,
    now: Date.now,
  };
}
