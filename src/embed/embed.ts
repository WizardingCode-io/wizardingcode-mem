/**
 * Text to vector: the mean of the rows of the text's tokens, scaled to unit length. What the
 * original model's `encode` does: it cuts the input to 512 x the vocabulary's median token length
 * characters before tokenising, keeps the first 512 tokens, and averages their rows.
 *
 * [UNK] is kept, not dropped: the published tokenizer is Unigram, which names its unknown by
 * `unk_id`, and model2vec only strips an unknown it finds as `unk_token`, so it strips nothing and
 * the reference vectors include the [UNK] row (cosine 0.93 without it on the item with a stray
 * combining mark, 0.9999 with it). A text with no known token at all is still null.
 */
import { logError } from "../util/log.ts";
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

let failureLogged = false;

/**
 * The text's unit vector, or null when it has no known token. Never throws; an unexpected
 * failure also gives null, and the first one in a process is written to the error log.
 */
export function embed(pack: Pack, text: string): Float32Array | null {
  try {
    const unk = pack.find("[UNK]");
    const found = tokenizeIndexes(pack, clip(text, MAX_CHARS), MAX_TOKENS);
    // Only unknowns would give every such text the same vector (cosine 1.0 between strangers).
    // The bare word-start mark "▁" is in the vocabulary but says nothing, so it does not count.
    const mark = pack.find("▁");
    if (!found.some((i) => i >= 0 && i !== mark)) return null;
    const indexes = found.map((i) => (i < 0 ? unk : i)).filter((i) => i >= 0);
    const out = new Float32Array(pack.header.dims);
    for (const i of indexes) pack.addRow(i, out, 1 / indexes.length);
    let sum = 0;
    for (let d = 0; d < out.length; d++) sum += out[d]! * out[d]!;
    const norm = Math.sqrt(sum);
    if (!(norm > 0) || !Number.isFinite(norm)) return null;
    for (let d = 0; d < out.length; d++) out[d] = out[d]! / norm;
    return out;
  } catch (error) {
    if (!failureLogged) {
      failureLogged = true;
      logError("embed", error);
    }
    return null;
  }
}

/** Cosine similarity; 0 for vectors of different lengths or with a zero norm. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
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
  const q = new Int8Array(v.length);
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]!));
  // A NaN or infinity would poison the scale: store nothing rather than garbage.
  if (!Number.isFinite(max) || v.some((x) => Number.isNaN(x))) return { scale: 0, q };
  const scale = max / 127;
  if (scale > 0) for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i]! / scale);
  return { scale, q };
}

export function dequantize(scale: number, q: Int8Array): Float32Array {
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i]! * scale;
  return out;
}
