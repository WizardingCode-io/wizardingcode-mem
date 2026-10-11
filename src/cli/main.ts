#!/usr/bin/env bun
import pkg from "../../package.json" with { type: "json" };
import { applyLegacyEnv, migrateLegacyData } from "../util/legacy.ts";
import { EXIT_USAGE } from "./exit.ts";

export interface CommandModule {
  run(argv: string[]): Promise<number> | number;
}

// Each command is loaded on demand so that hooks never pay for code they do not run.
const COMMANDS: Record<string, () => Promise<CommandModule>> = {
  hook: () => import("./commands/hook.ts"),
  distill: () => import("./commands/distill.ts"),
  mcp: () => import("./commands/mcp.ts"),
  tool: () => import("./commands/tool.ts"),
  ui: () => import("./commands/ui.ts"),
  install: () => import("./commands/install.ts"),
  uninstall: () => import("./commands/uninstall.ts"),
  import: () => import("./commands/import.ts"),
  history: () => import("./commands/history.ts"),
  embed: () => import("./commands/embed.ts"),
  rejudge: () => import("./commands/rejudge.ts"),
  compact: () => import("./commands/compact.ts"),
  backup: () => import("./commands/backup.ts"),
  status: () => import("./commands/status.ts"),
  doctor: () => import("./commands/doctor.ts"),
  __spike: () => import("./commands/spike.ts"),
};

const USAGE = `wizardingcode-mem ${pkg.version} — persistent memory for coding agents

Usage: wizardingcode-mem <command> [options]

Options:
  -v, --version   Print the version
  -h, --help      Print this help
`;

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  if (name === "--version" || name === "-v") {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const load = COMMANDS[name];
  if (load === undefined) {
    process.stderr.write(`wizardingcode-mem: unknown command "${name}"\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  // A shibaox-mem install (0.3.0 and before) is taken over before anything reads the store.
  applyLegacyEnv(process.env);
  if (process.env.WIZARDINGCODE_MEM_MIGRATE !== "off") {
    let migration: string;
    try {
      migration = migrateLegacyData();
    } catch (error) {
      migration = `failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (migration !== "none" && migration !== "migrated") {
      // Hooks fail open; nothing may start an empty memory beside the one being moved.
      if (name === "hook") return 0;
      process.stderr.write(
        migration === "busy"
          ? "wizardingcode-mem: another process is moving the shibaox-mem data; try again in a moment\n"
          : `wizardingcode-mem: could not take over the shibaox-mem data (${migration.slice(8)}); nothing was changed\n`,
      );
      return 1;
    }
  }
  const command = await load();
  return await command.run(rest);
}

// No top-level await: bytecode builds are emitted as CommonJS.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
