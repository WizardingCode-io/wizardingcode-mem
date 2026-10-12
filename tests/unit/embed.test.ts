import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cosine,
  dequantize,
  embed,
  quantize,
  resetFailureLogForTests,
} from "../../src/embed/embed.ts";
import { openPack } from "../../src/embed/pack.ts";

const fixtures = join(import.meta.dir, "../fixtures/embed");
const opened = openPack(join(fixtures, "subset.wcpack"));
if (!opened.ok) throw new Error(`subset pack: ${opened.reason}`);
const pack = opened.pack;

interface Item {
  text: string;
  vector: number[];
}
const items = (
  JSON.parse(readFileSync(join(fixtures, "reference.json"), "utf8")) as { items: Item[] }
).items;
const isZero = (item: Item): boolean => item.vector.every((x) => x === 0);

describe("embed", () => {
  test("every non-zero reference vector is matched at cosine >= 0.99", () => {
    const scored: Array<{ text: string; cos: number }> = [];
    for (const item of items.filter((i) => !isZero(i))) {
      const v = embed(pack, item.text);
      scored.push({
        text: item.text.slice(0, 40),
        cos: v ? cosine(v, Float32Array.from(item.vector)) : -1,
      });
    }
    scored.sort((a, b) => a.cos - b.cos);
    if (process.env.EMBED_REPORT) console.log(scored.slice(0, 5));
    expect(scored.filter((s) => s.cos < 0.99)).toEqual([]);
  });

  test("items whose reference is all zeros give null", () => {
    const zeros = items.filter(isZero);
    expect(zeros.length).toBeGreaterThan(0);
    for (const item of zeros) expect(embed(pack, item.text)).toBeNull();
  });

  test("a text whose every token is unknown gives null, so unrelated ones never tie at 1.0", () => {
    for (const text of ["😀😀😀", "😀 😀", "\u0000"]) expect(embed(pack, text)).toBeNull();
  });

  test("a mixed text keeps its [UNK] rows and still matches the reference", () => {
    const item = items.find((i) => i.text.startsWith("Ｅ"))!;
    expect(cosine(embed(pack, item.text)!, Float32Array.from(item.vector))).toBeGreaterThanOrEqual(
      0.99,
    );
  });

  test("the result is a unit vector", () => {
    const v = embed(pack, "the memory of a deployment")!;
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  test("never throws on awkward input", () => {
    for (const text of [
      "😀😀😀",
      "你好世界，今天天气很好",
      "word ".repeat(10_000),
      "!!!???...",
      "\u0000\ud800",
    ]) {
      expect(() => embed(pack, text)).not.toThrow();
    }
  });
});

describe("quantize", () => {
  test("round-trips every reference vector at cosine >= 0.999", () => {
    for (const item of items.filter((i) => !isZero(i))) {
      const v = Float32Array.from(item.vector);
      const { scale, q } = quantize(v);
      expect(cosine(dequantize(scale, q), v)).toBeGreaterThanOrEqual(0.999);
    }
  });

  test("a zero vector quantizes to zeros", () => {
    const { scale, q } = quantize(new Float32Array(4));
    expect(scale).toBe(0);
    expect(Array.from(dequantize(scale, q))).toEqual([0, 0, 0, 0]);
  });
});

describe("guards", () => {
  test("cosine of vectors of different lengths, or with a zero norm, is 0", () => {
    expect(cosine(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
    expect(cosine(new Float32Array(3), new Float32Array([1, 2, 3]))).toBe(0);
  });

  test("quantize of a non-finite vector gives scale 0 and zeros", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const { scale, q } = quantize(Float32Array.from([1, bad, 2]));
      expect(scale).toBe(0);
      expect(Array.from(q)).toEqual([0, 0, 0]);
    }
  });

  test("embed still returns null when the pack throws, and logs the first failure once", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "wcmem-embed-log-"));
    const saved = process.env.WIZARDINGCODE_MEM_DATA_DIR;
    process.env.WIZARDINGCODE_MEM_DATA_DIR = dataDir;
    resetFailureLogForTests();
    try {
      const broken = {
        ...pack,
        find() {
          throw new Error("boom");
        },
      } as unknown as typeof pack;
      expect(embed(broken, "hello world")).toBeNull();
      expect(embed(broken, "hello again")).toBeNull();
      const log = readFileSync(join(dataDir, "logs", "wizardingcode-mem.log"), "utf8");
      expect(log.trim().split("\n")).toHaveLength(1);
      expect(log).toContain("embed");
      expect(log).toContain("boom");
    } finally {
      if (saved === undefined) delete process.env.WIZARDINGCODE_MEM_DATA_DIR;
      else process.env.WIZARDINGCODE_MEM_DATA_DIR = saved;
    }
  });
});
