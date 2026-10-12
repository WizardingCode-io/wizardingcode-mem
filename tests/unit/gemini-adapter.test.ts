import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gemini } from "../../src/adapters/gemini/adapter.ts";

const FIXTURES = new URL("../fixtures/gemini/payloads/", import.meta.url).pathname;
const payload = (name: string) => readFileSync(join(FIXTURES, `${name}.json`), "utf8");

describe("gemini payloads", () => {
  test("session start", () => {
    expect(gemini.parse("session-start", payload("session-start.startup"))).toEqual({
      agent: "gemini",
      event: "session-start",
      sessionId: "e7cfb52d-8621-4d7f-a500-8b5cf1382484",
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath:
        "/Users/dev/.gemini/tmp/634a4f20db141dfd20a0fd5e97262e90ba5155f541715c527e7ebc8bb6470d2f/chats/session-2026-10-05T17-10-e7cfb52d.json",
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
    });
  });

  test("before the agent runs, the prompt; Gemini names no turn", () => {
    expect(gemini.parse("prompt", payload("before-agent"))).toMatchObject({
      event: "prompt",
      turnId: null,
      prompt:
        "Create a file named hello.txt containing the single word hi. Then reply with exactly: done",
      finalText: null,
    });
  });

  test("after the agent runs, the response is the final text", () => {
    expect(gemini.parse("turn-end", payload("after-agent"))).toMatchObject({
      event: "turn-end",
      turnId: null,
      prompt: null,
      finalText: "done",
    });
  });

  test("session end", () => {
    expect(gemini.parse("session-end", payload("session-end"))).toMatchObject({
      event: "session-end",
      source: null,
    });
  });

  test("a source Gemini adds later is passed through as 'other'", () => {
    const odd = JSON.stringify({ ...JSON.parse(payload("session-start.startup")), source: "fork" });
    expect(gemini.parse("session-start", odd)?.source).toBe("other");
  });

  test.each(["", "not json", "[]", '{"cwd":"/p"}', '{"session_id":"s"}'])(
    "unusable input %p yields nothing instead of throwing",
    (stdin) => {
      expect(gemini.parse("prompt", stdin)).toBeNull();
    },
  );
});

describe("gemini render", () => {
  test("context for a prompt names Gemini's BeforeAgent event", () => {
    expect(JSON.parse(gemini.render("prompt", "<notes/>"))).toEqual({
      hookSpecificOutput: { hookEventName: "BeforeAgent", additionalContext: "<notes/>" },
    });
  });

  test("context at session start names that event", () => {
    expect(JSON.parse(gemini.render("session-start", "n"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "n" },
    });
  });

  test("other events, and empty context, print nothing", () => {
    expect(gemini.render("turn-end", "n")).toBe("");
    expect(gemini.render("prompt", null)).toBe("");
  });
});

describe("gemini transcript", () => {
  test("is not read: the format has not been captured, so the detail is empty", () => {
    expect(gemini.capabilities.transcript).toBe(false);
    expect(gemini.readTurnDetail("/nowhere", null)).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });
});
