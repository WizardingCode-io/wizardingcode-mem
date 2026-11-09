// Who an MCP call comes from: the agent id a knowledge proposal is written under. The id
// is not authenticated. It tells an agent from a person, which is all the store's
// guarantee needs, and one agent from another for the hourly rate.
import { AGENT_ID, UNKNOWN_AGENT } from "../modules/knowledge/entry.ts";

/** One row per host the product installs into: a prefix of the lower-cased name, and its id. */
const HOSTS: readonly (readonly [prefix: string, id: string])[] = [
  ["claude-code", "claude-code"],
  ["claude code", "claude-code"],
  ["claude-desktop", "claude-desktop"],
  ["claude desktop", "claude-desktop"],
  ["codex", "codex"],
  ["cursor", "cursor"],
  ["copilot", "copilot"],
  ["antigravity", "antigravity"],
  ["qwen", "qwen"],
  ["droid", "droid"],
];

/** The agent id for the name a host gives in the `initialize` handshake; `mcp` for any other. */
export function agentIdFromClient(clientName: string | undefined): string {
  const name = (clientName ?? "").toLowerCase();
  return HOSTS.find(([prefix]) => name.startsWith(prefix))?.[1] ?? UNKNOWN_AGENT;
}

/** The value of `mcp --agent`, when it is a valid agent id; throws otherwise. */
export function checkedAgentId(value: string): string {
  if (!AGENT_ID.test(value)) {
    throw new Error("--agent takes an id of lower-case letters, digits and hyphens");
  }
  return value;
}
