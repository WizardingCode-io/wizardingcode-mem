import { basename } from "node:path";
import type { AgentId, HookEvent, RetiredAgentId } from "../core/types.ts";
import { isOurBinaryName } from "./hooks-file.ts";

// Hosts whose hook `command` is one shell string: the binary path is quoted so that it
// stays one word, and entries of ours are recognised by that exact shape.

/** One shell word, whatever the path holds. */
export function shellQuote(word: string): string {
  return `'${word.replace(/'/g, "'\\''")}'`;
}

const unquote = (quoted: string) => quoted.replace(/'\\''/g, "'");

const OURS = /^'((?:[^']|'\\'')*)' hook ([a-z-]+) \S+$/;

export function shellHookCommand(binaryPath: string, agent: AgentId, event: HookEvent): string {
  return `${shellQuote(binaryPath)} hook ${agent} ${event}`;
}

/** The binary an entry of ours runs, or null when the command is not one of ours. */
export function ourShellHookBinary(entry: unknown, agent: AgentId | RetiredAgentId): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
  const command = (entry as { command?: unknown }).command;
  if (typeof command !== "string") return null;
  const match = OURS.exec(command);
  if (match === null || match[2] !== agent) return null;
  const binary = unquote(match[1] ?? "");
  return isOurBinaryName(basename(binary)) ? binary : null;
}
