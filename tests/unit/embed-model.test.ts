import { afterAll, describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { embed } from "../../src/embed/embed.ts";
import { loadModel, MODEL_FILE, modelPath, modelState } from "../../src/embed/model.ts";
import { openPack, writePack } from "../../src/embed/pack.ts";

const fixture = join(import.meta.dir, "../fixtures/embed/subset.wcpack");
const roots: string[] = [];
function dataDir(withModel: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "wcmem-model-"));
  roots.push(dir);
  if (withModel) {
    mkdirSync(join(dir, "models"));
    copyFileSync(fixture, modelPath(dir));
  }
  return dir;
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("model", () => {
  test("the path is <dataDir>/models/<file>", () => {
    expect(modelPath("/d")).toBe(join("/d", "models", MODEL_FILE));
  });

  test("absent file: null and not present", () => {
    const dir = dataDir(false);
    expect(loadModel({ dataDir: dir, env: {} })).toBeNull();
    expect(modelState(dir)).toMatchObject({ present: false, bytes: 0, enabled: true });
  });

  test("switched off: null even with the file there", () => {
    const dir = dataDir(true);
    expect(loadModel({ dataDir: dir, env: { WIZARDINGCODE_MEM_SEMANTIC: "off" } })).toBeNull();
    expect(loadModel({ dataDir: dir, env: {} })).not.toBeNull();
  });

  test("the settings file switches it off too (the environment wins)", () => {
    const dir = dataDir(true);
    writeFileSync(join(dir, "env"), "WIZARDINGCODE_MEM_SEMANTIC=off\n");
    expect(loadModel({ dataDir: dir, env: {} })).toBeNull();
    expect(loadModel({ dataDir: dir, env: { WIZARDINGCODE_MEM_SEMANTIC: "on" } })).not.toBeNull();
    expect(modelState(dir).enabled).toBe(false);
  });

  test("a valid pack: embed matches embed(pack, ...), id carries a sha prefix, cached", () => {
    const dir = dataDir(true);
    const model = loadModel({ dataDir: dir, env: {} });
    if (!model) throw new Error("no model");
    const direct = openPack(fixture);
    if (!direct.ok) throw new Error(direct.reason);
    expect(model.embed("hello world")).toEqual(embed(direct.pack, "hello world"));
    expect(model.id).toMatch(/^potion-multilingual-128M@[0-9a-f]{12,}$/);
    expect(loadModel({ dataDir: dir, env: {} })).toBe(model);
    expect(modelState(dir)).toMatchObject({ present: true, enabled: true, reason: null });
  });

  test("replaced by rename: the next load answers from the new file; the old model still works", () => {
    const dir = dataDir(true);
    const old = loadModel({ dataDir: dir, env: {} });
    if (!old) throw new Error("no model");
    const before = old.embed("hello world");
    const next = join(dir, "models", "next.tmp");
    const row = (s: number) => Float32Array.from({ length: 4 }, (_, i) => Math.sin(s + i));
    writePack(next, {
      header: {
        model: "other",
        revision: "x",
        dims: 4,
        vocabSize: 10,
        unkId: 0,
        minScore: -10,
        maxPieceChars: 5,
      },
      charsmap: new Uint8Array(0),
      pieces: [
        { text: "▁hello", id: 1, score: -1, row: row(1) },
        { text: "▁world", id: 2, score: -1, row: row(2) },
        { text: "[UNK]", id: 0, score: -5, row: row(3) },
      ],
    });
    renameSync(next, modelPath(dir));
    const fresh = loadModel({ dataDir: dir, env: {} });
    if (!fresh) throw new Error("no fresh model");
    expect(fresh).not.toBe(old);
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.pack.header.dims).toBe(4);
    expect(old.embed("hello world")).toEqual(before);
  });

  test("a truncated file: null with a reason; a missing file after a good load: null", () => {
    const dir = dataDir(true);
    expect(loadModel({ dataDir: dir, env: {} })).not.toBeNull();
    rmSync(modelPath(dir));
    expect(loadModel({ dataDir: dir, env: {} })).toBeNull();
    copyFileSync(fixture, modelPath(dir));
    truncateSync(modelPath(dir), 100);
    expect(loadModel({ dataDir: dir, env: {} })).toBeNull();
    const state = modelState(dir);
    expect(state.present).toBe(true);
    expect(state.bytes).toBe(100);
    expect(state.reason).toBeTruthy();
  });
});
