import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_CHUNK_BYTES,
  isObject,
  type Json,
  parseLines,
  readLines,
  text,
} from "../common/jsonl.ts";
import type { HistoryTurn } from "../history.ts";
import { turnDetailFromEvents, turnEvent } from "./transcript.ts";

// Codex writes one rollout file per session under <home>/sessions/YYYY/MM/DD/.
// Declared unstable by Codex: best effort, unknown shapes are skipped.

export function codexRoot(env: Record<string, string | undefined> = process.env): string {
  return join(env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions");
}

/** Rollout files modified at or after `sinceMs`, oldest first. */
export function listCodexTranscripts(root: string, sinceMs: number): string[] {
  const found: { path: string; mtime: number }[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(path);
      else if (name.endsWith(".jsonl") && stat.mtimeMs >= sinceMs)
        found.push({ path, mtime: stat.mtimeMs });
    }
  };
  walk(root);
  return found.sort((a, b) => a.mtime - b.mtime).map((f) => f.path);
}

/** Whether any transcript is there: stops at the first one found. */
export function hasCodexTranscript(root: string): boolean {
  const walk = (dir: string): boolean => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return false;
    }
    for (const name of names) {
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        if (stat.isDirectory() ? walk(path) : name.endsWith(".jsonl")) return true;
      } catch {
        // Gone between the listing and the stat.
      }
    }
    return false;
  };
  return walk(root);
}

const time = (line: Json): number | null => {
  const value = Date.parse(text(line.timestamp) ?? "");
  return Number.isNaN(value) ? null : value;
};

function userWords(item: Json): string | null {
  if (item.type !== "UserMessage" || !Array.isArray(item.content)) return null;
  const parts = item.content
    .filter((part) => isObject(part) && part.type === "text")
    .map((part) => text((part as Json).text) ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join("\n");
}

/**
 * What the user typed in a turn, from its UserMessage texts. Codex also stores injected
 * context and automation there; those contribute nothing. The last typed text wins.
 */
export function typedPrompt(texts: string[]): string | null {
  const typed: string[] = [];
  for (const raw of texts) {
    const body = raw.trim();
    if (body.startsWith("<realtime_delegation>")) {
      const from = body.indexOf("<input>");
      const to = body.indexOf("</input>");
      const input = from === -1 || to < from ? "" : body.slice(from + 7, to).trim();
      if (input !== "") typed.push(input);
    } else if (body !== "" && !body.startsWith("<") && !body.startsWith("# ")) {
      typed.push(body);
    }
  }
  return typed.at(-1) ?? null;
}

type Open = {
  messages: string[];
  cwd: string;
  startedAt: number | null;
  events: (Json & { turn_id: string })[];
};

/**
 * Every completed turn in one rollout file, in the order they complete. Never throws.
 * Rollouts reach hundreds of megabytes, so the file is streamed and only the turns still
 * open are held; a finished turn is built and its events dropped.
 */
export function readCodexHistory(
  path: string,
  options: { chunkBytes?: number } = {},
): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  const open = new Map<string, Open>();
  let sessionId: string | null = null;
  let sessionCwd: string | null = null;
  try {
    for (const raw of readLines(path, options.chunkBytes ?? DEFAULT_CHUNK_BYTES)) {
      const line = parseLines(raw)[0];
      if (line === undefined) continue;
      if (line.type === "session_meta" && isObject(line.payload)) {
        sessionId ??= text(line.payload.session_id);
        sessionCwd ??= text(line.payload.cwd);
        continue;
      }
      const payload = isObject(line.payload) ? line.payload : null;
      const turnId = text(payload?.turn_id);
      if (payload === null || turnId === null) continue;
      let entry = open.get(turnId);
      if (entry === undefined) {
        entry = { messages: [], cwd: sessionCwd ?? "", startedAt: time(line), events: [] };
        open.set(turnId, entry);
      }
      if (line.type === "turn_context") entry.cwd = text(payload.cwd) ?? entry.cwd;
      const event = turnEvent(line);
      if (event === null) continue;
      if (event.type === "item_completed" && isObject(event.item)) {
        entry.events.push(event);
        const words = userWords(event.item);
        if (words !== null) entry.messages.push(words);
      }
      if (event.type === "turn_aborted") open.delete(turnId);
      if (event.type !== "task_complete") continue;
      open.delete(turnId);
      const endedAt = time(line);
      const prompt = typedPrompt(entry.messages);
      if (sessionId === null || sessionCwd === null || prompt === null || endedAt === null)
        continue;
      turns.push({
        agent: "codex",
        sessionId,
        turnId,
        cwd: entry.cwd || sessionCwd,
        branch: null,
        prompt,
        finalText: text(event.last_agent_message),
        startedAt: entry.startedAt ?? endedAt,
        endedAt,
        transcriptPath: path,
        detail: turnDetailFromEvents(entry.events, turnId),
      });
    }
  } catch {
    // Unreadable from here on: keep the turns already built.
  }
  return turns;
}
