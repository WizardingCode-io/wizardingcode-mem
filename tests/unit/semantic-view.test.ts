import { describe, expect, test } from "bun:test";
import {
  downloadPercent,
  modelLine,
  modelPill,
  type SemanticStatus,
  semanticBusy,
  vectorsLine,
  vectorsPercent,
  vectorsPill,
} from "../../ui/src/semantic.ts";

const MB = 1024 * 1024;
const status = (
  over: {
    model?: Partial<SemanticStatus["model"]>;
    download?: Partial<SemanticStatus["download"]>;
    backfill?: Partial<SemanticStatus["backfill"]>;
    memories?: Partial<SemanticStatus["memories"]>;
  } = {},
): SemanticStatus => ({
  model: {
    present: false,
    bytes: 0,
    expectedBytes: 140 * MB,
    enabled: true,
    source: "default",
    problem: null,
    ...over.model,
  },
  download: { running: false, done: 0, total: 0, error: null, ...over.download },
  backfill: { running: false, ...over.backfill },
  memories: { active: 1200, withVectors: 0, ...over.memories },
  offer: { dismissed: false },
});

describe("the model row", () => {
  test("not downloaded: the size to expect, a neutral pill", () => {
    const s = status();
    expect(modelPill(s)).toMatchObject({ label: "Not downloaded" });
    expect(modelLine(s)).toBe("140 MB · downloaded once, then used offline");
  });

  test("downloading: the bytes so far and the percentage", () => {
    const s = status({ download: { running: true, done: 70 * MB, total: 140 * MB } });
    expect(modelPill(s)).toMatchObject({ label: "Downloading" });
    expect(downloadPercent(s)).toBe(50);
    expect(modelLine(s)).toBe("70.0 of 140.0 MB");
    expect(downloadPercent(status({ download: { running: true } }))).toBe(0);
  });

  test("ready, turned off, failed and unreadable", () => {
    expect(modelPill(status({ model: { present: true, bytes: 140 * MB } }))).toMatchObject({
      label: "Ready",
    });
    expect(modelLine(status({ model: { present: true, bytes: 140 * MB } }))).toBe(
      "140 MB · on this machine",
    );
    expect(modelPill(status({ model: { present: true, enabled: false } }))).toMatchObject({
      label: "Off",
    });
    const failed = status({ download: { error: "download failed: offline" } });
    expect(modelPill(failed)).toMatchObject({ label: "Failed", shape: "square" });
    expect(modelLine(failed)).toBe("Download failed: offline");
    const bad = status({ model: { present: true, problem: "bad magic" } });
    expect(modelPill(bad)).toMatchObject({ label: "Unreadable" });
    expect(modelLine(bad)).toContain("bad magic");
  });
});

describe("the memories row", () => {
  test("counts the memories with a vector of the active ones", () => {
    const s = status({ model: { present: true }, memories: { active: 1200, withVectors: 300 } });
    expect(vectorsLine(s)).toBe("300 of 1,200 active memories");
    expect(vectorsPercent(s)).toBe(25);
    expect(vectorsPill(s)).toMatchObject({ label: "Partial" });
    expect(
      vectorsPill(status({ model: { present: true }, backfill: { running: true } })),
    ).toMatchObject({ label: "Backfilling" });
    expect(
      vectorsPill(status({ model: { present: true }, memories: { active: 3, withVectors: 3 } })),
    ).toMatchObject({ label: "Complete" });
    expect(vectorsPill(status())).toBeNull();
    expect(vectorsPill(status({ model: { present: true, enabled: false } }))).toBeNull();
    expect(vectorsPercent(status({ memories: { active: 0, withVectors: 0 } }))).toBe(100);
  });
});

describe("polling", () => {
  test("while a download or a backfill runs, and briefly after asking for one", () => {
    expect(semanticBusy(status(), null, 0)).toBe(false);
    expect(semanticBusy(status({ download: { running: true } }), null, 0)).toBe(true);
    expect(semanticBusy(status({ backfill: { running: true } }), null, 0)).toBe(true);
    expect(semanticBusy(status(), 1000, 5000)).toBe(true);
    expect(semanticBusy(status(), 1000, 1000 + 16_000)).toBe(false);
  });
});
