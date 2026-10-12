import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { antigravity } from "../../src/adapters/antigravity/adapter.ts";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { HookEvent } from "../../src/core/types.ts";

// The fixtures come from Google's Antigravity documentation, not from a captured session.
const FIXTURES = new URL("../fixtures/antigravity/", import.meta.url).pathname;
const payload = (name: string) => readFileSync(join(FIXTURES, "payloads", `${name}.json`), "utf8");
const CONVERSATION = "ec33ebf9-0cba-4100-8142-c61503f6c587";
const TRANSCRIPT = `~/.gemini/antigravity/brain/${CONVERSATION}/.system_generated/logs/transcript.jsonl`;
const variant = (name: string, change: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(payload(name)), ...change });

// Which of our events each fixture is registered as; null: parsed, and deliberately unused.
const EVENT_OF: Record<string, [HookEvent, boolean]> = {
  "pre-invocation.first": ["session-start", true],
  "pre-invocation": ["session-start", false],
  stop: ["turn-end", true],
};

describe("antigravity payloads", () => {
  test("is registered", () => {
    expect(ADAPTERS.antigravity).toBe(antigravity);
  });

  test("every fixture parses, and only the first model call of a conversation starts it", () => {
    const names = readdirSync(join(FIXTURES, "payloads")).map((file) => file.replace(".json", ""));
    expect(names.sort()).toEqual(Object.keys(EVENT_OF).sort());
    for (const name of names) {
      const [event, used] = EVENT_OF[name] as [HookEvent, boolean];
      const input = antigravity.parse(event, payload(name));
      if (!used) {
        expect(input).toBeNull();
        continue;
      }
      expect(input).toMatchObject({
        agent: "antigravity",
        event,
        sessionId: CONVERSATION,
        cwd: "/workspace/project",
        subagent: false,
      });
    }
  });

  test("the first PreInvocation is a session start, with the documented fields", () => {
    expect(antigravity.parse("session-start", payload("pre-invocation.first"))).toEqual({
      agent: "antigravity",
      event: "session-start",
      sessionId: CONVERSATION,
      cwd: "/workspace/project",
      turnId: null,
      transcriptPath: TRANSCRIPT,
      prompt: null,
      finalText: null,
      source: "startup",
      toolFile: null,
      toolError: null,
      subagent: false,
    });
  });

  test("a later model call in the same conversation is nothing: never a brief per model call", () => {
    for (const invocationNum of [1, 2, 3, 40]) {
      expect(
        antigravity.parse("session-start", variant("pre-invocation.first", { invocationNum })),
      ).toBeNull();
    }
  });

  test("a PreInvocation without a usable invocationNum is nothing, not a session start", () => {
    for (const invocationNum of [undefined, null, "0", -1, 0.5]) {
      expect(
        antigravity.parse("session-start", variant("pre-invocation.first", { invocationNum })),
      ).toBeNull();
    }
  });

  test("Stop ends the turn; it names no turn and carries no text", () => {
    expect(antigravity.parse("turn-end", payload("stop"))).toEqual({
      agent: "antigravity",
      event: "turn-end",
      sessionId: CONVERSATION,
      cwd: "/workspace/project",
      turnId: null,
      transcriptPath: TRANSCRIPT,
      prompt: null,
      finalText: null,
      source: null,
      toolFile: null,
      toolError: null,
      subagent: false,
    });
  });

  test("with several workspaces, the first is the working directory", () => {
    const stdin = variant("stop", { workspacePaths: ["/a", "/b"] });
    expect(antigravity.parse("turn-end", stdin)?.cwd).toBe("/a");
  });

  test("events we do not register are nothing", () => {
    for (const event of ["prompt", "session-end", "file-read", "tool-failed"] as const) {
      expect(antigravity.parse(event, payload("pre-invocation.first"))).toBeNull();
      expect(antigravity.parse(event, payload("stop"))).toBeNull();
    }
  });

  test("unknown extra fields are ignored", () => {
    expect(antigravity.parse("turn-end", variant("stop", { somethingNew: { a: 1 } }))?.event).toBe(
      "turn-end",
    );
  });

  test.each([
    "",
    "not json",
    "[]",
    "null",
    '{"workspacePaths":["/p"],"invocationNum":0}',
    '{"conversationId":"c","invocationNum":0}',
    '{"conversationId":"c","workspacePaths":[],"invocationNum":0}',
    '{"conversationId":"c","workspacePaths":"/p","invocationNum":0}',
    '{"conversationId":"c","workspacePaths":[""],"invocationNum":0}',
    '{"conversationId":"c","workspacePaths":[42],"invocationNum":0}',
    '{"conversationId":42,"workspacePaths":["/p"],"invocationNum":0}',
    '{"conversationId":"","workspacePaths":["/p"],"invocationNum":0}',
  ])("unusable input %p yields nothing instead of throwing", (stdin) => {
    for (const event of ["session-start", "turn-end"] as const) {
      expect(antigravity.parse(event, stdin)).toBeNull();
    }
  });
});

describe("antigravity render", () => {
  test("the session brief goes back as one ephemeral message, the documented injectSteps shape", () => {
    expect(JSON.parse(antigravity.render("session-start", "n"))).toEqual({
      injectSteps: [{ ephemeralMessage: "n" }],
    });
  });

  test("Stop is answered with an explicit decision that allows the stop", () => {
    const stop = antigravity.parse("turn-end", payload("stop")) ?? undefined;
    expect(JSON.parse(antigravity.render("turn-end", null, stop))).toEqual({ decision: "stop" });
    expect(JSON.parse(antigravity.render("turn-end", "n", stop))).toEqual({ decision: "stop" });
  });

  test("events that cannot carry context print nothing, and so does empty context", () => {
    expect(antigravity.render("prompt", "n")).toBe("");
    expect(antigravity.render("session-end", "n")).toBe("");
    expect(antigravity.render("file-read", "n")).toBe("");
    expect(antigravity.render("session-start", "")).toBe("");
    expect(antigravity.render("session-start", null)).toBe("");
  });

  test("context is clipped to the adapter's limit", () => {
    const rendered = JSON.parse(antigravity.render("session-start", "x".repeat(50_000)));
    expect(rendered.injectSteps[0].ephemeralMessage.length).toBeLessThanOrEqual(
      antigravity.capabilities.maxInjectionChars,
    );
  });

  test("capabilities are honest: a brief at session start only, no prompt, no final message, no transcript", () => {
    expect(antigravity.capabilities).toMatchObject({
      sessionInjection: true,
      promptInjection: false,
      finalMessageInPayload: false,
      transcript: false,
    });
    expect(antigravity.readTurnDetail(TRANSCRIPT, null)).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });
});
