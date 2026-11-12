// The CLI's command names, and the few that reconcile with the staged binary before they run.
// A leaf: it imports nothing, so loading it costs a hook nothing and a test can read it
// (main.ts runs at load and cannot be imported).

export const COMMAND_NAMES = [
  "hook",
  "distill",
  "mcp",
  "tool",
  "ui",
  "install",
  "uninstall",
  "import",
  "history",
  "embed",
  "rejudge",
  "compact",
  "backup",
  "knowledge",
  "share",
  "status",
  "doctor",
  "update",
  "serve",
  "sync",
  "__spike",
] as const;
export type CommandName = (typeof COMMAND_NAMES)[number];

/**
 * The commands a person types to look at their install: typed from a copy older than the
 * staged binary, they run the staged binary. Never the ones agents and the background start.
 */
export const RECONCILED: readonly CommandName[] = ["status", "doctor", "update", "ui"];

export function reconciles(name: string, rest: readonly string[]): boolean {
  if (!(RECONCILED as readonly string[]).includes(name)) return false;
  // The session-start hook's own viewer.
  return !(name === "ui" && rest.includes("--auto"));
}
