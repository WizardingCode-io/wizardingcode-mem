/**
 * The model's normaliser, reproduced from the behaviour its published tokenizer describes:
 * SentencePiece's precompiled character map (a double-array trie over UTF-8 bytes plus a blob of
 * replacement strings), then whitespace and punctuation spacing. Written from that description,
 * not from any library's source.
 */

/** A decoded charsmap: the trie units and the replacement-string blob. */
interface Charsmap {
  units: Uint32Array;
  strings: Uint8Array;
  /** Per code point (as a string key), its replacement or null; filled lazily. */
  cache: Map<string, string | null>;
}

const decoded = new WeakMap<Uint8Array, Charsmap>();
const encoder = new TextEncoder();
const utf8 = new TextDecoder();

function decode(blob: Uint8Array): Charsmap {
  const known = decoded.get(blob);
  if (known) return known;
  let units = new Uint32Array(0);
  let strings: Uint8Array = new Uint8Array(0);
  if (blob.length >= 4) {
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const size = Math.min(view.getUint32(0, true), blob.length - 4) & ~3;
    // Copy the units so the array is aligned whatever the blob's offset.
    units = new Uint32Array(size / 4);
    for (let i = 0; i < units.length; i++) units[i] = view.getUint32(4 + i * 4, true);
    strings = blob.subarray(4 + size);
  }
  const map: Charsmap = { units, strings, cache: new Map() };
  decoded.set(blob, map);
  return map;
}

// Double-array unit fields.
const hasLeaf = (u: number): number => (u >>> 8) & 1;
const value = (u: number): number => u & 0x7fffffff;
const label = (u: number): number => u & 0x800000ff;
const offset = (u: number): number => (u >>> 10) << ((u & 0x200) >>> 6);

/**
 * The replacement for the first (shortest) key that is a prefix of `bytes`, or null. As in the
 * published tokenizer, the replacement stands for ALL of `bytes` even when the key is shorter:
 * a grapheme whose base character has a key loses its trailing marks. Keys are whole UTF-8
 * sequences, so for a single code point this is an exact match.
 */
function lookup(map: Charsmap, bytes: Uint8Array): string | null {
  const { units, strings } = map;
  if (units.length === 0) return null;
  let pos = offset(units[0]!);
  let found = -1;
  for (let i = 0; i < bytes.length && found < 0; i++) {
    const b = bytes[i]!;
    pos ^= b;
    if (pos >= units.length) return null;
    const u = units[pos]!;
    if (label(u) !== b) return null;
    pos ^= offset(u);
    if (hasLeaf(u)) found = value(units[pos]!);
  }
  if (found < 0 || found >= strings.length) return null;
  let end = found;
  while (end < strings.length && strings[end] !== 0) end++;
  return utf8.decode(strings.subarray(found, end));
}

function mapCodePoint(map: Charsmap, cp: string): string {
  let out = map.cache.get(cp);
  if (out === undefined) {
    out = lookup(map, encoder.encode(cp));
    map.cache.set(cp, out);
  }
  return out ?? cp;
}

let segmenter: Intl.Segmenter | undefined;

/** Applies the precompiled charsmap, grapheme by grapheme. */
function applyCharsmap(text: string, map: Charsmap): string {
  let out = "";
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of segmenter.segment(text)) {
    if (segment.length === 1 || (segment.length === 2 && segment.codePointAt(0)! > 0xffff)) {
      out += mapCodePoint(map, segment);
      continue;
    }
    const bytes = encoder.encode(segment);
    if (bytes.length < 6) {
      const whole = lookup(map, bytes);
      if (whole !== null) {
        out += whole;
        continue;
      }
    }
    for (const cp of segment) out += mapCodePoint(map, cp);
  }
  return out;
}

// Unicode White_Space, the set the published normaliser's `\s` and strip use.
const WS =
  "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SPACES = / {2,}/g;
const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g;
const WHITESPACE = new RegExp(`[${WS}]+`, "g");
const EDGES = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");

export function normalize(text: string, charsmap: Uint8Array): string {
  const mapped = applyCharsmap(text, decode(charsmap));
  return mapped
    .replace(SPACES, " ")
    .replace(PUNCT, " $& ")
    .replace(WHITESPACE, " ")
    .replace(EDGES, "");
}
