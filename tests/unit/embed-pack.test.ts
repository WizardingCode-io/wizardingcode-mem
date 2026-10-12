import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
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

  test("a pack replaced by rename keeps answering from the content it mapped", () => {
    const live = make("live.wcpack", pieces);
    const r = openPack(live);
    if (!r.ok) throw new Error(r.reason);
    const other = make("other-content.wcpack", [{ text: "▁else", id: 99, score: -1, row: row(9) }]);
    renameSync(other, live);
    expect(r.pack.find("▁hello")).toBeGreaterThanOrEqual(0);
    expect(r.pack.find("▁else")).toBe(-1);
    const out = new Float32Array(DIMS);
    r.pack.addRow(r.pack.find("日本"), out);
    expect(out.some((x) => x !== 0)).toBe(true);
    const fresh = openPack(live);
    expect(fresh.ok && fresh.pack.find("▁else")).toBeGreaterThanOrEqual(0);
  });

  test("writePack leaves no temporary file behind and replaces an existing pack", () => {
    const path2 = join(dir, "twice.wcpack");
    writePack(path2, { header: base, charsmap: new Uint8Array(0), pieces: pieces.slice(0, 1) });
    writePack(path2, { header: base, charsmap: new Uint8Array(0), pieces });
    const r = openPack(path2);
    expect(r.ok && r.pack.header.count).toBe(4);
    expect(() => readFileSync(`${path2}.tmp`)).toThrow();
  });

  test("nothing the pack exposes can change the file on disk", () => {
    const path2 = make("immutable.wcpack", pieces);
    const before = readFileSync(path2);
    const r = openPack(path2);
    if (!r.ok) throw new Error(r.reason);
    r.pack.charsmap.fill(0xff);
    r.pack.header.dims = 1;
    expect(readFileSync(path2).equals(before)).toBe(true);
    expect(Array.from(openPack(path2).ok ? (openPack(path2) as any).pack.charsmap : [])).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  test("a write through a private mapping never reaches the file", () => {
    const path2 = make("private.wcpack", pieces);
    const before = readFileSync(path2);
    const bytes = Bun.mmap(path2, { shared: false }) as Uint8Array;
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    expect(readFileSync(path2).equals(before)).toBe(true);
  });

  test("a header that is JSON null, or not an object, is refused without throwing", () => {
    for (const json of ["null", "7", '"x"']) {
      const body = new TextEncoder().encode(json.padEnd(8));
      const bytes = new Uint8Array(8 + 4 + body.length);
      bytes.set(new TextEncoder().encode("WCMEMEMB"));
      new DataView(bytes.buffer).setUint32(8, body.length, true);
      bytes.set(body, 12);
      const path2 = join(dir, `hdr-${json.length}-${json[0]}.wcpack`);
      writeFileSync(path2, bytes);
      const r = openPack(path2);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("bad header");
    }
  });

  test("writePack's temporary file is unique and removed when the rename fails", () => {
    const target = join(dir, "is-a-dir.wcpack");
    mkdirSync(target);
    expect(() =>
      writePack(target, { header: base, charsmap: new Uint8Array(0), pieces }),
    ).toThrow();
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("without a mapping the whole file is read into memory and answers the same", () => {
    const failing = () => {
      throw new Error("no mmap here");
    };
    for (const mmap of [failing, () => undefined as unknown as Uint8Array]) {
      const r = openPack(path, { mmap });
      if (!r.ok) throw new Error(r.reason);
      expect(r.pack.header.count).toBe(4);
      expect(Array.from(r.pack.charsmap)).toEqual([1, 2, 3, 4, 5]);
      const i = r.pack.find("wörld");
      expect(r.pack.idOf(i)).toBe(11);
      const out = new Float32Array(DIMS);
      r.pack.addRow(i, out);
      expect(out.some((x) => x !== 0)).toBe(true);
    }
    expect(openPack(join(dir, "missing.wcpack"), { mmap: failing }).ok).toBe(false);
  });

  describe("header validation", () => {
    const good = readFileSync(path);
    /** The same file with its header JSON edited by `edit`, everything after it untouched. */
    const lying = (name: string, edit: (json: string) => string): string => {
      const hlen = good.readUInt32LE(8);
      const json = edit(good.subarray(12, 12 + hlen).toString("utf8"));
      const head = Buffer.concat([Buffer.from("WCMEMEMB"), Buffer.alloc(4), Buffer.from(json)]);
      head.writeUInt32LE(Buffer.byteLength(json), 8);
      const pad = Buffer.alloc((8 - (head.length % 8)) % 8);
      const rest = good.subarray(Math.ceil((12 + hlen) / 8) * 8);
      const file = join(dir, name);
      writeFileSync(file, Buffer.concat([head, pad, rest]));
      return file;
    };
    const rejected = (file: string): void => {
      const r = openPack(file);
      expect(r.ok).toBe(false);
    };

    test("a header lying about count or dims is refused", () => {
      for (const [k, v] of [
        ["count", 4_000_000_000],
        ["count", 5],
        ["count", -1],
        ["dims", 3_000_000_000],
        ["dims", 7],
        ["dims", 1.5],
      ] as const)
        rejected(
          lying(`lie-${k}-${v}.wcpack`, (j) => j.replace(new RegExp(`"${k}":\\d+`), `"${k}":${v}`)),
        );
    });

    test("non-finite or impossible numbers are refused", () => {
      rejected(
        lying("inf-chars.wcpack", (j) => j.replace(/"maxPieceChars":\d+/, '"maxPieceChars":1e999')),
      );
      rejected(
        lying("zero-chars.wcpack", (j) => j.replace(/"maxPieceChars":\d+/, '"maxPieceChars":0')),
      );
      rejected(
        lying("inf-score.wcpack", (j) => j.replace(/"minScore":-?\d+/, '"minScore":-1e999')),
      );
      rejected(lying("str-unk.wcpack", (j) => j.replace(/"unkId":\d+/, '"unkId":"1"')));
      rejected(lying("neg-vocab.wcpack", (j) => j.replace(/"vocabSize":\d+/, '"vocabSize":-3')));
    });

    test("a table smaller than twice the count is refused", () => {
      rejected(lying("small-table.wcpack", (j) => j.replace(/"tableSize":\d+/, '"tableSize":4')));
      rejected(lying("odd-table.wcpack", (j) => j.replace(/"tableSize":\d+/, '"tableSize":24')));
    });

    test("a file one byte too long is refused", () => {
      const long = join(dir, "long.wcpack");
      writeFileSync(long, good);
      appendFileSync(long, new Uint8Array([0]));
      rejected(long);
    });
  });

  test("the committed subset opens", () => {
    const r = openPack(join(import.meta.dir, "../fixtures/embed/subset.wcpack"));
    expect(r.ok).toBe(true);
  });
});
