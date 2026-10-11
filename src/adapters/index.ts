import { antigravity } from "./antigravity/adapter.ts";
import { claudeCode } from "./claude-code/adapter.ts";
import { codex } from "./codex/adapter.ts";
import { copilot } from "./copilot/adapter.ts";
import { cursor } from "./cursor/adapter.ts";
import { droid } from "./droid/adapter.ts";
import { gemini } from "./gemini/adapter.ts";
import { opencode } from "./opencode/adapter.ts";
import { qwen } from "./qwen/adapter.ts";
import type { AgentAdapter } from "./types.ts";

export const ADAPTERS: Partial<Record<string, AgentAdapter>> = {
  [claudeCode.id]: claudeCode,
  [codex.id]: codex,
  [cursor.id]: cursor,
  [gemini.id]: gemini,
  [opencode.id]: opencode,
  [qwen.id]: qwen,
  [droid.id]: droid,
  [copilot.id]: copilot,
  [antigravity.id]: antigravity,
};
