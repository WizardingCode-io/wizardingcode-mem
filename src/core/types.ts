export type AgentId = "claude-code" | "codex" | "cursor" | "gemini" | "opencode" | "qwen";

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
