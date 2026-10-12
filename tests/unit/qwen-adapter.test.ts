import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADAPTERS } from "../../src/adapters/index.ts";
import { qwen } from "../../src/adapters/qwen/adapter.ts";
import type { HookEvent } from "../../src/core/types.ts";

// The fixtures come from Qwen Code's documentation, not from a captured session.
const FIXTURES = new URL("../fixtures/qwen/", import.meta.url).pathname;
const payload = (name: string) => readFileSync(join(FIXTURES, "payloads", `${name}.json`), "utf8");
const SESSION = "4f1d2c7a-9b3e-4d1a-8c55-0e6f7a2b9c10";
const PROMPT =
  "Create a file named hello.txt containing the single word hi. Then reply with exactly: done";

const EVENT_OF: Record<string, HookEvent> = {
  "session-start.startup": "session-start",
  "user-prompt-submit": "prompt",
  stop: "turn-end",
  "session-end": "session-end",
};

describe("qwen payloads", () => {
  test("is registered", () => {
    expect(ADAPTERS.qwen).toBe(qwen);
  });

  test("every fixture parses", () => {
    const names = readdirSync(join(FIXTURES, "payloads")).map((file) => file.replace(".json", ""));
    expect(names.sort()).toEqual(Object.keys(EVENT_OF).sort());
    for (const name of names) {
      const event = EVENT_OF[name] as HookEvent;
      expect(qwen.parse(event, payload(name))).toMatchObject({
        agent: "qwen",
        event,
        sessionId: SESSION,
        cwd: "/Users/dev/project",
      });
    }
  });

  test("session start", () => {
    expect(qwen.parse("session-start", payload("session-start.startup"))).toEqual({
      agent: "qwen",
      event: "session-start",
      sessionId: SESSION,
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath: "/path/to/transcript.jsonl",
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
    });
  });

  test("prompt submission carries the user's submitted prompt and the turn's prompt_id", () => {
    expect(qwen.parse("prompt", payload("user-prompt-submit"))).toMatchObject({
      event: "prompt",
      turnId: "prompt-1",
      prompt: PROMPT,
      finalText: null,
    });
  });

  test("a model-bound send without submitted_prompt (a tool result, a continuation) opens no turn", () => {
    const { submitted_prompt: _, ...rest } = JSON.parse(payload("user-prompt-submit"));
    const continuation = JSON.stringify({ ...rest, prompt: "[tool result]" });
    expect(qwen.parse("prompt", continuation)?.prompt).toBeNull();
  });

  test("turn end carries the assistant's last message under the same prompt_id", () => {
    expect(qwen.parse("turn-end", payload("stop"))).toMatchObject({
      event: "turn-end",
      turnId: "prompt-1",
      finalText: "done",
      prompt: null,
    });
  });

  test("session end", () => {
    expect(qwen.parse("session-end", payload("session-end"))).toMatchObject({
      event: "session-end",
      source: null,
    });
  });

  test("a compacted session says so; an unknown source is 'other'", () => {
    const start = JSON.parse(payload("session-start.startup"));
    expect(
      qwen.parse("session-start", JSON.stringify({ ...start, source: "compact" }))?.source,
    ).toBe("compact");
    expect(qwen.parse("session-start", JSON.stringify({ ...start, source: "fork" }))?.source).toBe(
      "other",
    );
  });

  test("an event inside a subagent is marked as such", () => {
    const stop = JSON.parse(payload("stop"));
    expect(qwen.parse("turn-end", JSON.stringify({ ...stop, agent_id: "a1" }))?.subagent).toBe(
      true,
    );
  });

  test("unknown extra fields are ignored", () => {
    const extra = JSON.stringify({ ...JSON.parse(payload("stop")), something_new: { a: 1 } });
    expect(qwen.parse("turn-end", extra)?.finalText).toBe("done");
  });

  test.each([
    "",
    "not json",
    "[]",
    "null",
    '{"cwd":"/p"}',
    '{"session_id":"s"}',
    '{"session_id":42,"cwd":"/p"}',
  ])("unusable input %p yields nothing instead of throwing", (stdin) => {
    for (const event of ["session-start", "prompt", "turn-end", "session-end"] as const) {
      expect(qwen.parse(event, stdin)).toBeNull();
    }
  });
});

describe("qwen render", () => {
  test("context for a prompt is wrapped the way Qwen Code reads it", () => {
    expect(JSON.parse(qwen.render("prompt", "<notes/>"))).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "<notes/>" },
    });
  });

  test("context at session start names that event", () => {
    expect(JSON.parse(qwen.render("session-start", "n"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "n" },
    });
  });

  test("events that cannot carry context print nothing, and so does empty context", () => {
    expect(qwen.render("turn-end", "n")).toBe("");
    expect(qwen.render("session-end", "n")).toBe("");
    expect(qwen.render("file-read", "n")).toBe("");
    expect(qwen.render("prompt", "")).toBe("");
    expect(qwen.render("prompt", null)).toBe("");
  });

  test("context is clipped to the adapter's limit", () => {
    const rendered = JSON.parse(qwen.render("prompt", "x".repeat(50_000)));
    expect(rendered.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      qwen.capabilities.maxInjectionChars,
    );
  });

  test("capabilities are honest: injection both ways, final message in Stop, no transcript", () => {
    expect(qwen.capabilities).toMatchObject({
      sessionInjection: true,
      promptInjection: true,
      finalMessageInPayload: true,
      transcript: false,
    });
    expect(qwen.readTurnDetail("/nowhere.jsonl", "prompt-1")).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });
});
