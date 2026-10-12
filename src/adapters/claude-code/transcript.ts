import { clip } from "../../util/text.ts";
import { isObject, type Json, parseLines, readTail, text } from "../common/jsonl.ts";
import type { TurnDetail } from "../types.ts";

// The transcript is Claude Code's internal format, not a contract. Everything here is
// best effort: unknown shapes are skipped, and a failure yields an empty detail.

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 100;
// Items are returned whole: the caller redacts them and only then cuts them to size.
// This bound is only against the enormous.
const MAX_ITEM_CHARS = 16 * 1024;

const READ_TOOLS = new Set(["Read"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** A user line that opens a turn: it carries the prompt as plain text. */
export function isPrompt(line: Json): boolean {
  return (
    line.type === "user" &&
    text(line.promptId) !== null &&
    isObject(line.message) &&
    typeof line.message.content === "string"
  );
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isObject(part) ? (text(part.text) ?? "") : ""))
    .filter((part) => part !== "")
    .join("\n");
}

function add(set: Set<string>, value: string | null): void {
  if (value !== null && set.size < MAX_ITEMS) set.add(clip(value, MAX_ITEM_CHARS));
}

/** What one turn did, from transcript lines already parsed. */
export function turnDetailFromLines(lines: Json[], turnId: string | null): TurnDetail {
  const filesRead = new Set<string>();
  const filesChanged = new Set<string>();
  const commands = new Set<string>();
  const errors = new Set<string>();
  let savedMemory = false;
  const saves = new Set<string>();
  const detail = (): TurnDetail => ({
    filesRead: [...filesRead],
    filesChanged: [...filesChanged],
    commands: [...commands],
    errors: [...errors],
    savedMemory,
  });

  let start =
    turnId === null
      ? lines.findLastIndex(isPrompt)
      : lines.findIndex((line) => line.type === "user" && line.promptId === turnId);
  if (start === -1) {
    // The tail may begin inside the turn; it does not if it shows another turn's prompt.
    if (lines.some(isPrompt)) return detail();
    start = 0;
  }
  const id = turnId ?? text(lines[start]?.promptId);

  for (const line of lines.slice(start)) {
    if (line.type === "user" && text(line.promptId) !== null && line.promptId !== id) break;
    const content = isObject(line.message) ? line.message.content : undefined;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === "tool_use" && isObject(block.input)) {
        const name = text(block.name) ?? "";
        const path = text(block.input.file_path) ?? text(block.input.notebook_path);
        if (READ_TOOLS.has(name)) add(filesRead, path);
        else if (WRITE_TOOLS.has(name)) add(filesChanged, path);
        else if (name === "Bash") add(commands, text(block.input.command));
        // MCP tools are named mcp__<server>__<tool>; ours is registered as "wizardingcode-mem".
        else if (name.includes("wizardingcode-mem") && name.endsWith("__memory_save")) {
          const saveId = text(block.id);
          if (saveId !== null) saves.add(saveId);
        }
      } else if (block.type === "tool_result") {
        if (block.is_error === true) add(errors, text(resultText(block.content)));
        // A save that failed, or whose outcome never arrived, saved nothing.
        else if (saves.has(text(block.tool_use_id) ?? "")) savedMemory = true;
      }
    }
  }
  return detail();
}

export function readTurnDetail(
  transcriptPath: string,
  turnId: string | null,
  options: { maxBytes?: number } = {},
): TurnDetail {
  let lines: Json[];
  try {
    lines = parseLines(readTail(transcriptPath, options.maxBytes ?? DEFAULT_MAX_BYTES));
  } catch {
    return turnDetailFromLines([], null);
  }
  return turnDetailFromLines(lines, turnId);
}
