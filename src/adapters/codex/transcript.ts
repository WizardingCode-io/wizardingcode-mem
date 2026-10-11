import { clip } from "../../util/text.ts";
import { isObject, type Json, parseLines, readTail, text } from "../common/jsonl.ts";
import type { TurnDetail } from "../types.ts";

// Codex's rollout file, as written by 0.153: `event_msg` lines whose payload carries a
// `turn_id` and, for `item_completed`, a typed item. Declared unstable by Codex, so this
// is best effort: unknown shapes are skipped, and a failure yields an empty detail.

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 100;
const MAX_ITEM_CHARS = 16 * 1024;

function add(set: Set<string>, value: string | null): void {
  if (value !== null && set.size < MAX_ITEMS) set.add(clip(value, MAX_ITEM_CHARS));
}

/** The `event_msg` payload of a line, when it belongs to a turn. */
export function turnEvent(line: Json): (Json & { turn_id: string }) | null {
  if (line.type !== "event_msg" || !isObject(line.payload)) return null;
  const turnId = text(line.payload.turn_id);
  return turnId === null ? null : (line.payload as Json & { turn_id: string });
}

/** The shell command behind a `CommandExecution`, without the shell's own wrapper. */
function commandOf(item: Json): string | null {
  if (!Array.isArray(item.command)) return null;
  const parts = item.command.filter((p): p is string => typeof p === "string");
  // ["/bin/zsh", "-lc", "<cmd>"] is how Codex runs commands; anything else is shown whole.
  if (parts.length === 3 && parts[1] === "-lc") return text(parts[2]);
  return text(parts.join(" "));
}

/** What one turn did, from the turn events of a rollout file. */
export function turnDetailFromEvents(
  events: (Json & { turn_id: string })[],
  turnId: string | null,
): TurnDetail {
  const filesRead = new Set<string>();
  const filesChanged = new Set<string>();
  const commands = new Set<string>();
  const errors = new Set<string>();
  let savedMemory = false;
  const detail = (): TurnDetail => ({
    filesRead: [...filesRead],
    filesChanged: [...filesChanged],
    commands: [...commands],
    errors: [...errors],
    savedMemory,
  });

  const id = turnId ?? events.at(-1)?.turn_id ?? null;
  if (id === null) return detail();

  for (const event of events) {
    if (event.turn_id !== id || event.type !== "item_completed" || !isObject(event.item)) continue;
    const item = event.item;
    switch (item.type) {
      case "CommandExecution": {
        add(commands, commandOf(item));
        if (Array.isArray(item.parsed_cmd)) {
          for (const parsed of item.parsed_cmd) {
            if (isObject(parsed) && parsed.type === "read") add(filesRead, text(parsed.path));
          }
        }
        if (item.status === "failed" || (text(item.exit_code) ?? "0") !== "0") {
          add(errors, text(item.stderr) ?? text(item.aggregated_output));
        }
        break;
      }
      case "FileChange": {
        if (isObject(item.changes))
          for (const path of Object.keys(item.changes)) add(filesChanged, path);
        break;
      }
      case "McpToolCall": {
        if (
          text(item.server) === "wizardingcode-mem" &&
          text(item.tool) === "memory_save" &&
          item.status === "completed"
        ) {
          savedMemory = true;
        }
        break;
      }
      default:
        break;
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
    return turnDetailFromEvents([], null);
  }
  return turnDetailFromEvents(
    lines.map(turnEvent).filter((e) => e !== null),
    turnId,
  );
}
