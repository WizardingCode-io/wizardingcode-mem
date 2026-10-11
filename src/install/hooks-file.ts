import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { AgentId, HookEvent, RetiredAgentId } from "../core/types.ts";

// Installs wizardingcode-mem into a host's hooks file and removes it again. Claude Code and
// Codex share the file's shape (event → groups → hooks); a HostSpec says what differs.
//
// The file belongs to the user. It is backed up before it is touched, only entries
// that are recognisably ours are ever changed, and a receipt records enough to put the
// file back exactly as it was.

/** What differs between hosts that keep hooks in a JSON file of the same shape. */
export interface HostSpec {
  /** A retired id only for recognising and removing what an old install left. */
  agent: AgentId | RetiredAgentId;
  /** The host's event names and ours; the optional third item is the host's tool matcher. */
  events: readonly (readonly [string, HookEvent, string?])[];
  /** The entry, inside a group's `hooks` array, that runs our binary for an event. */
  entry(binaryPath: string, event: HookEvent): Json;
  /** Recognises an entry of ours, whichever binary path it names. */
  isOurs(entry: unknown): boolean;
  /** The binary an entry of ours runs. */
  binaryOf(entry: Json): string;
  /** The host's own commands for its MCP server registry. */
  mcpAdd(binaryPath: string): string[];
  mcpRemove: string[];
  /** When set, the MCP server is written into this JSON file instead (`mcpServers`). */
  mcpFile?: (context: InstallContext) => string;
  /** The server's entry in `mcpFile`, when the host wants more than `{ command, args }`. */
  mcpEntry?: (binaryPath: string) => Json;
  /**
   * The MCP server goes into the hooks file's own `mcpServers` (Qwen Code), in the same
   * write as the hooks, so that the receipt still describes the whole file.
   */
  mcpInSettings?: boolean;
  /** grouped: event → [{ hooks: [entry] }] (Claude Code, Codex, Qwen Code). flat: event → [entry] (Cursor). */
  layout?: "grouped" | "flat";
  /** The file is the event map itself, with no `hooks` key around it (Factory Droid's hooks.json). */
  unwrapped?: boolean;
  /**
   * The file maps hook names to their event maps (Antigravity's hooks.json): ours is the one
   * under this name, and every other name in the file is the user's.
   */
  definition?: string;
  /** Keys the file must hold besides `hooks`, such as Cursor's `version`. */
  topLevel?: Json;
  /** Anything the user still has to do by hand after installing. */
  notes: string[];
}

export interface InstallContext {
  /** The host's hooks file (Claude Code: settings.json; Codex: hooks.json). */
  settingsPath: string;
  /** The host's MCP configuration file, for hosts without a command to register servers. */
  mcpPath?: string;
  dataDir: string;
  /** Absolute path the hooks will execute. */
  binaryPath: string;
  /** Runs a host command. Must not throw: a missing command is `ok: false`. */
  run: (command: string[]) => { ok: boolean; output: string };
  now: () => number;
}

export interface InstallResult {
  settingsPath: string;
  changed: boolean;
  mcp: "registered" | "manual";
  /** The command that registers the MCP server, for when it has to be run by hand. */
  mcpCommand: string[];
  /** The file the server was written into, for hosts without a command. */
  mcpPath?: string;
  notes: string[];
}

export interface UninstallResult {
  settingsPath: string;
  /** restored: original bytes put back. removed: file we created deleted. edited: our entries taken out. */
  settings: "restored" | "removed" | "edited" | "untouched";
}

interface Receipt {
  agent: AgentId | RetiredAgentId;
  installedAt: number;
  binaryPath: string;
  settingsPath: string;
  existedBefore: boolean;
  backupPath: string | null;
  /** Hash of the settings file as we left it; equal means nobody changed it since. */
  installedSha256: string;
}

type Json = Record<string, unknown>;
/** Where a file of named definitions is kept, whole, while ours is worked on as `hooks`; nothing else is at that level. */
const DEFINITIONS = "definitions";

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
// One receipt per settings file: several Claude Code profiles may share a data directory.
const profileKey = (settingsPath: string) => sha256(settingsPath).slice(0, 12);
const receiptPath = (dataDir: string, agent: HostSpec["agent"], settingsPath: string) =>
  join(dataDir, "install", `${agent}-${profileKey(settingsPath)}.json`);

/** The file to read and write: the target, when the settings file is a symlink into dotfiles. */
function resolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function parseSettings(path: string, text: string | null, spec?: HostSpec): Json {
  if (text === null || text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON; fix it and run this again`);
  }
  if (!isObject(parsed)) throw new Error(`${path} does not hold a JSON object`);
  // An unwrapped file is the event map: seen from here, it is what sits under `hooks`.
  if (spec?.unwrapped) return { hooks: parsed };
  // A file of named definitions: ours is seen as `hooks`, the whole file is kept beside it.
  if (spec?.definition !== undefined) {
    const ours = parsed[spec.definition];
    if (ours !== undefined && !isObject(ours)) {
      throw new Error(
        `"${spec.definition}" in ${path} is not an object; fix it and run this again`,
      );
    }
    return { hooks: ours ?? {}, [DEFINITIONS]: parsed };
  }
  if (parsed.hooks !== undefined && !isObject(parsed.hooks)) {
    throw new Error(`"hooks" in ${path} is not an object; fix it and run this again`);
  }
  return parsed;
}

/** The settings without any hook of ours; hook groups and events left empty are dropped. */
function withoutOurs(spec: HostSpec, settings: Json): { settings: Json; removed: number } {
  if (!isObject(settings.hooks)) return { settings, removed: 0 };
  let removed = 0;
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    if (spec.layout === "flat") {
      const others = groups.filter((entry) => !spec.isOurs(entry));
      removed += groups.length - others.length;
      if (others.length > 0 || groups.length === 0) hooks[event] = others;
      continue;
    }
    const kept: unknown[] = [];
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const others = group.hooks.filter((hook) => !spec.isOurs(hook));
      removed += group.hooks.length - others.length;
      if (others.length === group.hooks.length) kept.push(group);
      else if (others.length > 0) kept.push({ ...group, hooks: others });
    }
    if (kept.length > 0 || groups.length === 0) hooks[event] = kept;
  }
  const result: Json = { ...settings, hooks };
  if (removed > 0 && Object.keys(hooks).length === 0) delete result.hooks;
  if (spec.mcpInSettings && isObject(settings.mcpServers)) {
    const { [MCP_NAME]: ours, [LEGACY_MCP_NAME]: legacy, ...servers } = settings.mcpServers;
    if (ours !== undefined || legacy !== undefined) {
      removed += 1;
      result.mcpServers = servers;
      if (Object.keys(servers).length === 0) delete result.mcpServers;
    }
  }
  return { settings: result, removed };
}

function withOurs(spec: HostSpec, settings: Json, binaryPath: string): Json {
  const hooks: Json = { ...(isObject(settings.hooks) ? settings.hooks : {}) };
  for (const [hostEvent, event, matcher] of spec.events) {
    const groups = hooks[hostEvent];
    const entry = spec.entry(binaryPath, event);
    hooks[hostEvent] = [
      ...(Array.isArray(groups) ? groups : []),
      spec.layout === "flat"
        ? entry
        : matcher === undefined
          ? { hooks: [entry] }
          : { matcher, hooks: [entry] },
    ];
  }
  const result: Json = { ...(spec.topLevel ?? {}), ...settings, hooks };
  if (spec.mcpInSettings) {
    const servers = isObject(settings.mcpServers) ? settings.mcpServers : {};
    result.mcpServers = { ...servers, [MCP_NAME]: { command: binaryPath, args: ["mcp"] } };
  }
  return result;
}

/** The text of a hooks file: the settings as they are, or for an unwrapped file its event map. */
function render(spec: HostSpec, settings: Json, previous: string | null): string {
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  if (spec.definition !== undefined) {
    // Our definition keeps its place in the file; one with no hook left in it goes.
    const file: Json = { ...(settings[DEFINITIONS] as Json), [spec.definition]: hooks };
    if (!Object.values(hooks).some((handlers) => Array.isArray(handlers) && handlers.length > 0)) {
      delete file[spec.definition];
    }
    return serialise(file, previous);
  }
  return serialise(spec.unwrapped ? hooks : settings, previous);
}

/** Serialises in the file's own style: its indentation, and its final newline or lack of one. */
function serialise(settings: Json, previous: string | null): string {
  const indent = previous === null ? "  " : (/\n([ \t]+)\S/.exec(previous)?.[1] ?? "  ");
  const newline = previous === null || previous.endsWith("\n") ? "\n" : "";
  return JSON.stringify(settings, null, indent) + newline;
}

function writeAtomically(path: string, text: string): void {
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
  const temporary = `${path}.wizardingcode-mem-new`;
  writeFileSync(temporary, text, { mode });
  renameSync(temporary, path);
}

function readReceipt(
  dataDir: string,
  agent: HostSpec["agent"],
  settingsPath: string,
): Receipt | null {
  try {
    const receipt = JSON.parse(
      readFileSync(receiptPath(dataDir, agent, settingsPath), "utf8"),
    ) as Receipt;
    return receipt.agent === agent && receipt.settingsPath === settingsPath ? receipt : null;
  } catch {
    return null;
  }
}

export function installHooksFile(spec: HostSpec, context: InstallContext): InstallResult {
  const { settingsPath, dataDir, binaryPath } = context;
  const file = resolved(settingsPath);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : null;
  // Validated before anything is changed or run.
  const settings = parseSettings(settingsPath, previous, spec);
  if (spec.mcpInSettings && settings.mcpServers !== undefined && !isObject(settings.mcpServers)) {
    throw new Error(`"mcpServers" in ${settingsPath} is not an object; fix it and run this again`);
  }
  const next = render(
    spec,
    withOurs(spec, withoutOurs(spec, settings).settings, binaryPath),
    previous,
  );
  const changed = next !== previous;

  if (changed) {
    const installDir = join(dataDir, "install");
    mkdirSync(join(installDir, "backups"), { recursive: true, mode: 0o700 });

    // An earlier receipt still describes this file only if nobody has changed the file
    // since we wrote it. Otherwise its backup is of a file that no longer exists, and
    // restoring it later would throw away whatever was done in between.
    const earlier = readReceipt(dataDir, spec.agent, settingsPath);
    const earlierHolds =
      earlier !== null && previous !== null && sha256(previous) === earlier.installedSha256;
    let existedBefore: boolean;
    let backupPath: string | null;
    if (earlier !== null && earlierHolds) {
      ({ existedBefore, backupPath } = earlier);
    } else {
      if (earlier?.backupPath) rmSync(earlier.backupPath, { force: true });
      existedBefore = previous !== null;
      backupPath = null;
      // Only the user's own file, from before any install of ours, is worth putting back.
      if (earlier === null && previous !== null) {
        backupPath = join(
          installDir,
          "backups",
          `${spec.agent}-settings-${profileKey(settingsPath)}-${context.now()}.json`,
        );
        copyFileSync(file, backupPath);
        chmodSync(backupPath, 0o600);
      }
    }

    mkdirSync(dirname(file), { recursive: true });
    writeAtomically(file, next);
    const receipt: Receipt = {
      agent: spec.agent,
      installedAt: context.now(),
      binaryPath,
      settingsPath,
      existedBefore,
      backupPath,
      installedSha256: sha256(next),
    };
    writeFileSync(
      receiptPath(dataDir, spec.agent, settingsPath),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  const mcpCommand = spec.mcpAdd(binaryPath);
  if (spec.mcpInSettings) {
    return {
      settingsPath,
      changed,
      mcp: "registered",
      mcpCommand,
      mcpPath: settingsPath,
      notes: spec.notes,
    };
  }
  if (spec.mcpFile !== undefined) {
    const mcpPath = spec.mcpFile(context);
    writeMcpServer(mcpPath, spec.mcpEntry?.(binaryPath) ?? mcpServerEntry(binaryPath));
    return { settingsPath, changed, mcp: "registered", mcpCommand, mcpPath, notes: spec.notes };
  }
  // Otherwise the MCP server is registered through the host's own command: its config
  // file holds unrelated state and is rewritten by the application itself.
  context.run(spec.mcpRemove);
  context.run(legacyMcpRemove(spec));
  const mcp = context.run(mcpCommand).ok ? "registered" : "manual";
  return { settingsPath, changed, mcp, mcpCommand, notes: spec.notes };
}

/** The host's command that removes the server under the name it had until 0.3.0. */
const legacyMcpRemove = (spec: HostSpec): string[] =>
  spec.mcpRemove.map((word) => (word === MCP_NAME ? LEGACY_MCP_NAME : word));

const mcpServerEntry = (binaryPath: string): Json => ({ command: binaryPath, args: ["mcp"] });

/** Adds our server to a host's `mcpServers` file, keeping every other entry. */
function writeMcpServer(path: string, entry: Json): void {
  const file = resolved(path);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : null;
  const config = parseSettings(path, previous);
  const { [LEGACY_MCP_NAME]: _legacy, ...servers } = isObject(config.mcpServers)
    ? config.mcpServers
    : {};
  const next = serialise({ ...config, mcpServers: { ...servers, [MCP_NAME]: entry } }, previous);
  if (next === previous) return;
  mkdirSync(dirname(file), { recursive: true });
  writeAtomically(file, next);
}

/** Takes our server out of a host's `mcpServers` file; a file left empty by that goes away. */
function removeMcpServer(path: string): void {
  const file = resolved(path);
  if (!existsSync(file)) return;
  const previous = readFileSync(file, "utf8");
  let config: Json;
  try {
    config = parseSettings(path, previous);
  } catch {
    return;
  }
  if (
    !isObject(config.mcpServers) ||
    !(MCP_NAME in config.mcpServers || LEGACY_MCP_NAME in config.mcpServers)
  ) {
    return;
  }
  const { [MCP_NAME]: _ours, [LEGACY_MCP_NAME]: _legacy, ...servers } = config.mcpServers;
  const next: Json = { ...config, mcpServers: servers };
  if (Object.keys(servers).length === 0) delete next.mcpServers;
  if (Object.keys(next).length === 0) rmSync(file);
  else writeAtomically(file, serialise(next, previous));
}

export function uninstallHooksFile(spec: HostSpec, context: InstallContext): UninstallResult {
  const { settingsPath, dataDir } = context;
  const file = resolved(settingsPath);
  const receipt = readReceipt(dataDir, spec.agent, settingsPath);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  let outcome: UninstallResult["settings"] = "untouched";

  if (current !== null) {
    const untouchedSinceInstall = receipt !== null && sha256(current) === receipt.installedSha256;
    if (untouchedSinceInstall && !receipt.existedBefore) {
      rmSync(settingsPath);
      outcome = "removed";
    } else if (
      untouchedSinceInstall &&
      receipt.backupPath !== null &&
      existsSync(receipt.backupPath)
    ) {
      // Nobody changed the file since: the original bytes go back exactly.
      writeAtomically(file, readFileSync(receipt.backupPath, "utf8"));
      outcome = "restored";
    } else {
      // The file has moved on: take out what is ours and keep everything else.
      const { settings, removed } = withoutOurs(spec, parseSettings(settingsPath, current, spec));
      if (removed > 0) {
        writeAtomically(file, render(spec, settings, current));
        outcome = "edited";
      }
    }
  }

  // With mcpInSettings, the server already left with the hooks above.
  if (spec.mcpFile !== undefined) removeMcpServer(spec.mcpFile(context));
  else if (!spec.mcpInSettings) {
    context.run(spec.mcpRemove);
    context.run(legacyMcpRemove(spec));
  }
  if (receipt?.backupPath) rmSync(receipt.backupPath, { force: true });
  rmSync(receiptPath(dataDir, spec.agent, settingsPath), { force: true });
  return { settingsPath, settings: outcome };
}

/** What of ours a hooks file holds: which events are hooked, and to which binaries. */
export function inspectHooksFile(
  spec: HostSpec,
  text: string,
): { events: string[]; binaries: string[] } {
  const settings = parseSettings("settings.json", text, spec);
  const events: string[] = [];
  const binaries = new Set<string>();
  if (isObject(settings.hooks)) {
    for (const hostEvent of new Set(spec.events.map(([name]) => name))) {
      const groups = settings.hooks[hostEvent];
      for (const group of Array.isArray(groups) ? groups : []) {
        const entries =
          spec.layout === "flat"
            ? [group]
            : isObject(group) && Array.isArray(group.hooks)
              ? group.hooks
              : [];
        for (const hook of entries) {
          if (spec.isOurs(hook)) {
            if (!events.includes(hostEvent)) events.push(hostEvent);
            binaries.add(spec.binaryOf(hook as Json));
          }
        }
      }
    }
  }
  return { events, binaries: [...binaries] };
}

export const MCP_NAME = "wizardingcode-mem";
/** The name until 0.3.0. An install takes its place; nothing installs it any more. */
export const LEGACY_MCP_NAME = "shibaox-mem";

/** A binary of ours, under this name or the one it had until 0.3.0. */
export const isOurBinaryName = (name: string): boolean =>
  name.startsWith(MCP_NAME) || name.startsWith(LEGACY_MCP_NAME);
export const HOOK_TIMEOUT_SECONDS = 5;
export type { Json as HookEntry };
