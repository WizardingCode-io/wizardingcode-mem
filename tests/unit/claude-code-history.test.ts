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

  test("many turns come back whole even when lines span chunk boundaries", () => {
    const lines: unknown[] = [];
    for (let i = 0; i < 200; i++) {
      const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 10, 0, s)).toISOString();
      lines.push(prompt(`p${i}`, `question ${i} \u00e9\u4e2d`, at(i % 60)));
      lines.push(assistant([{ type: "text", text: `answer ${i}` }], at(i % 60)));
    }
    const path = write("many.jsonl", lines);
    const turns = readClaudeCodeHistory(path, { chunkBytes: 37 });
    expect(turns.map((t) => t.turnId)).toEqual(
      lines.filter((_, i) => i % 2 === 0).map((l) => (l as { promptId: string }).promptId),
    );
    expect(turns[199]).toMatchObject({
      prompt: "question 199 \u00e9\u4e2d",
      finalText: "answer 199",
    });
  });

  test("meta and compaction-summary lines do not open turns", () => {
    const path = write("meta.jsonl", [
      prompt("p1", "real question", "2026-09-01T10:00:00.000Z"),
      prompt("m1", "<command-name>/clear</command-name>", "2026-09-01T10:00:01.000Z", {
        isMeta: true,
      }),
      prompt("c1", "This session is being continued...", "2026-09-01T10:00:02.000Z", {
        isCompactSummary: true,
      }),
      assistant([{ type: "text", text: "Done." }], "2026-09-01T10:00:03.000Z"),
    ]);
    const turns = readClaudeCodeHistory(path);
    expect(turns.map((t) => t.turnId)).toEqual(["p1"]);
    expect(turns[0]?.finalText).toBe("Done.");
  });

  test("a slash command's typed arguments are the prompt, without the wrapper", () => {
    const path = write("command.jsonl", [
      prompt(
        "p1",
        "<command-message>arka</command-message>\n<command-name>/arka</command-name>\n<command-args>update the hooks to the new events</command-args>",
        "2026-09-01T10:00:00.000Z",
      ),
      assistant([{ type: "text", text: "Hooks updated." }], "2026-09-01T10:00:05.000Z"),
    ]);
    const turns = readClaudeCodeHistory(path);
    expect(turns.map((t) => [t.turnId, t.prompt, t.finalText])).toEqual([
      ["p1", "update the hooks to the new events", "Hooks updated."],
    ]);
  });

  test("commands with nothing typed, their output and shell mode do not open turns", () => {
    const path = write("local.jsonl", [
      prompt("p1", "why is the build slow?", "2026-09-01T10:00:00.000Z"),
      assistant([{ type: "text", text: "The cache was cold." }], "2026-09-01T10:00:05.000Z"),
      prompt("p2", "/compact", "2026-09-01T10:01:00.000Z"),
      prompt(
        "p2",
        "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>",
        "2026-09-01T10:01:01.000Z",
      ),
      prompt(
        "p2",
        "<local-command-stdout>\u001b[2mCompacted\u001b[22m</local-command-stdout>",
        "2026-09-01T10:01:02.000Z",
      ),
      prompt(
        "p3",
        "<command-name>/login</command-name>\n<command-message>login</command-message>\n<command-args>  </command-args>",
        "2026-09-01T10:02:00.000Z",
      ),
      prompt("p4", "<bash-input>git status</bash-input>", "2026-09-01T10:03:00.000Z"),
      prompt(
        "p4",
        "<bash-stdout>nothing to commit</bash-stdout><bash-stderr></bash-stderr>",
        "2026-09-01T10:03:01.000Z",
      ),
      prompt("p5", "now add a test for it", "2026-09-01T10:04:00.000Z"),
      assistant([{ type: "text", text: "Test added." }], "2026-09-01T10:04:05.000Z"),
    ]);
    const turns = readClaudeCodeHistory(path);
    expect(turns.map((t) => [t.turnId, t.prompt, t.finalText])).toEqual([
      ["p1", "why is the build slow?", "The cache was cold."],
      ["p5", "now add a test for it", "Test added."],
    ]);
  });

  test("claude-mem's own sessions are skipped, lookalike paths are not", () => {
    const mem = write("mem.jsonl", [
      prompt("p1", "observe", "2026-09-01T10:00:00.000Z", {
        cwd: "/Users/x/.claude-mem/observer-sessions",
      }),
      assistant([{ type: "text", text: "ok" }], "2026-09-01T10:00:01.000Z"),
    ]);
    expect(readClaudeCodeHistory(mem)).toEqual([]);
    const root = write("root.jsonl", [
      prompt("p1", "observe", "2026-09-01T10:00:00.000Z", { cwd: "/Users/x/.claude-mem" }),
    ]);
    expect(readClaudeCodeHistory(root)).toEqual([]);
    const fork = write("fork.jsonl", [
      prompt("p1", "hi", "2026-09-01T10:00:00.000Z", { cwd: "/work/claude-mem-fork" }),
      assistant([{ type: "text", text: "ok" }], "2026-09-01T10:00:01.000Z"),
    ]);
    expect(readClaudeCodeHistory(fork)).toHaveLength(1);
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
