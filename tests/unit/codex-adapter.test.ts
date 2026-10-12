import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codex } from "../../src/adapters/codex/adapter.ts";

const FIXTURES = new URL("../fixtures/codex/", import.meta.url).pathname;
const payload = (name: string) => readFileSync(join(FIXTURES, "payloads", `${name}.json`), "utf8");
const ROLLOUT = join(FIXTURES, "transcripts", "rollout.jsonl");
const TURN = "01a10d0a-2d34-7fa2-9d91-bedf67023d6d";

describe("codex payloads", () => {
  test("session start", () => {
    expect(codex.parse("session-start", payload("session-start.startup"))).toEqual({
      agent: "codex",
      event: "session-start",
      sessionId: "01a10d0a-2c7e-7330-a3b2-e71cea3b519a",
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath:
        "/Users/dev/.codex/sessions/2026/10/05/rollout-2026-10-05T18-08-53-01a10d0a-2c7e-7330-a3b2-e71cea3b519a.jsonl",
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
    });
  });

  test("prompt submission carries the prompt and the turn id", () => {
    expect(codex.parse("prompt", payload("user-prompt-submit"))).toMatchObject({
      event: "prompt",
      turnId: TURN,
      prompt:
        "Create a file named hello.txt containing the single word hi. Then reply with exactly: done",
      finalText: null,
    });
  });

  test("turn end carries the assistant's final message under the same turn id", () => {
    expect(codex.parse("turn-end", payload("stop"))).toMatchObject({
      event: "turn-end",
      turnId: TURN,
      finalText: "done",
      prompt: null,
    });
  });

  test("a turn that ended without a message has no final text", () => {
    const silent = JSON.stringify({ ...JSON.parse(payload("stop")), last_assistant_message: null });
    expect(codex.parse("turn-end", silent)?.finalText).toBeNull();
  });

  test("session end", () => {
    expect(codex.parse("session-end", payload("session-end"))).toMatchObject({
      event: "session-end",
      sessionId: "01a10d0a-2c7e-7330-a3b2-e71cea3b519a",
      source: null,
    });
  });

  test("an unknown session source is passed through as 'other'", () => {
    const forked = JSON.stringify({
      ...JSON.parse(payload("session-start.startup")),
      source: "fork",
    });
    expect(codex.parse("session-start", forked)?.source).toBe("other");
  });

  test.each(["", "not json", "[]", "null", '{"cwd":"/p"}', '{"session_id":"s"}'])(
    "unusable input %p yields nothing instead of throwing",
    (stdin) => {
      expect(codex.parse("prompt", stdin)).toBeNull();
    },
  );
});

describe("codex render", () => {
  test("context for a prompt is wrapped the way Codex expects", () => {
    expect(JSON.parse(codex.render("prompt", "<notes/>"))).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "<notes/>" },
    });
  });

  test("context at session start names that event", () => {
    expect(JSON.parse(codex.render("session-start", "n"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "n" },
    });
  });

  test("events that cannot carry context print nothing, and so does empty context", () => {
    expect(codex.render("turn-end", "n")).toBe("");
    expect(codex.render("session-end", "n")).toBe("");
    expect(codex.render("prompt", "")).toBe("");
    expect(codex.render("prompt", null)).toBe("");
  });

  test("context stays under the size at which Codex spills it to a file", () => {
    const rendered = JSON.parse(codex.render("prompt", "x".repeat(50_000)));
    expect(rendered.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      codex.capabilities.maxInjectionChars,
    );
    expect(codex.capabilities.maxInjectionChars).toBeLessThanOrEqual(8_000);
  });
});

describe("codex transcript", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-codex-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a turn reports the files it read and changed, its commands, failures and a memory it saved", () => {
    expect(codex.readTurnDetail(ROLLOUT, "turn-a")).toEqual({
      filesRead: ["src/limit.ts"],
      filesChanged: ["/Users/dev/project/src/limit.ts"],
      commands: ["cat src/limit.ts", "bun test"],
      errors: ["error: expected 5, got 3"],
      savedMemory: true,
    });
  });

  test("a later turn does not inherit an earlier turn's items, and a failed save saved nothing", () => {
    expect(codex.readTurnDetail(ROLLOUT, "turn-b")).toEqual({
      filesRead: [],
      filesChanged: ["/Users/dev/project/hello.txt"],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });

  test("without a turn id, reads the last turn", () => {
    expect(codex.readTurnDetail(ROLLOUT, null).filesChanged).toEqual([
      "/Users/dev/project/hello.txt",
    ]);
  });

  test("a turn the transcript does not show yields an empty detail", () => {
    expect(codex.readTurnDetail(ROLLOUT, "turn-z")).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });

  test("a missing or unreadable transcript yields an empty detail", () => {
    expect(codex.readTurnDetail(join(dir, "missing.jsonl"), "turn-a").commands).toEqual([]);
    writeFileSync(join(dir, "garbage.jsonl"), "{\n[]\nnull\n42\n");
    expect(codex.readTurnDetail(join(dir, "garbage.jsonl"), null).commands).toEqual([]);
  });

  test("reads only the tail of a very large transcript", () => {
    const path = join(dir, "big.jsonl");
    const filler = `${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: "x".repeat(1000) } })}\n`;
    writeFileSync(path, filler.repeat(2000) + readFileSync(ROLLOUT, "utf8"));
    expect(codex.readTurnDetail(path, "turn-b", { maxBytes: 64 * 1024 }).filesChanged).toEqual([
      "/Users/dev/project/hello.txt",
    ]);
  });
});
