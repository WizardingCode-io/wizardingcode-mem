import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ADAPTERS } from "../../src/adapters/index.ts";
import type { AgentAdapter, HookInput } from "../../src/adapters/types.ts";
import type { AgentId, HookEvent } from "../../src/core/types.ts";
import { handleHook } from "../../src/hooks/handle.ts";
import { type Fixture, linksFixture, NOW, PROMPTS } from "../helpers/links-fixture.ts";

// What every adapter prints for every injecting moment, pinned from the code as it was
// before the hooks went through the module composer. With memory as the only module,
// these must stay byte for byte the same.

let fixture: Fixture | null = null;
afterEach(() => {
  fixture?.close();
  fixture = null;
});

const ERROR =
  "Exit code 1\nError: the lease timeout fired while the worker pool socket was draining";

/** The fixture, plus notes this test needs: some about one file, some about one failure. */
function seed(withLinks: boolean): Fixture {
  const f = linksFixture();
  const file = ["src/queue/lease.ts"];
  f.memory(f.app, {
    kind: "gotcha",
    title: "The lease must be renewed before the queue worker yields",
    body: "A worker that yields first loses the lease.\nRenew it in the same transaction.",
    importance: 4,
    files: file,
  });
  f.memory(f.app, {
    kind: "convention",
    title: "Lease durations are in milliseconds",
    body: "Never seconds: the queue compares them with Date.now().",
    files: file,
  });
  f.memory(f.app, {
    kind: "fix",
    title: "Lease timeout while the worker pool socket drains",
    body: "Draining the socket held the lease past its timeout; the drain now renews it.",
    importance: 4,
  });
  if (withLinks) {
    f.link(f.app, f.lib, "uses");
    f.link(f.site, f.app, "product");
    f.link(f.app, f.other, "uses", "suggested");
    const rule = f.memory(f.other, {
      kind: "convention",
      title: "Always retry the queue lease with backoff and jitter",
      body: "A bare retry stampedes the worker pool.",
      importance: 5,
    });
    f.userRule(rule);
    const lease = f.memory(f.lib, {
      kind: "gotcha",
      title: "The lib queue lease timeout ignores the worker pool size",
      importance: 5,
    });
    f.userRule(lease);
  }
  return f;
}

type Step = [HookEvent, Partial<HookInput>];

const STEPS: Step[] = [
  // A failure and a read before anything else, so that their notes are not already shown.
  ["tool-failed", { toolError: ERROR }],
  ["file-read", { toolFile: "app/src/queue/lease.ts" }],
  ["session-start", { source: "startup" }],
  ["prompt", { prompt: PROMPTS[0] as string }],
  ["prompt", { prompt: PROMPTS[0] as string }],
  ["prompt", { prompt: PROMPTS[2] as string }],
  ["file-read", { toolFile: "app/src/queue/lease.ts" }],
  ["file-read", { toolFile: "app/src/queue/lease.ts" }],
  ["file-read", { toolFile: "/etc/hosts" }],
  ["tool-failed", { toolError: ERROR }],
  ["tool-failed", { toolError: "Exit code 1" }],
  ["tool-failed", { toolError: null }],
  ["turn-end", { finalText: "Done." }],
  ["session-start", { source: "clear" }],
  ["prompt", { prompt: PROMPTS[0] as string }],
  ["file-read", { toolFile: "app/src/queue/lease.ts" }],
  ["tool-failed", { toolError: ERROR }],
  ["session-start", { source: "resume" }],
  ["session-start", { source: "compact" }],
  ["session-end", {}],
];

function run(f: Fixture, adapter: AgentAdapter, dialect?: string): string[] {
  let clock = NOW;
  const deps = { db: f.db, now: () => (clock += 1000), spawnDistill: () => {} };
  return STEPS.map(([event, extra]) => {
    const toolFile =
      extra.toolFile === undefined || extra.toolFile === null || extra.toolFile.startsWith("/")
        ? (extra.toolFile ?? null)
        : join(f.base, extra.toolFile);
    const input: HookInput = {
      agent: adapter.id as AgentId,
      event,
      sessionId: "snap-1",
      cwd: join(f.base, "app"),
      turnId: null,
      transcriptPath: null,
      prompt: null,
      finalText: null,
      source: null,
      toolError: null,
      subagent: false,
      ...extra,
      toolFile,
      ...(dialect === undefined ? {} : { dialect }),
    };
    return `${event}: ${handleHook(deps, adapter, input)}`;
  });
}

/** What was recorded as shown, in order: the bookkeeping must not change either. */
function injections(f: Fixture): string[] {
  return f.db
    .query<{ row: string }, []>(
      `SELECT context_epoch || ' ' || event || ' #' || memory_id AS row
         FROM injections ORDER BY rowid`,
    )
    .all()
    .map(({ row }) => row);
}

const CASES: [string, AgentAdapter, string | undefined][] = [
  ...Object.values(ADAPTERS).map((adapter): [string, AgentAdapter, undefined] => [
    (adapter as AgentAdapter).id,
    adapter as AgentAdapter,
    undefined,
  ]),
  ["copilot-vscode", ADAPTERS.copilot as AgentAdapter, "vscode"],
];

for (const withLinks of [false, true]) {
  describe(withLinks ? "with links and the author's rules" : "one project alone", () => {
    for (const [name, adapter, dialect] of CASES) {
      test(name, () => {
        fixture = seed(withLinks);
        const outputs = run(fixture, adapter, dialect);
        expect({ outputs, injections: injections(fixture) }).toMatchSnapshot();
      });
    }
  });
}
