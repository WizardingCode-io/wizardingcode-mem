import { existsSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { doctorContext } from "../../doctor/context.ts";
import { stageBinary } from "../../install/binary.ts";
import { installClaudeCode } from "../../install/claude-code.ts";
import {
  claudeDesktopConfigPath,
  hasClaudeDesktop,
  installClaudeDesktop,
} from "../../install/claude-desktop.ts";
import { codexContext, installCodex } from "../../install/codex.ts";
import { claudeCodeContext } from "../../install/context.ts";
import { cursorContext, installCursor } from "../../install/cursor.ts";
import { AGENT_ORDER, detectAgents } from "../../install/detect.ts";
import { geminiContext, installGemini } from "../../install/gemini.ts";
import { offerHistoryImportHere } from "../../install/history-offer.ts";
import type { InstallResult } from "../../install/hooks-file.ts";
import { findLegacyPlugins } from "../../install/legacy-plugins.ts";
import { installOpenCode, opencodePluginPath } from "../../install/opencode.ts";
import {
  describeImport,
  describeStop,
  detectClaudeMem,
  importIntoDefaultStore,
  stopClaudeMem,
  takeoverContext,
} from "../../install/takeover.ts";
import { defaultDataDir } from "../../util/paths.ts";
import { isCompiled } from "../../util/self.ts";
import { EXIT_USAGE } from "../exit.ts";

export const SUPPORTED_AGENTS = [
  "claude-code",
  "claude-desktop",
  "codex",
  "cursor",
  "gemini",
  "opencode",
];
export const AGENT_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
};

const USAGE = `Usage: wizardingcode-mem install [<agent>] [--binary <path>] [--yes] [--keep-claude-mem] [--no-import] [--import-history | --no-import-history]

  <agent>             claude-code | claude-desktop | codex | cursor | gemini | opencode; none installs for every one found
  --binary <path>     The wizardingcode-mem binary the hooks will run (needed when running from source)
  --yes               Retire claude-mem and shibaox-mem without asking (disable or uninstall their plugins)
  --keep-claude-mem   Leave claude-mem installed and running
  --no-import         Do not import claude-mem's memories
  --import-history    Learn from past Claude Code and Codex sessions without asking
  --no-import-history Do not offer to learn from past sessions
`;

/** The lines every install ends with: where the hooks went, which binary, how MCP stands. */
function describeInstall(
  agent: string,
  result: InstallResult,
  binaryPath: string,
  lines: string[],
): string {
  const mcp =
    result.mcp === "registered"
      ? result.mcpCommand.length === 0 && result.mcpPath !== undefined
        ? `registered in ${result.mcpPath}`
        : "registered"
      : `not registered. Run: ${result.mcpCommand.join(" ")}`;
  return [
    `Installed wizardingcode-mem for ${AGENT_NAMES[agent]}.`,
    `  hooks:  ${result.settingsPath}${result.changed ? "" : " (already up to date)"}`,
    `  binary: ${binaryPath}`,
    `  MCP:    ${mcp}`,
    ...lines,
    ...result.notes.map((note) => `  ${note}`),
    `Start a new ${AGENT_NAMES[agent]} session for it to take effect.`,
    "",
  ].join("\n");
}

/** Asks on the terminal. Without one, the answer is no: nothing is retired unasked. */
function confirm(question: string): boolean {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  process.stdout.write(`${question} [Y/n] `);
  const buffer = Buffer.alloc(64);
  let read = 0;
  try {
    read = readSync(0, buffer, 0, buffer.length, null);
  } catch {
    return false;
  }
  // Enter means yes; end of input, with nothing typed, does not.
  if (read === 0) return false;
  const answer = buffer.toString("utf8", 0, read).trim().toLowerCase();
  return answer === "" || answer === "y" || answer === "yes" || answer === "s" || answer === "sim";
}

/**
 * The agent's shibaox-mem plugin (this product until 0.3.0) is uninstalled through the
 * agent's own command, when it has one and the user agrees; otherwise, said what to do.
 */
function retireLegacy(agent: string, rest: string[]): string[] {
  const lines: string[] = [];
  for (const found of findLegacyPlugins(doctorContext(defaultDataDir()))) {
    if (found.agent !== agent) continue;
    const agreed =
      found.command !== null &&
      (rest.includes("--yes") ||
        confirm(`${found.name} (this product's old name) is still installed. Uninstall it?`));
    if (agreed && found.command !== null) {
      let ok = false;
      try {
        ok =
          Bun.spawnSync(found.command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
            .exitCode === 0;
      } catch {
        // The agent's command is not on PATH.
      }
      if (ok) {
        lines.push(`  ${found.name}: uninstalled`);
        continue;
      }
    }
    lines.push(
      `  ${found.name}: still installed. Two memories will inject into the same session until you run:`,
      `    ${found.hint}`,
    );
  }
  return lines;
}

/** `wizardingcode-mem install [<agent>] [options]` */
export function run(argv: string[]): number {
  const named = argv[0] !== undefined && !argv[0].startsWith("--");
  const agent = named ? argv[0] : undefined;
  const rest = named ? argv.slice(1) : argv;
  if (agent !== undefined && !SUPPORTED_AGENTS.includes(agent)) {
    process.stderr.write(
      `wizardingcode-mem install: unknown agent "${agent}". Supported: ${SUPPORTED_AGENTS.join(", ")}\n${USAGE}`,
    );
    return EXIT_USAGE;
  }
  if (agent === undefined) {
    const found: string[] = detectAgents({
      env: process.env,
      which: (command) => Bun.which(command),
    });
    // Claude Desktop is no agent with hooks, but its chat should share the same memory.
    if (hasClaudeDesktop(claudeDesktopConfigPath())) found.push("claude-desktop");
    if (found.length === 0) {
      process.stderr.write(
        "wizardingcode-mem install: No supported agent found on this machine. Name one: wizardingcode-mem install <agent>\n",
      );
      return 1;
    }
    let code = 0;
    for (const each of found) code = Math.max(code, installOne(each, rest, false));
    // Once per run, not once per agent, and only when an agent whose transcripts are read was installed.
    if (code === 0 && (found.includes("claude-code") || found.includes("codex")))
      offerHistory(rest);
    const missing = [...AGENT_ORDER, "claude-desktop" as const]
      .filter((each) => !found.includes(each))
      .map((each) => AGENT_NAMES[each]);
    if (missing.length > 0)
      process.stdout.write(`Not found on this machine: ${missing.join(", ")}\n`);
    return code;
  }
  return installOne(agent, rest);
}

function offerHistory(rest: string[]): void {
  try {
    const lines = offerHistoryImportHere(rest, confirm);
    if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
  } catch {
    // The offer is a courtesy: a store that cannot be read must not fail the install.
  }
}

function installOne(agent: string, rest: string[], offer = true): number {
  const flag = rest.indexOf("--binary");
  const explicit = flag === -1 ? undefined : rest[flag + 1];
  let binaryPath: string;
  if (explicit !== undefined) {
    binaryPath = resolve(explicit);
    if (!existsSync(binaryPath)) {
      process.stderr.write(`wizardingcode-mem install: ${binaryPath} does not exist\n`);
      return 1;
    }
  } else if (isCompiled()) {
    binaryPath = stageBinary(process.execPath, defaultDataDir());
  } else {
    process.stderr.write(
      "wizardingcode-mem install: running from source. Build a binary with `bun run build` and pass it with --binary <path>.\n",
    );
    return 1;
  }

  const lines: string[] = retireLegacy(agent, rest);
  try {
    if (agent === "claude-desktop") {
      const result = installClaudeDesktop({ configPath: claudeDesktopConfigPath(), binaryPath });
      process.stdout.write(
        [
          "Installed wizardingcode-mem for Claude Desktop.",
          `  config: ${result.configPath}${result.changed ? "" : " (already up to date)"}`,
          `  binary: ${binaryPath}`,
          "  chat:   memory_search, memory_get, memory_save, history_search and memory_projects, across every project",
          "  Cowork: add the plugin in Customize → Plugins → Add marketplace → WizardingCode-io/wizardingcode-plugins",
          "Quit and reopen Claude Desktop for it to take effect.",
          "",
        ].join("\n"),
      );
      return 0;
    }
    if (agent === "codex") {
      process.stdout.write(
        describeInstall(agent, installCodex(codexContext(binaryPath)), binaryPath, lines),
      );
      if (offer) offerHistory(rest);
      return 0;
    }
    if (agent === "opencode") {
      const result = installOpenCode({ pluginPath: opencodePluginPath(), binaryPath });
      process.stdout.write(
        [
          "Installed wizardingcode-mem for OpenCode.",
          `  plugin: ${result.pluginPath}${result.changed ? "" : " (already up to date)"}`,
          `  binary: ${binaryPath}`,
          "  tools:  memory_search, memory_get, memory_save (native, no MCP server needed)",
          ...lines,
          "Start a new OpenCode session for it to take effect.",
          "",
        ].join("\n"),
      );
      return 0;
    }
    if (agent === "cursor") {
      process.stdout.write(
        describeInstall(agent, installCursor(cursorContext(binaryPath)), binaryPath, lines),
      );
      return 0;
    }
    if (agent === "gemini") {
      process.stdout.write(
        describeInstall(agent, installGemini(geminiContext(binaryPath)), binaryPath, lines),
      );
      return 0;
    }
    const hostContext = claudeCodeContext(binaryPath);
    const takeover = takeoverContext(hostContext.settingsPath, hostContext.configDir);
    const detection = detectClaudeMem(takeover);
    const home = homedir();

    // What the user has in claude-mem comes over first, before anything of it is touched.
    if (detection.database !== null && !rest.includes("--no-import")) {
      lines.push(...describeImport(importIntoDefaultStore(detection.database)));
    }

    const present = detection.plugin !== null;
    if (present && !rest.includes("--keep-claude-mem")) {
      const agreed =
        rest.includes("--yes") ||
        confirm(
          `claude-mem is installed. Disable its plugin and stop its background processes, so that only one memory speaks to Claude Code?`,
        );
      if (agreed) {
        lines.push(...describeStop(detection, stopClaudeMem(takeover, detection.plugin), home));
      } else {
        lines.push(
          "  claude-mem: still enabled. Two memories will inject into the same session until you run:",
          `    claude plugin disable ${detection.plugin}`,
          "  or run this install again with --yes.",
        );
      }
    } else if (present) {
      lines.push(
        `  claude-mem: still enabled, as asked (claude plugin disable ${detection.plugin} turns it off)`,
      );
    }

    process.stdout.write(describeInstall(agent, installClaudeCode(hostContext), binaryPath, lines));
    if (offer) offerHistory(rest);
    return 0;
  } catch (error) {
    process.stderr.write(
      `wizardingcode-mem install: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
