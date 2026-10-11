import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isObject, type Json, parseLines, text } from "../common/jsonl.ts";
import type { HistoryTurn } from "../history.ts";
import { isPrompt, turnDetailFromLines } from "./transcript.ts";

// Claude Code keeps one JSON-lines transcript per session under
// <config>/projects/<encoded cwd>/<session>.jsonl. Not a contract: best effort.

export function claudeCodeRoot(env: Record<string, string | undefined> = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");
}

/** Transcripts modified at or after `sinceMs`, oldest first. */
export function listClaudeCodeTranscripts(root: string, sinceMs: number): string[] {
  const found: { path: string; mtime: number }[] = [];
  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return [];
  }
  for (const project of projects) {
    let names: string[];
    try {
      names = readdirSync(join(root, project));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(root, project, name);
      try {
        const mtime = statSync(path).mtimeMs;
        if (mtime >= sinceMs) found.push({ path, mtime });
      } catch {
        // Gone between the listing and the stat.
      }
    }
  }
  return found.sort((a, b) => a.mtime - b.mtime).map((f) => f.path);
}

const time = (line: Json | undefined): number | null => {
  const value = Date.parse(text(line?.timestamp) ?? "");
  return Number.isNaN(value) ? null : value;
};

/** The text an assistant line says, if any. */
function said(line: Json): string | null {
  if (line.type !== "assistant" || !isObject(line.message)) return null;
  const content = line.message.content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((block) => isObject(block) && block.type === "text")
    .map((block) => text((block as Json).text) ?? "")
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join("\n");
}

/** Every finished turn in one transcript. Never throws. */
export function readClaudeCodeHistory(path: string): HistoryTurn[] {
  let lines: Json[];
  try {
    lines = parseLines(readFileSync(path, "utf8")).filter((line) => line.isSidechain !== true);
  } catch {
    return [];
  }
  const turns: HistoryTurn[] = [];
  const starts = lines.flatMap((line, at) => (isPrompt(line) ? [at] : []));
  starts.forEach((start, n) => {
    const open = lines[start] as Json;
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start, end);
    let finalText: string | null = null;
    let endedAt = time(open);
    for (const line of body) {
      const words = said(line);
      if (words !== null) finalText = words;
      endedAt = time(line) ?? endedAt;
    }
    const startedAt = time(open);
    const turnId = text(open.promptId);
    const sessionId = text(open.sessionId);
    const cwd = text(open.cwd);
    const message = open.message as Json;
    if (
      startedAt === null ||
      endedAt === null ||
      turnId === null ||
      sessionId === null ||
      cwd === null
    )
      return;
    turns.push({
      agent: "claude-code",
      sessionId,
      turnId,
      cwd,
      branch: text(open.gitBranch),
      prompt: message.content as string,
      finalText,
      startedAt,
      endedAt,
      transcriptPath: path,
      detail: turnDetailFromLines(body, turnId),
    });
  });
  return turns;
}
