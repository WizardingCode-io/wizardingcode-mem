/**
 * The model's Unigram tokenizer, reproduced from the behaviour its published tokenizer describes:
 * normalise, mark word starts with "▁" (one prepended, every space replaced), then pick the
 * segmentation with the highest total piece score (Viterbi), letting a character no piece covers
 * be an unknown that costs `minScore - 10`, and fusing consecutive unknowns into one [UNK].
 *
 * No piece of the vocabulary holds "▁" anywhere but first, so a token never crosses a word start:
 * the best segmentation of the whole string is the best segmentation of each word in turn. We
 * therefore run Viterbi word by word and stop at the first word that reaches `maxTokens`. The ids
 * returned are exactly the first `maxTokens` ids of the whole tokenisation.
 */
import { normalize } from "./normalize.ts";
import type { Pack } from "./pack.ts";

const METASPACE = "▁";
const UNK_PENALTY = 10;
const encoder = new TextEncoder();

export function tokenize(pack: Pack, text: string, maxTokens = 512): number[] {
  const { unkId } = pack.header;
  return tokenizeIndexes(pack, text, maxTokens).map((i) => (i < 0 ? unkId : pack.idOf(i)));
}

/** Same segmentation as `tokenize`, as pack indexes (what `addRow` takes); -1 is [UNK]. */
export function tokenizeIndexes(pack: Pack, text: string, maxTokens = 512): number[] {
  const ids: number[] = [];
  if (maxTokens <= 0) return ids;
  const normalized = normalize(text, pack.charsmap);
  if (normalized === "") return ids;
  const bytes = encoder.encode(METASPACE + normalized.replaceAll(" ", METASPACE));
  const { minScore, maxPieceChars } = pack.header;
  const unkScore = minScore - UNK_PENALTY;

  // Buffers sized for the longest word, reused across words.
  let best = new Float64Array(0);
  let from = new Int32Array(0);
  let piece = new Int32Array(0);
  let lastUnk = false;

  // The visitor is made once; it reads the position being expanded from these.
  let start = 0;
  let at = 0;
  let base = 0;
  let charEnd = 0;
  let single = false;
  const relax = (stop: number, index: number): void => {
    const j = stop - start;
    if (j === charEnd) single = true;
    const score = base + pack.score(index);
    // Strictly greater: on a tie the path found first stays.
    if (score > best[j]!) {
      best[j] = score;
      from[j] = at;
      piece[j] = index;
    }
  };

  while (start < bytes.length && ids.length < maxTokens) {
    // A word runs from one "▁" (E2 96 81) to the next.
    let end = start + 3;
    while (
      end < bytes.length &&
      !(bytes[end] === 0xe2 && bytes[end + 1] === 0x96 && bytes[end + 2] === 0x81)
    ) {
      end++;
    }
    const n = end - start;
    if (best.length < n + 1) {
      best = new Float64Array(n + 1);
      from = new Int32Array(n + 1);
      piece = new Int32Array(n + 1);
    }
    best.fill(Number.NEGATIVE_INFINITY, 0, n + 1);
    best[0] = 0;

    for (let i = 0; i < n; i++) {
      // Positions inside a code point are never reached; skip them.
      if (best[i] === Number.NEGATIVE_INFINITY) continue;
      at = i;
      base = best[i]!;
      charEnd = i + 1;
      while (charEnd < n && (bytes[start + charEnd]! & 0xc0) === 0x80) charEnd++;
      single = false;
      pack.prefixes(bytes, start + i, end, maxPieceChars, relax);
      if (!single) {
        const score = base + unkScore;
        if (score > best[charEnd]!) {
          best[charEnd] = score;
          from[charEnd] = i;
          piece[charEnd] = -1;
        }
      }
    }

    const path: number[] = [];
    for (let j = n; j > 0; j = from[j]!) path.push(piece[j]!);
    for (let k = path.length - 1; k >= 0; k--) {
      const index = path[k]!;
      if (index < 0) {
        if (!lastUnk) ids.push(-1);
        lastUnk = true;
      } else {
        ids.push(index);
        lastUnk = false;
      }
    }
    start = end;
  }
  return ids.length > maxTokens ? ids.slice(0, maxTokens) : ids;
}
