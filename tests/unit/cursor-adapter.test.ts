import { describe, expect, test } from "bun:test";
import { cursor } from "../../src/adapters/cursor/adapter.ts";

// Cursor's payloads follow its documentation; none has been captured from a live session.
const common = {
  conversation_id: "conv-8f1c",
  generation_id: "gen-01",
  model: "composer-2",
  hook_event_name: "beforeSubmitPrompt",
  cursor_version: "2.4.0",
  workspace_roots: ["/Users/dev/project", "/Users/dev/other"],
};

describe("cursor payloads", () => {
  test("session start: the conversation is the session, the first workspace root is the cwd", () => {
    expect(
      cursor.parse(
        "session-start",
        JSON.stringify({
          ...common,
          hook_event_name: "sessionStart",
          session_id: "s-1",
          is_background_agent: false,
          composer_mode: "agent",
        }),
      ),
    ).toEqual({
      agent: "cursor",
      event: "session-start",
      sessionId: "conv-8f1c",
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
    });
  });

  test("before a prompt is submitted: the prompt; Cursor's generation is not relied on as a turn id", () => {
    expect(
      cursor.parse("prompt", JSON.stringify({ ...common, prompt: "why does it fail?" })),
    ).toMatchObject({
      event: "prompt",
      turnId: null,
      prompt: "why does it fail?",
    });
  });

  test("after the agent responds: the text is the final message", () => {
    expect(
      cursor.parse(
        "turn-end",
        JSON.stringify({ ...common, hook_event_name: "afterAgentResponse", text: "Fixed." }),
      ),
    ).toMatchObject({ event: "turn-end", finalText: "Fixed." });
  });

  test("a background (cloud) agent is treated like a subagent: ignored", () => {
    expect(
      cursor.parse("session-start", JSON.stringify({ ...common, is_background_agent: true }))
        ?.subagent,
    ).toBe(true);
  });

  test("the transcript path is taken when Cursor provides one", () => {
    expect(
      cursor.parse(
        "prompt",
        JSON.stringify({ ...common, prompt: "p", transcript_path: "/t.jsonl" }),
      )?.transcriptPath,
    ).toBe("/t.jsonl");
  });

  test.each([
    "",
    "nope",
    "[]",
    '{"workspace_roots":["/p"]}',
    '{"conversation_id":"c"}',
    '{"conversation_id":"c","workspace_roots":[]}',
  ])("unusable input %p yields nothing", (stdin) => {
    expect(cursor.parse("prompt", stdin)).toBeNull();
  });
});

describe("cursor render", () => {
  test("session context goes out as additional_context", () => {
    expect(JSON.parse(cursor.render("session-start", "brief"))).toEqual({
      additional_context: "brief",
    });
  });

  test("a prompt is always let through, and never carries context: Cursor cannot take any there", () => {
    expect(cursor.capabilities.promptInjection).toBe(false);
    expect(JSON.parse(cursor.render("prompt", null))).toEqual({ continue: true });
    expect(JSON.parse(cursor.render("prompt", "<notes/>"))).toEqual({ continue: true });
  });

  test("other events print nothing", () => {
    expect(cursor.render("turn-end", "n")).toBe("");
    expect(cursor.render("session-end", "n")).toBe("");
    expect(cursor.render("session-start", null)).toBe("");
  });
});

describe("cursor transcript", () => {
  test("is not read yet", () => {
    expect(cursor.capabilities.transcript).toBe(false);
    expect(cursor.readTurnDetail("/nowhere", null).filesChanged).toEqual([]);
  });
});
