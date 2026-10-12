import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listCodexTranscripts,
  readCodexHistory,
  typedPrompt,
} from "../../src/adapters/codex/history.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-codex-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const meta = {
  timestamp: "2026-09-25T13:58:39.000Z",
  type: "session_meta",
  payload: { session_id: "c1", cwd: "/work/shop" },
};
const event = (timestamp: string, payload: Record<string, unknown>) => ({
  timestamp,
  type: "event_msg",
  payload,
});
const userMessage = (turnId: string, words: string, timestamp: string) =>
  event(timestamp, {
    type: "item_completed",
    turn_id: turnId,
    item: { type: "UserMessage", content: [{ type: "text", text: words }] },
  });
const complete = (turnId: string, words: string | null, timestamp: string) =>
  event(timestamp, { type: "task_complete", turn_id: turnId, last_agent_message: words });

function write(lines: unknown[], tail = ""): string {
  const path = join(dir, "rollout.jsonl");
  writeFileSync(path, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n${tail}`);
  return path;
}

describe("readCodexHistory", () => {
  test("each completed turn becomes a turn, with its prompt and last message", () => {
    const path = write([
      meta,
      event("2026-09-25T13:58:51.000Z", { type: "task_started", turn_id: "t1" }),
      userMessage("t1", "why do the tests time out?", "2026-09-25T13:58:51.500Z"),
      event("2026-09-25T13:59:00.000Z", {
        type: "item_completed",
        turn_id: "t1",
        item: { type: "FileChange", changes: { "/work/shop/db.ts": {} } },
      }),
      complete("t1", "Fixed: the pragma ran too late.", "2026-09-25T13:59:17.000Z"),
    ]);
    const [turn, ...rest] = readCodexHistory(path);
    expect(rest).toEqual([]);
    expect(turn).toMatchObject({
      agent: "codex",
      sessionId: "c1",
      turnId: "t1",
      cwd: "/work/shop",
      prompt: "why do the tests time out?",
      finalText: "Fixed: the pragma ran too late.",
      startedAt: Date.parse("2026-09-25T13:58:51.000Z"),
      endedAt: Date.parse("2026-09-25T13:59:17.000Z"),
    });
    expect(turn?.detail.filesChanged).toEqual(["/work/shop/db.ts"]);
  });

  test("a turn that never completed, or had no prompt, is left out", () => {
    const path = write(
      [
        meta,
        userMessage("t1", "start the deploy", "2026-09-25T14:00:00.000Z"),
        complete("t2", "Done.", "2026-09-25T14:01:00.000Z"),
      ],
      '{"timestamp":"2026-09-25T14:02',
    );
    expect(readCodexHistory(path)).toEqual([]);
  });

  test("a file without session metadata yields nothing", () => {
    expect(readCodexHistory(write([complete("t1", "Done.", "2026-09-25T14:01:00.000Z")]))).toEqual(
      [],
    );
  });
});

describe("readCodexHistory streaming", () => {
  test("many turns read in tiny chunks, lines spanning chunk boundaries", () => {
    const lines: unknown[] = [meta];
    for (let i = 0; i < 200; i++) {
      const id = `t${i}`;
      lines.push(
        event("2026-09-25T13:58:51.000Z", { type: "task_started", turn_id: id }),
        userMessage(id, `prompt number ${i}`, "2026-09-25T13:58:51.500Z"),
        complete(id, `answer ${i}`, "2026-09-25T13:59:17.000Z"),
      );
    }
    const turns = readCodexHistory(write(lines), { chunkBytes: 37 });
    expect(turns).toHaveLength(200);
    expect(turns.map((t) => t.turnId)).toEqual(Array.from({ length: 200 }, (_, i) => `t${i}`));
    expect(turns[199]).toMatchObject({ prompt: "prompt number 199", finalText: "answer 199" });
  });

  test("turns come out in the order they complete", () => {
    const path = write([
      meta,
      userMessage("a", "first", "2026-09-25T14:00:00.000Z"),
      userMessage("b", "second", "2026-09-25T14:00:01.000Z"),
      complete("b", "B", "2026-09-25T14:00:02.000Z"),
      complete("a", "A", "2026-09-25T14:00:03.000Z"),
    ]);
    expect(readCodexHistory(path).map((t) => t.turnId)).toEqual(["b", "a"]);
  });
});

describe("typedPrompt", () => {
  test("a realtime delegation contributes its input", () => {
    expect(
      typedPrompt([
        "<realtime_delegation>\n<context>x</context>\n<input>\n fix the build \n</input>\n</realtime_delegation>",
      ]),
    ).toBe("fix the build");
  });
  test("a delegation without input, or tag blocks only, give null", () => {
    expect(typedPrompt(["<realtime_delegation>nothing</realtime_delegation>"])).toBeNull();
    expect(
      typedPrompt(["<heartbeat>tick</heartbeat>", "<scheduled-task id=1>go</scheduled-task>"]),
    ).toBeNull();
  });
  test("a context block before typed text gives the typed text", () => {
    expect(typedPrompt(["# Files mentioned by the user:\n- a.ts", "  why is it slow?  "])).toBe(
      "why is it slow?",
    );
  });
  test("two typed texts give the last", () => {
    expect(typedPrompt(["first", "second"])).toBe("second");
  });
  test("plain text is itself", () => {
    expect(typedPrompt(["hello"])).toBe("hello");
  });
});

describe("readCodexHistory wrappers and aborts", () => {
  test("the prompt is the last typed message; only item events are kept", () => {
    const path = write([
      meta,
      userMessage("t1", "<heartbeat>tick</heartbeat>", "2026-09-25T14:00:00.000Z"),
      userMessage("t1", "real question", "2026-09-25T14:00:01.000Z"),
      complete("t1", "ok", "2026-09-25T14:00:02.000Z"),
      userMessage("t2", "<heartbeat>tick</heartbeat>", "2026-09-25T14:01:00.000Z"),
      complete("t2", "ok", "2026-09-25T14:01:02.000Z"),
    ]);
    const turns = readCodexHistory(path);
    expect(turns.map((t) => [t.turnId, t.prompt])).toEqual([["t1", "real question"]]);
  });

  test("an aborted turn is left out", () => {
    const path = write([
      meta,
      userMessage("t1", "start", "2026-09-25T14:00:00.000Z"),
      event("2026-09-25T14:00:01.000Z", { type: "turn_aborted", turn_id: "t1" }),
      complete("t1", "late", "2026-09-25T14:00:02.000Z"),
    ]);
    expect(readCodexHistory(path)).toEqual([]);
  });
});

describe("listCodexTranscripts", () => {
  test("walks the dated folders and keeps the recent files, oldest first", () => {
    const day = 86_400_000;
    const now = Date.now();
    const paths = ["2026/03/01/a.jsonl", "2026/09/20/b.jsonl", "2026/10/01/c.jsonl"].map((p) => {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), "");
      return join(dir, p);
    });
    [400, 20, 5].forEach((ago, i) => {
      utimesSync(paths[i] as string, new Date(now - ago * day), new Date(now - ago * day));
    });
    expect(listCodexTranscripts(dir, now - 180 * day)).toEqual([
      paths[1] as string,
      paths[2] as string,
    ]);
  });
});
