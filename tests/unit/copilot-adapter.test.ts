import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { copilot } from "../../src/adapters/copilot/adapter.ts";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { HookEvent } from "../../src/core/types.ts";

// The fixtures come from GitHub's and VS Code's documentation, not from a captured session.
const FIXTURES = new URL("../fixtures/copilot/", import.meta.url).pathname;
const payload = (name: string) => readFileSync(join(FIXTURES, "payloads", `${name}.json`), "utf8");
const SESSION = "7c2e9a41-5d3b-4f6e-9a18-2b4c6d8e0f13";
const PROMPT =
  "Create a file named hello.txt containing the single word hi. Then reply with exactly: done";

const EVENT_OF: Record<string, HookEvent> = {
  "session-start": "session-start",
  "user-prompt-submitted": "prompt",
  "agent-stop": "turn-end",
  "session-end": "session-end",
  "vscode.session-start": "session-start",
  "vscode.user-prompt-submit": "prompt",
  "vscode.stop": "turn-end",
};

describe("copilot payloads", () => {
  test("is registered", () => {
    expect(ADAPTERS.copilot).toBe(copilot);
  });

  test("every fixture parses", () => {
    const names = readdirSync(join(FIXTURES, "payloads")).map((file) => file.replace(".json", ""));
    expect(names.sort()).toEqual(Object.keys(EVENT_OF).sort());
    for (const name of names) {
      const event = EVENT_OF[name] as HookEvent;
      expect(copilot.parse(event, payload(name))).toMatchObject({
        agent: "copilot",
        event,
        sessionId: SESSION,
        cwd: "/Users/dev/project",
        subagent: false,
      });
    }
  });

  test("session start from the CLI", () => {
    expect(copilot.parse("session-start", payload("session-start"))).toEqual({
      agent: "copilot",
      event: "session-start",
      sessionId: SESSION,
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
      dialect: "cli",
    });
  });

  test("session start from VS Code", () => {
    expect(copilot.parse("session-start", payload("vscode.session-start"))).toEqual({
      agent: "copilot",
      event: "session-start",
      sessionId: SESSION,
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath: `/Users/dev/transcripts/${SESSION}.json`,
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
      dialect: "vscode",
    });
  });

  test("a prompt carries the prompt in both dialects; no turn is named", () => {
    for (const name of ["user-prompt-submitted", "vscode.user-prompt-submit"]) {
      expect(copilot.parse("prompt", payload(name))).toMatchObject({
        event: "prompt",
        turnId: null,
        prompt: PROMPT,
        finalText: null,
      });
    }
  });

  test("turn end names no turn and carries no text; the transcript path is kept", () => {
    expect(copilot.parse("turn-end", payload("agent-stop"))).toMatchObject({
      event: "turn-end",
      turnId: null,
      finalText: null,
      prompt: null,
      transcriptPath: `/Users/dev/.copilot/session-state/${SESSION}/events.jsonl`,
    });
    expect(copilot.parse("turn-end", payload("vscode.stop"))).toMatchObject({
      event: "turn-end",
      transcriptPath: `/Users/dev/transcripts/${SESSION}.json`,
    });
  });

  test("session end", () => {
    expect(copilot.parse("session-end", payload("session-end"))).toMatchObject({
      event: "session-end",
      source: null,
    });
  });

  test("a resumed session says so; an undocumented source is 'other'", () => {
    const start = JSON.parse(payload("session-start"));
    expect(
      copilot.parse("session-start", JSON.stringify({ ...start, source: "resume" }))?.source,
    ).toBe("resume");
    expect(
      copilot.parse("session-start", JSON.stringify({ ...start, source: "fork" }))?.source,
    ).toBe("other");
  });

  test("unknown extra fields are ignored", () => {
    const extra = JSON.stringify({ ...JSON.parse(payload("agent-stop")), somethingNew: { a: 1 } });
    expect(copilot.parse("turn-end", extra)?.event).toBe("turn-end");
  });

  test.each([
    "",
    "not json",
    "[]",
    "null",
    '{"cwd":"/p"}',
    '{"sessionId":"s"}',
    '{"session_id":"s"}',
    '{"hook_event_name":"Stop","cwd":"/p"}',
    '{"sessionId":42,"cwd":"/p"}',
    '{"sessionId":"s","cwd":""}',
  ])("unusable input %p yields nothing instead of throwing", (stdin) => {
    for (const event of ["session-start", "prompt", "turn-end", "session-end"] as const) {
      expect(copilot.parse(event, stdin)).toBeNull();
    }
  });
});

describe("copilot render", () => {
  const cli = copilot.parse("session-start", payload("session-start")) ?? undefined;
  const vscode = copilot.parse("session-start", payload("vscode.session-start")) ?? undefined;

  test("the CLI reads a top-level additionalContext at session start", () => {
    expect(JSON.parse(copilot.render("session-start", "n", cli))).toEqual({
      additionalContext: "n",
    });
  });

  test("VS Code reads hookSpecificOutput at session start", () => {
    expect(JSON.parse(copilot.render("session-start", "n", vscode))).toEqual({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "n" },
    });
  });

  test("without a payload to go by, the CLI's shape", () => {
    expect(JSON.parse(copilot.render("session-start", "n"))).toEqual({ additionalContext: "n" });
  });

  test("a prompt prints nothing, whatever the context: the host drops it", () => {
    expect(copilot.render("prompt", "<notes/>", cli)).toBe("");
    expect(copilot.render("prompt", "<notes/>", vscode)).toBe("");
  });

  test("events that cannot carry context print nothing, and so does empty context", () => {
    expect(copilot.render("turn-end", "n", cli)).toBe("");
    expect(copilot.render("session-end", "n", cli)).toBe("");
    expect(copilot.render("file-read", "n", cli)).toBe("");
    expect(copilot.render("session-start", "", cli)).toBe("");
    expect(copilot.render("session-start", null, vscode)).toBe("");
  });

  test("context is clipped to the adapter's limit", () => {
    const rendered = JSON.parse(copilot.render("session-start", "x".repeat(50_000), cli));
    expect(rendered.additionalContext.length).toBeLessThanOrEqual(
      copilot.capabilities.maxInjectionChars,
    );
  });

  test("capabilities are honest: a brief at session start only, no final message, no transcript", () => {
    expect(copilot.capabilities).toMatchObject({
      sessionInjection: true,
      promptInjection: false,
      finalMessageInPayload: false,
      transcript: false,
    });
    expect(copilot.readTurnDetail("/nowhere.jsonl", null)).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });
});
