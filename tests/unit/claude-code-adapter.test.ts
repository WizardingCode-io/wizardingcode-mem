import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode } from "../../src/adapters/claude-code/adapter.ts";
import type { HookEvent } from "../../src/core/types.ts";

const FIXTURES = new URL("../fixtures/claude-code/", import.meta.url).pathname;
const payload = (name: string) => readFileSync(join(FIXTURES, "payloads", `${name}.json`), "utf8");
const TRANSCRIPT = join(FIXTURES, "transcripts", "write-tool.jsonl");
const WRITE_TURN = "39fa363e-4bbd-4d72-b47f-3c439e8e291f";
const PLAIN_TURN = "035dc7e4-3ed5-48a9-b032-ca24825a8af6";

describe("claude-code payloads", () => {
  test("session start", () => {
    expect(claudeCode.parse("session-start", payload("session-start.startup"))).toEqual({
      agent: "claude-code",
      event: "session-start",
      sessionId: "205fc789-847d-4d65-a969-6aa483d2fb82",
      cwd: "/Users/dev/project",
      turnId: null,
      transcriptPath:
        "/Users/dev/.claude/projects/-Users-dev-project/205fc789-847d-4d65-a969-6aa483d2fb82.jsonl",
      prompt: null,
      finalText: null,
      source: "startup",
      subagent: false,
      toolFile: null,
      toolError: null,
    });
  });

  test("a file read carries the path the tool read", () => {
    expect(claudeCode.parse("file-read", payload("post-tool-use.read"))).toMatchObject({
      event: "file-read",
      toolFile: "/work/shop/src/store/db.ts",
      toolError: null,
      prompt: null,
    });
  });

  test("a failed tool carries the error, unless the user interrupted it", () => {
    expect(claudeCode.parse("tool-failed", payload("post-tool-use-failure.bash"))).toMatchObject({
      event: "tool-failed",
      toolFile: null,
      toolError: "Exit code 1\nSQLITE_BUSY: database is locked",
    });
    const interrupted = JSON.stringify({
      ...JSON.parse(payload("post-tool-use-failure.bash")),
      is_interrupt: true,
    });
    expect(claudeCode.parse("tool-failed", interrupted)?.toolError).toBeNull();
  });

  test("a read without tool_input has no file", () => {
    const bare = JSON.stringify({ session_id: "s", cwd: "/p" });
    expect(claudeCode.parse("file-read", bare)?.toolFile).toBeNull();
  });

  test("a resumed session says so", () => {
    expect(claudeCode.parse("session-start", payload("session-start.resume"))?.source).toBe(
      "resume",
    );
  });

  test("prompt submission carries the prompt and the id that names the turn", () => {
    expect(claudeCode.parse("prompt", payload("user-prompt-submit"))).toMatchObject({
      event: "prompt",
      turnId: WRITE_TURN,
      prompt:
        "Create a file named hello.txt containing the single word hi. Then reply with exactly: done",
      finalText: null,
    });
  });

  test("turn end carries the assistant's final message under the same turn id", () => {
    expect(claudeCode.parse("turn-end", payload("stop"))).toMatchObject({
      event: "turn-end",
      turnId: WRITE_TURN,
      finalText: "done",
      prompt: null,
    });
  });

  test("session end", () => {
    expect(claudeCode.parse("session-end", payload("session-end"))).toMatchObject({
      event: "session-end",
      sessionId: "205fc789-847d-4d65-a969-6aa483d2fb82",
    });
  });

  test("an event from inside a subagent is flagged", () => {
    const inSubagent = JSON.stringify({ ...JSON.parse(payload("stop")), agent_id: "a1" });
    expect(claudeCode.parse("turn-end", inSubagent)?.subagent).toBe(true);
  });

  test("an unknown session source is passed through as 'other'", () => {
    const forked = JSON.stringify({
      ...JSON.parse(payload("session-start.startup")),
      source: "fork",
    });
    expect(claudeCode.parse("session-start", forked)?.source).toBe("other");
  });

  test.each(["", "not json", "[]", "null", "42", '{"cwd":"/p"}', '{"session_id":"s"}'])(
    "unusable input %p yields nothing instead of throwing",
    (stdin) => {
      expect(claudeCode.parse("prompt", stdin)).toBeNull();
    },
  );

  // The payload is another program's output: any field may vanish or change type.
  test("never throws, whichever fields are missing or mistyped", () => {
    const events: [HookEvent, string][] = [
      ["session-start", "session-start.startup"],
      ["prompt", "user-prompt-submit"],
      ["turn-end", "stop"],
      ["session-end", "session-end"],
    ];
    const junk = [null, 7, true, [], {}, ""];
    for (const [event, name] of events) {
      const full = JSON.parse(payload(name)) as Record<string, unknown>;
      for (const key of Object.keys(full)) {
        const without = { ...full };
        delete without[key];
        expect(() => claudeCode.parse(event, JSON.stringify(without))).not.toThrow();
        for (const value of junk) {
          expect(() =>
            claudeCode.parse(event, JSON.stringify({ ...full, [key]: value })),
          ).not.toThrow();
        }
      }
    }
  });
});

describe("claude-code render", () => {
  test("context for a prompt is wrapped the way the host expects", () => {
    expect(JSON.parse(claudeCode.render("prompt", "remember this"))).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "remember this" },
    });
  });

  test("context after a file read names PostToolUse", () => {
    expect(JSON.parse(claudeCode.render("file-read", "notes"))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "notes" },
    });
    expect(JSON.parse(claudeCode.render("tool-failed", "notes")).hookSpecificOutput).toEqual({
      hookEventName: "PostToolUseFailure",
      additionalContext: "notes",
    });
  });

  test("context at session start names that event", () => {
    expect(JSON.parse(claudeCode.render("session-start", "brief")).hookSpecificOutput).toEqual({
      hookEventName: "SessionStart",
      additionalContext: "brief",
    });
  });

  test.each([null, ""])("no context (%p) prints nothing at all", (context) => {
    expect(claudeCode.render("prompt", context)).toBe("");
  });

  test.each(["turn-end", "session-end"] as const)("%s never prints", (event) => {
    expect(claudeCode.render(event, "anything")).toBe("");
  });

  test("context is cut to the host's limit", () => {
    const out = JSON.parse(claudeCode.render("prompt", "x".repeat(50_000)));
    expect(out.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(
      claudeCode.capabilities.maxInjectionChars,
    );
    expect(claudeCode.capabilities.maxInjectionChars).toBe(10_000);
  });
});

describe("claude-code transcript", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-transcript-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const user = (promptId: string, text: string) =>
    JSON.stringify({ type: "user", promptId, message: { role: "user", content: text } });
  const toolUse = (id: string, name: string, input: Record<string, unknown>) =>
    JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    });
  const toolResult = (promptId: string, id: string, content: string, isError = false) =>
    JSON.stringify({
      type: "user",
      promptId,
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
      },
    });
  const write = (...lines: string[]) => {
    const path = join(dir, "t.jsonl");
    writeFileSync(path, `${lines.join("\n")}\n`);
    return path;
  };

  test("a real transcript: the turn that wrote a file reports that file", () => {
    expect(claudeCode.readTurnDetail(TRANSCRIPT, WRITE_TURN)).toEqual({
      filesRead: [],
      filesChanged: ["/Users/dev/project/hello.txt"],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });

  test("a real transcript: a later turn does not inherit an earlier turn's files", () => {
    expect(claudeCode.readTurnDetail(TRANSCRIPT, PLAIN_TURN)).toEqual({
      filesRead: [],
      filesChanged: [],
      commands: [],
      errors: [],
      savedMemory: false,
    });
  });

  test("collects reads, edits, commands and failed tool calls, each once", () => {
    const path = write(
      user("p0", "earlier"),
      toolUse("t0", "Read", { file_path: "/p/old.ts" }),
      user("p1", "do the thing"),
      toolUse("t1", "Read", { file_path: "/p/a.ts" }),
      toolResult("p1", "t1", "contents"),
      toolUse("t2", "Edit", { file_path: "/p/a.ts", old_string: "x", new_string: "y" }),
      toolUse("t3", "Read", { file_path: "/p/a.ts" }),
      toolUse("t4", "Bash", { command: "bun test" }),
      toolResult("p1", "t4", "1 fail\nexpected 2, received 3", true),
      toolUse("t5", "NotebookEdit", { notebook_path: "/p/n.ipynb" }),
      toolUse("t6", "Bash", { command: "bun test" }),
      user("p2", "next"),
      toolUse("t7", "Write", { file_path: "/p/later.ts" }),
    );
    expect(claudeCode.readTurnDetail(path, "p1")).toEqual({
      filesRead: ["/p/a.ts"],
      filesChanged: ["/p/a.ts", "/p/n.ipynb"],
      commands: ["bun test"],
      errors: ["1 fail\nexpected 2, received 3"],
      savedMemory: false,
    });
  });

  test("notices when the agent saved a memory itself during the turn, if the save worked", () => {
    const save = (id: string) =>
      toolUse(id, "mcp__wizardingcode-mem__memory_save", {
        text: "We use pnpm.",
        kind: "convention",
      });
    const path = write(
      user("p1", "remember this"),
      save("t1"),
      toolResult("p1", "t1", "Saved as #3."),
      user("p2", "search"),
      toolUse("t2", "mcp__wizardingcode-mem__memory_search", { query: "pnpm" }),
      toolResult("p2", "t2", "#3 [convention] We use pnpm."),
      user("p3", "remember that too"),
      save("t3"),
      toolResult("p3", "t3", "wizardingcode-mem: database is locked", true),
      user("p4", "and this"),
      save("t4"),
    );
    expect(claudeCode.readTurnDetail(path, "p1").savedMemory).toBe(true);
    expect(claudeCode.readTurnDetail(path, "p2").savedMemory).toBe(false);
    // A save that failed, or whose outcome is not known, saved nothing.
    expect(claudeCode.readTurnDetail(path, "p3").savedMemory).toBe(false);
    expect(claudeCode.readTurnDetail(path, "p4").savedMemory).toBe(false);
  });

  test("without a turn id, reads the last turn", () => {
    const path = write(
      user("p1", "first"),
      toolUse("t1", "Write", { file_path: "/p/one.ts" }),
      user("p2", "second"),
      toolUse("t2", "Write", { file_path: "/p/two.ts" }),
    );
    expect(claudeCode.readTurnDetail(path, null).filesChanged).toEqual(["/p/two.ts"]);
  });

  test("tolerates unknown line types, garbage and a truncated last line", () => {
    const path = write(
      '{"type":"some-future-type","x":1}',
      "not json at all",
      user("p1", "go"),
      '{"type":"assistant","message":"unexpected shape"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Write"}]}}',
      toolUse("t1", "Write", { file_path: "/p/ok.ts" }),
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Wri',
    );
    expect(claudeCode.readTurnDetail(path, "p1").filesChanged).toEqual(["/p/ok.ts"]);
  });

  test("a missing or unreadable transcript yields an empty detail", () => {
    const empty = { filesRead: [], filesChanged: [], commands: [], errors: [], savedMemory: false };
    expect(claudeCode.readTurnDetail(join(dir, "nope.jsonl"), "p1")).toEqual(empty);
    expect(claudeCode.readTurnDetail(dir, "p1")).toEqual(empty);
  });

  test("reads only the tail of a very large transcript", () => {
    const filler = toolUse("f", "Read", { file_path: `/p/${"x".repeat(900)}.ts` });
    const path = write(
      user("p0", "long ago"),
      ...Array.from({ length: 4000 }, () => filler),
      user("p1", "now"),
      toolUse("t1", "Write", { file_path: "/p/recent.ts" }),
    );
    const detail = claudeCode.readTurnDetail(path, "p1", { maxBytes: 64 * 1024 });
    expect(detail.filesChanged).toEqual(["/p/recent.ts"]);
    expect(detail.filesRead).toEqual([]);
  });

  // Cutting is the caller's job, after redacting: a secret cut in half is no longer recognised.
  test("returns long commands and errors whole, and bounds only the enormous", () => {
    const path = write(
      user("p1", "go"),
      toolUse("t1", "Bash", { command: `echo ${"a".repeat(5000)}` }),
      toolResult("p1", "t1", "e".repeat(5000), true),
      toolUse("t2", "Bash", { command: "b".repeat(200_000) }),
    );
    const detail = claudeCode.readTurnDetail(path, "p1");
    expect(detail.commands[0]?.length).toBe(5005);
    expect(detail.errors[0]?.length).toBe(5000);
    expect(detail.commands[1]?.length).toBeLessThanOrEqual(16 * 1024);
  });
});
