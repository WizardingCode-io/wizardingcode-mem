import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cosine, dequantize, embed, quantize } from "../../src/embed/embed.ts";
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
