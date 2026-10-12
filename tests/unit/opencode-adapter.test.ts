import { describe, expect, test } from "bun:test";
import { opencode } from "../../src/adapters/opencode/adapter.ts";

// The payloads are our own: the OpenCode plugin builds them from the plugin API.
const base = { session_id: "ses_ef2f396feffeI8LbMwghPEz7FV", cwd: "/Users/dev/project" };

describe("opencode payloads", () => {
  test("session start, as the plugin sends it when a session is created", () => {
    expect(opencode.parse("session-start", JSON.stringify({ ...base, source: "startup" }))).toEqual(
      {
        agent: "opencode",
        event: "session-start",
        sessionId: base.session_id,
        cwd: base.cwd,
        turnId: null,
        transcriptPath: null,
        prompt: null,
        finalText: null,
        source: "startup",
        toolFile: null,
        toolError: null,
        subagent: false,
      },
    );
  });

  test("a prompt names the turn by the user message's id", () => {
    expect(
      opencode.parse(
        "prompt",
        JSON.stringify({ ...base, turn_id: "msg_10d0c6961001", prompt: "why does it fail?" }),
      ),
    ).toMatchObject({ event: "prompt", turnId: "msg_10d0c6961001", prompt: "why does it fail?" });
  });

  test("turn end carries the assistant's last message under the same id", () => {
    expect(
      opencode.parse(
        "turn-end",
        JSON.stringify({ ...base, turn_id: "msg_10d0c6961001", last_assistant_message: "Fixed." }),
      ),
    ).toMatchObject({ event: "turn-end", turnId: "msg_10d0c6961001", finalText: "Fixed." });
  });

  test.each(["", "nope", "[]", '{"cwd":"/p"}'])("unusable input %p yields nothing", (stdin) => {
    expect(opencode.parse("prompt", stdin)).toBeNull();
  });
});

describe("opencode render", () => {
  test("context is printed as it is: the plugin puts it into the system prompt itself", () => {
    expect(opencode.render("prompt", "<notes/>")).toBe("<notes/>");
    expect(opencode.render("session-start", "brief")).toBe("brief");
  });

  test("other events, and empty context, print nothing", () => {
    expect(opencode.render("turn-end", "n")).toBe("");
    expect(opencode.render("prompt", null)).toBe("");
    expect(opencode.render("prompt", "")).toBe("");
  });

  test("context is cut to the limit", () => {
    expect(opencode.render("prompt", "x".repeat(50_000)).length).toBeLessThanOrEqual(
      opencode.capabilities.maxInjectionChars,
    );
  });
});

describe("opencode transcript", () => {
  test("is not read: the plugin has no file to point at", () => {
    expect(opencode.capabilities.transcript).toBe(false);
    expect(opencode.readTurnDetail("/nowhere", null).commands).toEqual([]);
  });
});
