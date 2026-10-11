import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listClaudeCodeTranscripts,
  readClaudeCodeHistory,
} from "../../src/adapters/claude-code/history.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-cc-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = { sessionId: "s1", cwd: "/work/shop", gitBranch: "main", isSidechain: false };
const prompt = (promptId: string, content: string, timestamp: string, extra = {}) => ({
  ...base,
  type: "user",
  promptId,
  timestamp,
  message: { role: "user", content },
  ...extra,
});
const assistant = (content: unknown[], timestamp: string, extra = {}) => ({
  ...base,
  type: "assistant",
  timestamp,
  message: { role: "assistant", content },
  ...extra,
});

function write(name: string, lines: unknown[], tail = ""): string {
  const path = join(dir, name);
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n${tail}`);
  return path;
}

describe("readClaudeCodeHistory", () => {
  test("each prompt becomes a turn with the last thing the assistant said", () => {
    const path = write("a.jsonl", [
      prompt("p1", "why do the tests time out?", "2026-09-01T10:00:00.000Z"),
      assistant(
        [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/work/shop/db.ts" } }],
        "2026-09-01T10:00:05.000Z",
      ),
      assistant(
        [{ type: "text", text: "Fixed: the pragma ran too late." }],
        "2026-09-01T10:00:09.000Z",
      ),
      prompt("p2", "thanks", "2026-09-01T10:01:00.000Z"),
      assistant([{ type: "text", text: "You're welcome." }], "2026-09-01T10:01:02.000Z"),
    ]);
    const turns = readClaudeCodeHistory(path);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      agent: "claude-code",
      sessionId: "s1",
      turnId: "p1",
      cwd: "/work/shop",
      branch: "main",
      prompt: "why do the tests time out?",
      finalText: "Fixed: the pragma ran too late.",
      startedAt: Date.parse("2026-09-01T10:00:00.000Z"),
      endedAt: Date.parse("2026-09-01T10:00:09.000Z"),
      transcriptPath: path,
    });
    expect(turns[0]?.detail.filesChanged).toEqual(["/work/shop/db.ts"]);
  });

  test("a subagent's sidechain is not the user speaking", () => {
    const path = write("b.jsonl", [
      prompt("p1", "review the branch", "2026-09-01T10:00:00.000Z"),
      prompt("p9", "Never touch the lockfile.", "2026-09-01T10:00:01.000Z", { isSidechain: true }),
      assistant([{ type: "text", text: "Reviewed." }], "2026-09-01T10:00:02.000Z"),
    ]);
    expect(readClaudeCodeHistory(path).map((t) => t.turnId)).toEqual(["p1"]);
  });

  test("a broken last line and unknown shapes are skipped, the rest is kept", () => {
    const path = write(
      "c.jsonl",
      [
        { type: "file-history-snapshot", snapshot: {} },
        prompt("p1", "why?", "2026-09-01T10:00:00.000Z"),
        assistant([{ type: "text", text: "Because." }], "2026-09-01T10:00:01.000Z"),
      ],
      '{"type":"user","promptId":"p2","mess',
    );
    expect(readClaudeCodeHistory(path).map((t) => t.turnId)).toEqual(["p1"]);
  });

  test("an unreadable file yields nothing", () => {
    expect(readClaudeCodeHistory(join(dir, "missing.jsonl"))).toEqual([]);
  });
});

describe("listClaudeCodeTranscripts", () => {
  test("lists transcripts touched since the cut-off, oldest first", () => {
    mkdirSync(join(dir, "-work-shop"));
    const old = write("-work-shop/old.jsonl", []);
    const recent = write("-work-shop/recent.jsonl", []);
    const newer = write("-work-shop/newer.jsonl", []);
    const day = 86_400_000;
    const now = Date.now();
    utimesSync(old, new Date(now - 400 * day), new Date(now - 400 * day));
    utimesSync(recent, new Date(now - 10 * day), new Date(now - 10 * day));
    utimesSync(newer, new Date(now - 1 * day), new Date(now - 1 * day));
    expect(listClaudeCodeTranscripts(dir, now - 180 * day)).toEqual([recent, newer]);
  });
});
