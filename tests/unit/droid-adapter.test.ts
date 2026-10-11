import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { droid } from "../../src/adapters/droid/adapter.ts";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { HookEvent } from "../../src/core/types.ts";

// The fixtures come from Factory Droid's documentation, not from a captured session.
const FIXTURES = new URL("../fixtures/droid/", import.meta.url).pathname;
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

describe("droid payloads", () => {
  test("is registered", () => {
    expect(ADAPTERS.droid).toBe(droid);
  });

  test("every fixture parses", () => {
    const names = readdirSync(join(FIXTURES, "payloads")).map((file) => file.replace(".json", ""));
    expect(names.sort()).toEqual(Object.keys(EVENT_OF).sort());
    for (const name of names) {
      const event = EVENT_OF[name] as HookEvent;
      expect(droid.parse(event, payload(name))).toMatchObject({
        agent: "droid",
        event,
        sessionId: SESSION,
        cwd: "/Users/dev/project",
      });
    }
  });

  test("session start", () => {
    expect(droid.parse("session-start", payload("session-start.startup"))).toEqual({
      agent: "droid",
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

  test("prompt submission carries the prompt; no turn is named", () => {
    expect(droid.parse("prompt", payload("user-prompt-submit"))).toMatchObject({
      event: "prompt",
      turnId: null,
      prompt: PROMPT,
      finalText: null,
    });
  });

  test("turn end names no turn and carries no text", () => {
    expect(droid.parse("turn-end", payload("stop"))).toMatchObject({
      event: "turn-end",
      turnId: null,
      finalText: null,
      prompt: null,
    });
  });

  test("session end", () => {
    expect(droid.parse("session-end", payload("session-end"))).toMatchObject({
      event: "session-end",
      source: null,
    });
  });

  test("a compacted session says so; an unknown source is 'other'", () => {
    const start = JSON.parse(payload("session-start.startup"));
    expect(
      droid.parse("session-start", JSON.stringify({ ...start, source: "compact" }))?.source,
    ).toBe("compact");
    expect(droid.parse("session-start", JSON.stringify({ ...start, source: "fork" }))?.source).toBe(
      "other",
    );
  });

  test("unknown extra fields are ignored", () => {
    const extra = JSON.stringify({ ...JSON.parse(payload("stop")), something_new: { a: 1 } });
    expect(droid.parse("turn-end", extra)?.event).toBe("turn-end");
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
      expect(droid.parse(event, stdin)).toBeNull();
    }
  });
});

describe("droid render", () => {
  test("context for a prompt is wrapped the way Factory Droid reads it", () => {
    expect(JSON.parse(droid.render("prompt", "<notes/>"))).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "<notes/>" },
    });
  });

  test("context at session start names that event", () => {
    expect(JSON.parse(droid.render("session-start", "n"))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "n" },
    });
  });

  test("events that cannot carry context print nothing, and so does empty context", () => {
    expect(droid.render("turn-end", "n")).toBe("");
    expect(droid.render("session-end", "n")).toBe("");
    expect(droid.render("file-read", "n")).toBe("");
    expect(droid.render("prompt", "")).toBe("");
    expect(droid.render("prompt", null)).toBe("");
  });

  test("context is clipped to the adapter's limit", () => {
    const rendered = JSON.parse(droid.render("prompt", "x".repeat(50_000)));
    expect(rendered.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      droid.capabilities.maxInjectionChars,
    );
  });

  test("capabilities are honest: injection both ways, no final message, no transcript", () => {
    expect(droid.capabilities).toMatchObject({
      sessionInjection: true,
      promptInjection: true,
      finalMessageInPayload: false,
      transcript: false,
    });
    expect(droid.readTurnDetail("/nowhere.jsonl", "msg-1")).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });
});
