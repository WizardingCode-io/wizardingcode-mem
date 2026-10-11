import { describe, expect, test } from "bun:test";
import type { HistoryStatus } from "../../src/history/status.ts";
import { formatStatus, statusReport } from "../../src/status/report.ts";

const history: HistoryStatus = {
  transcripts: { claudeCode: 12, codex: 3 },
  run: { state: "done", startedAt: 1, finishedAt: 2, last: null },
  queue: { pending: 4, done: 20, skipped: 5, failed: 1 },
  index: { exists: true, files: 15, turns: 300, bytes: 2_097_152 },
  replace: { projectsReady: 2, wouldArchive: 17, replaced: 0 },
  offer: { dismissed: false },
};

describe("formatStatus: History block", () => {
  test("prints transcripts, queue, index and what would be replaced", () => {
    const text = formatStatus({ ...statusReport(null, null, "/d"), history });
    expect(text).toContain("History");
    expect(text).toContain("12 Claude Code");
    expect(text).toContain("3 Codex");
    expect(text).toContain("4 queued");
    expect(text).toContain("20 distilled");
    expect(text).toContain("300 turns");
    expect(text).toContain("2.0 MB");
    expect(text).toContain("17 imported memories ready to replace");
  });

  test("is absent without history data", () => {
    expect(formatStatus(statusReport(null, null, "/d"))).not.toContain("History");
  });
});

test("History block stays out of the way when there is nothing", () => {
  const quiet: HistoryStatus = {
    transcripts: { claudeCode: 0, codex: 0 },
    run: { state: "never", startedAt: null, finishedAt: null, last: null },
    queue: { pending: 0, done: 0, skipped: 0, failed: 0 },
    index: { exists: false, files: 0, turns: 0, bytes: 0 },
    replace: { projectsReady: 0, wouldArchive: 0, replaced: 0 },
    offer: { dismissed: false },
  };
  expect(formatStatus({ ...statusReport(null, null, "/d"), history: quiet })).not.toContain(
    "History",
  );
});
