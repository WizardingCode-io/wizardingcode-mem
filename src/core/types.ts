export type AgentId =
  | "claude-code"
  | "codex"
  | "cursor"
  | "opencode"
  | "qwen"
  | "droid"
  | "copilot"
  | "antigravity";

/**
 * Gemini CLI, no longer supported: nothing installs for it and no adapter reads it. The id
 * stays for what an old install left behind: its hook commands (`hook gemini …`) and install
 * receipts, recognised and removed by src/install/gemini-leftover.ts. Sessions stored under it
 * are plain rows and stay readable.
 */
export type RetiredAgentId = "gemini";

/** The four moments wizardingcode-mem acts on, whatever each host agent calls them. */
export type HookEvent =
  | "session-start"
  | "prompt"
  | "turn-end"
  | "session-end"
  | "file-read"
  | "tool-failed";

export const MEMORY_KINDS = [
  "decision",
  "fix",
  "gotcha",
  "convention",
  "change",
  "discovery",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
