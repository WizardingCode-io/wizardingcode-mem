import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPack, writePack } from "../../src/embed/pack.ts";

const dir = mkdtempSync(join(tmpdir(), "wcmem-pack-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const DIMS = 8;
const base = {
  model: "m",
  revision: "r",
  dims: DIMS,
  vocabSize: 100,
  unkId: 1,
  minScore: -20,
  maxPieceChars: 6,
};

function row(seed: number): Float32Array {
  const r = new Float32Array(DIMS);
  for (let i = 0; i < DIMS; i++) r[i] = Math.sin(seed * 7.1 + i) * (1 + (seed % 5));
  return r;
}

function make(
  name: string,
  pieces: { text: string; id: number; score: number; row: Float32Array }[],
) {
  const path = join(dir, name);
  writePack(path, { header: base, charsmap: new Uint8Array([1, 2, 3, 4, 5]), pieces });
  return path;
}

describe("embed pack", () => {
  const pieces = [
    { text: "▁hello", id: 10, score: -3.5, row: row(1) },
    { text: "wörld", id: 11, score: -7.25, row: row(2) },
    { text: "日本", id: 12, score: -1, row: row(3) },
    { text: "zero", id: 13, score: -2, row: new Float32Array(DIMS) },
  ];
  const path = make("t.wcpack", pieces);

  test("round trip", () => {
    const r = openPack(path);
    if (!r.ok) throw new Error(r.reason);
    const p = r.pack;
    expect(p.header.count).toBe(4);
    expect(p.header.format).toBe("wcmem-embed-v1");
    expect(p.header.minScore).toBe(-20);
    expect(p.header.tableSize).toBeGreaterThanOrEqual(8);
    expect(Array.from(p.charsmap)).toEqual([1, 2, 3, 4, 5]);
    for (const piece of pieces) {
      const i = p.find(piece.text);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(p.idOf(i)).toBe(piece.id);
      expect(p.score(i)).toBe(Math.fround(piece.score));
      const out = new Float32Array(DIMS);
      p.addRow(i, out);
      const scale = Math.max(...Array.from(piece.row, Math.abs)) / 127;
      for (let k = 0; k < DIMS; k++)
        expect(Math.abs(out[k]! - piece.row[k]!)).toBeLessThanOrEqual(scale / 2 + 1e-6);
    }
    p.close();
  });

  test("weight multiplies and accumulates", () => {
    const r = openPack(path);
    if (!r.ok) throw new Error(r.reason);
    const i = r.pack.find("▁hello");
    const a = new Float32Array(DIMS);
    r.pack.addRow(i, a);
    const b = new Float32Array(DIMS);
    r.pack.addRow(i, b, 2);
    r.pack.addRow(i, b, 1);
    for (let k = 0; k < DIMS; k++) expect(b[k]!).toBeCloseTo(a[k]! * 3, 5);
  });

  test("missing piece is -1; zero row adds nothing", () => {
    const r = openPack(path);
    if (!r.ok) throw new Error(r.reason);
    expect(r.pack.find("nope")).toBe(-1);
    expect(r.pack.find("")).toBe(-1);
    const out = new Float32Array(DIMS);
    r.pack.addRow(r.pack.find("zero"), out);
    expect(Array.from(out)).toEqual(new Array(DIMS).fill(0));
  });

  test("prefixes visits every piece that starts at a byte offset, shortest first", () => {
    const p2 = make("prefixes.wcpack", [
      { text: "▁日", id: 20, score: -1, row: row(4) },
      { text: "▁日本", id: 21, score: -1, row: row(5) },
      { text: "▁日本語x", id: 22, score: -1, row: row(6) },
      { text: "本", id: 23, score: -1, row: row(7) },
    ]);
    const r = openPack(p2);
    if (!r.ok) throw new Error(r.reason);
    const bytes = new TextEncoder().encode("a▁日本語x");
    const seen = (start: number, end: number, maxChars: number) => {
      const out: [number, number][] = [];
      r.pack.prefixes(bytes, start, end, maxChars, (stop, index) =>
        out.push([stop, r.pack.idOf(index)]),
      );
      return out;
    };
    // "a" is 1 byte, "▁" 3, each kanji 3.
    expect(seen(1, bytes.length, 10)).toEqual([
      [7, 20],
      [10, 21],
      [14, 22],
    ]);
    expect(seen(1, bytes.length, 3)).toEqual([
      [7, 20],
      [10, 21],
    ]);
    expect(seen(1, 10, 10)).toEqual([
      [7, 20],
      [10, 21],
    ]);
    expect(seen(7, bytes.length, 10)).toEqual([[10, 23]]);
    expect(seen(0, bytes.length, 10)).toEqual([]);
  });

  test("bad files fail with a reason, never throw", () => {
    const bytes = readFileSync(path);
    const cut = join(dir, "cut.wcpack");
    writeFileSync(cut, bytes);
    truncateSync(cut, bytes.length - 1);
    const magic = join(dir, "magic.wcpack");
    const m = Buffer.from(bytes);
    m[0] = 0x58;
    writeFileSync(magic, m);
    const empty = join(dir, "empty.wcpack");
    writeFileSync(empty, "");
    // same-length header with another format
    const other = join(dir, "other.wcpack");
    const o = Buffer.from(bytes);
    const at = o.indexOf("wcmem-embed-v1");
    o.write("wcmem-embed-v9", at);
    writeFileSync(other, o);
    for (const p of [cut, magic, empty, other, dir, join(dir, "missing.wcpack")]) {
      const r = openPack(p);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  test("10,000 pieces with colliding prefixes are all found", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      text: `▁prefix${i}`,
      id: i + 5,
      score: -i / 100,
      row: row(i),
    }));
    const p2 = make("many.wcpack", many);
    const r = openPack(p2);
    if (!r.ok) throw new Error(r.reason);
    expect(r.pack.header.tableSize).toBeGreaterThanOrEqual(20_000);
    expect(r.pack.header.tableSize & (r.pack.header.tableSize - 1)).toBe(0);
    for (let i = 0; i < many.length; i++) {
      const idx = r.pack.find(many[i]!.text);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(r.pack.idOf(idx)).toBe(i + 5);
    }
    expect(r.pack.find("▁prefix10000")).toBe(-1);
  });
});
