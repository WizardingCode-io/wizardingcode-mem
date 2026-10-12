import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cachedCodePoints, normalize } from "../../src/embed/normalize.ts";
import { openPack } from "../../src/embed/pack.ts";
import { tokenize } from "../../src/embed/tokenize.ts";

const fixtures = join(import.meta.dir, "../fixtures/embed");
const opened = openPack(join(fixtures, "subset.wcpack"));
if (!opened.ok) throw new Error(`subset pack: ${opened.reason}`);
const pack = opened.pack;

interface Item {
  text: string;
  normalized: string;
  ids: number[];
}
const reference = JSON.parse(readFileSync(join(fixtures, "reference.json"), "utf8")) as {
  items: Item[];
};

describe("embed normaliser", () => {
  test("every reference item normalises as the published tokenizer does", () => {
    const wrong = reference.items.filter(
      (item) => normalize(item.text, pack.charsmap) !== item.normalized,
    );
    expect(wrong.map((item) => item.text)).toEqual([]);
  });

  test("the per-code-point cache stays bounded however many distinct characters pass through", () => {
    let text = "";
    for (let cp = 0x4e00; cp < 0x4e00 + 70_000; cp++) text += String.fromCodePoint(cp);
    normalize(text, pack.charsmap);
    expect(cachedCodePoints(pack.charsmap)).toBeLessThanOrEqual(65_536);
    expect(normalize("ｈｅｌｌｏ", pack.charsmap)).toBe("hello");
  });

  test("the charsmap folds compatibility characters", () => {
    // Full-width letters and the "fi" ligature are NFKC-folded by the charsmap.
    expect(normalize("ＡＢＣ ﬁle", pack.charsmap)).toBe("ABC file");
  });

  test("a short grapheme takes the first key that prefixes it, trailing marks and all", () => {
    // Full-width E + combining acute: the key for "Ｅ" replaces the whole grapheme.
    expect(normalize("Ｅ\u0301", pack.charsmap)).toBe("E");
    expect(normalize("\ufb01\u0301", pack.charsmap)).toBe("fi");
    // NBSP + combining acute: NBSP's key (a space) stands for both, then the space is stripped.
    expect(normalize("x\u00a0\u0301y", pack.charsmap)).toBe("x y");
  });
});

describe("embed tokenizer", () => {
  test("every reference item gives the reference ids, untruncated", () => {
    const wrong = reference.items.filter(
      (item) =>
        JSON.stringify(tokenize(pack, item.text, Number.POSITIVE_INFINITY)) !==
        JSON.stringify(item.ids),
    );
    expect(wrong.map((item) => item.text)).toEqual([]);
  });

  test("the default cap is 512 ids, the first 512 of the whole", () => {
    const long = reference.items.find((item) => item.ids.length > 512);
    expect(long).toBeDefined();
    expect(tokenize(pack, long!.text)).toEqual(long!.ids.slice(0, 512));
  });

  test("the empty string and whitespace give no ids", () => {
    expect(tokenize(pack, "")).toEqual([]);
    expect(tokenize(pack, "  \n\t ")).toEqual([]);
  });

  test("a string of only emoji gives ids without throwing", () => {
    const ids = tokenize(pack, "😀🎉🔥👍🏽");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(Number.isInteger(id)).toBe(true);
  });

  test("consecutive unknown characters fuse into one [UNK]", () => {
    // Characters absent from the subset pack: one [UNK] after the leading "▁" piece, not three.
    const ids = tokenize(pack, "\u{1D11E}\u{1D11F}\u{1D120}");
    expect(ids.filter((id) => id === pack.header.unkId).length).toBe(1);
  });

  test("a 50,000-character paste tokenizes in under 200 ms, at most 512 ids", () => {
    const words = reference.items.map((item) => item.text).join(" ");
    let paste = "";
    while (paste.length < 50_000) paste += `${words} `;
    paste = paste.slice(0, 50_000);
    tokenize(pack, paste.slice(0, 2000)); // warm up
    const start = performance.now();
    const ids = tokenize(pack, paste);
    const elapsed = performance.now() - start;
    expect(ids.length).toBeLessThanOrEqual(512);
    expect(ids.length).toBe(512);
    expect(elapsed).toBeLessThan(200);
  });

  test("a 50,000-character run with no spaces stays fast", () => {
    const run = "a".repeat(50_000);
    const start = performance.now();
    const ids = tokenize(pack, run);
    expect(ids.length).toBeLessThanOrEqual(512);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
