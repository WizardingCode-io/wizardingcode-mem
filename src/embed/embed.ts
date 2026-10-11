/**
 * Text to vector: the mean of the rows of the text's tokens, scaled to unit length. What the
 * original model's `encode` does: it cuts the input to 512 x the vocabulary's median token length
 * characters before tokenising, keeps the first 512 tokens, and averages their rows.
 *
 * [UNK] is NOT dropped, although the task brief said to. The published tokenizer is Unigram, which
 * names its unknown by `unk_id`, and model2vec only strips an unknown it finds as `unk_token`, so
 * it strips nothing: the reference vectors include the [UNK] row (cosine 0.93 without it on the
 * item with a stray combining mark, 0.9999 with it).
 */
import type { Pack } from "./pack.ts";
import { tokenizeIndexes } from "./tokenize.ts";

const MAX_TOKENS = 512;
/** Median length, in characters, of the pieces in the model's tokenizer.json (500353 pieces). */
const MEDIAN_TOKEN_CHARS = 7;
const MAX_CHARS = MAX_TOKENS * MEDIAN_TOKEN_CHARS;

/** The first `max` code points (the original counts characters, not UTF-16 units). */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (let n = 0; n < max && end < text.length; n++) {
    const c = text.codePointAt(end)!;
    end += c > 0xffff ? 2 : 1;
  }
  return text.slice(0, end);
}

/** The text's unit vector, or null when it has no known token. Never throws. */
export function embed(pack: Pack, text: string): Float32Array | null {
  try {
    const unk = pack.find("[UNK]");
    const indexes = tokenizeIndexes(pack, clip(text, MAX_CHARS), MAX_TOKENS)
      .map((i) => (i < 0 ? unk : i))
      .filter((i) => i >= 0);
    if (indexes.length === 0) return null;
    const out = new Float32Array(pack.header.dims);
    for (const i of indexes) pack.addRow(i, out, 1 / indexes.length);
    let sum = 0;
    for (let d = 0; d < out.length; d++) sum += out[d]! * out[d]!;
    const norm = Math.sqrt(sum);
    if (!(norm > 0) || !Number.isFinite(norm)) return null;
    for (let d = 0; d < out.length; d++) out[d] = out[d]! / norm;
    return out;
  } catch {
    return null;
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** int8 storage for vectors kept in the database (part 2): one scale per vector. */
export function quantize(v: Float32Array): { scale: number; q: Int8Array } {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]!));
  const scale = max / 127;
  const q = new Int8Array(v.length);
  if (scale > 0) for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i]! / scale);
  return { scale, q };
}

export function dequantize(scale: number, q: Int8Array): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i]! * scale;
  return out;
}
