/**
 * The `wcmem-embed-v1` pack: one file holding a static-embedding model (pieces, scores, int8 rows
 * with a scale each) laid out so it can be memory-mapped and read in place. Nothing is parsed or
 * copied at open time; lookups go through a small open-addressing hash table.
 *
 * Layout (little-endian, every section starts 8-byte aligned, padded with zeros):
 *   magic "WCMEMEMB" | u32 len + header JSON | u32 len + charsmap | u32[count+1] piece offsets |
 *   strings blob (UTF-8) | u32[count] ids | f32[count] scores | u32[tableSize] slots (index+1, 0 empty) |
 *   f32[count] row scales | i8[count*dims] rows
 */
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";

export interface PackHeader {
  format: "wcmem-embed-v1";
  model: string;
  revision: string;
  dims: number;
  count: number;
  vocabSize: number;
  unkId: number;
  /** Lowest Unigram score of the FULL vocabulary. */
  minScore: number;
  /** Longest piece, in code points. */
  maxPieceChars: number;
  /** Hash slots: a power of two >= 2 x count. */
  tableSize: number;
}

export interface Pack {
  header: PackHeader;
  /** SentencePiece precompiled_charsmap bytes, as published (a copy: writing to it changes nothing). */
  charsmap: Uint8Array;
  /** Index of a piece (by its exact text, "▁" included), or -1. */
  find(piece: string): number;
  /**
   * Visits, shortest first, every piece equal to `bytes[start..stop)` for a code-point boundary
   * `stop <= end` at most `maxChars` code points past `start`. Hashes incrementally and allocates
   * nothing: the tokenizer's inner loop.
   */
  prefixes(
    bytes: Uint8Array,
    start: number,
    end: number,
    maxChars: number,
    visit: (stop: number, index: number) => void,
  ): void;
  /** The original vocabulary id. */
  idOf(index: number): number;
  score(index: number): number;
  /** Adds row x scale x weight into `into` (length dims). */
  addRow(index: number, into: Float32Array, weight?: number): void;
  /**
   * Drops our references. Bun has no explicit unmap: it releases the mapping when the typed
   * array is garbage-collected, which happens some time after the last reference is gone.
   */
  close(): void;
}

export type PackResult = { ok: true; pack: Pack } | { ok: false; reason: string };

const MAGIC = "WCMEMEMB";
const FORMAT = "wcmem-embed-v1";
/** Rounds up to a multiple of 8 with arithmetic that cannot wrap (no 32-bit bit operations). */
const align8 = (n: number): number => Math.ceil(n / 8) * 8;

/** FNV-1a, 32 bits, over bytes. */
function fnv1a(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193);
  return h >>> 0;
}

function tableSizeFor(count: number): number {
  let size = 8;
  while (size < count * 2) size *= 2;
  return size;
}

/** How to map a file. A seam so the read-into-memory fallback can be tested; not public API. */
export interface OpenOptions {
  mmap?: (path: string) => Uint8Array;
}

/** Private (copy-on-write) mapping: a write through it can never reach the file. */
const privateMap = (path: string): Uint8Array => Bun.mmap(path, { shared: false }) as Uint8Array;

const isCount = (n: unknown, min = 0): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= 0x7fffffff;

/**
 * Opens a pack, memory-mapped (privately) when it can be and read whole into memory when it
 * cannot (Bun.mmap throws or is unavailable, e.g. on Windows). Never throws.
 *
 * Invariant for everyone who writes a pack: a pack file is never modified in place. It is
 * replaced by writing a temporary file and renaming it over the path, or removed by unlinking.
 * A mapped file that is truncated or rewritten under us crashes Bun with an uncatchable bus
 * error; a rename or unlink leaves the old inode, and so this mapping, intact. An open Pack keeps
 * answering from the content it mapped; noticing a replacement and reopening is the caller's job.
 */
export function openPack(path: string, options: OpenOptions = {}): PackResult {
  try {
    let bytes: Uint8Array | undefined;
    try {
      const mapped = (options.mmap ?? privateMap)(path);
      if (mapped instanceof Uint8Array && mapped.length > 0) bytes = mapped;
    } catch {
      // Fall through to reading the file.
    }
    // A fresh Uint8Array copy is 8-byte aligned, which the typed views below need.
    bytes ??= new Uint8Array(readFileSync(path));
    if (bytes.length < 16) return { ok: false, reason: "file too short" };
    if (new TextDecoder().decode(bytes.subarray(0, 8)) !== MAGIC)
      return { ok: false, reason: "bad magic" };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 8;
    const hlen = view.getUint32(pos, true);
    if (pos + 4 + hlen > bytes.length) return { ok: false, reason: "truncated header" };
    const header = JSON.parse(
      new TextDecoder().decode(bytes.subarray(pos + 4, pos + 4 + hlen)),
    ) as PackHeader;
    if (header.format !== FORMAT)
      return { ok: false, reason: `unknown format ${String(header.format)}` };
    if (typeof header !== "object" || header === null) return { ok: false, reason: "bad header" };
    const { dims, count, tableSize, unkId, vocabSize, minScore, maxPieceChars } = header;
    if (!isCount(dims, 1)) return { ok: false, reason: "bad dims" };
    if (!isCount(count)) return { ok: false, reason: "bad count" };
    if (!isCount(unkId)) return { ok: false, reason: "bad unkId" };
    if (!isCount(vocabSize)) return { ok: false, reason: "bad vocabSize" };
    if (!isCount(maxPieceChars, 1)) return { ok: false, reason: "bad maxPieceChars" };
    if (typeof minScore !== "number" || !Number.isFinite(minScore))
      return { ok: false, reason: "bad minScore" };
    if (
      !isCount(tableSize, 2) ||
      2 ** Math.round(Math.log2(tableSize)) !== tableSize ||
      tableSize < 2 * count
    ) {
      return { ok: false, reason: "bad table size" };
    }
    pos = align8(pos + 4 + hlen);
    if (pos + 4 > bytes.length) return { ok: false, reason: "truncated" };
    const clen = view.getUint32(pos, true);
    const csStart = pos + 4;
    pos = align8(csStart + clen);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const offStart = pos;
    pos = align8(offStart + (count + 1) * 4);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const offsets = new Uint32Array(bytes.buffer, bytes.byteOffset + offStart, count + 1);
    const blobLen = offsets[count]!;
    const blobStart = pos;
    pos = align8(blobStart + blobLen);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const idsStart = pos;
    pos = align8(idsStart + count * 4);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const scoresStart = pos;
    pos = align8(scoresStart + count * 4);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const slotsStart = pos;
    pos = align8(slotsStart + tableSize * 4);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const scalesStart = pos;
    pos = align8(scalesStart + count * 4);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const rowsStart = pos;
    const expected = rowsStart + count * dims;
    if (bytes.length !== expected)
      return { ok: false, reason: `length ${bytes.length}, header implies ${expected}` };

    const at = bytes.byteOffset;
    const ids = new Uint32Array(bytes.buffer, at + idsStart, count);
    const scores = new Float32Array(bytes.buffer, at + scoresStart, count);
    const slots = new Uint32Array(bytes.buffer, at + slotsStart, tableSize);
    const scales = new Float32Array(bytes.buffer, at + scalesStart, count);
    const rows = new Int8Array(bytes.buffer, at + rowsStart, count * dims);
    const blob = bytes.subarray(blobStart, blobStart + blobLen);
    const charsmap = bytes.slice(csStart, csStart + clen);
    const encoder = new TextEncoder();
    const mask = tableSize - 1;

    /** The index of the piece equal to `key[from..to)`, whose FNV-1a hash is `hash`, or -1. */
    const probe = (hash: number, key: Uint8Array, from: number, to: number): number => {
      const length = to - from;
      let slot = hash & mask;
      for (let probes = 0; probes < tableSize; probes++) {
        const entry = slots[slot]!;
        if (entry === 0) return -1;
        const index = entry - 1;
        const start = offsets[index]!;
        if (offsets[index + 1]! - start === length) {
          let same = true;
          for (let i = 0; i < length; i++) {
            if (blob[start + i] !== key[from + i]) {
              same = false;
              break;
            }
          }
          if (same) return index;
        }
        slot = (slot + 1) & mask;
      }
      return -1;
    };

    const pack: Pack = {
      header,
      charsmap,
      find(piece) {
        const key = encoder.encode(piece);
        return key.length === 0 ? -1 : probe(fnv1a(key), key, 0, key.length);
      },
      prefixes(bytes, start, end, maxChars, visit) {
        let hash = 0x811c9dc5;
        let chars = 0;
        for (let i = start; i < end; i++) {
          hash = Math.imul(hash ^ bytes[i]!, 0x01000193);
          // A code point ends where the next byte is not a continuation byte (10xxxxxx).
          if (i + 1 < end && (bytes[i + 1]! & 0xc0) === 0x80) continue;
          const index = probe(hash >>> 0, bytes, start, i + 1);
          if (index >= 0) visit(i + 1, index);
          if (++chars >= maxChars) return;
        }
      },
      idOf: (index) => ids[index]!,
      score: (index) => scores[index]!,
      addRow(index, into, weight = 1) {
        const k = scales[index]! * weight;
        if (k === 0) return;
        const base = index * dims;
        for (let d = 0; d < dims; d++) into[d] = (into[d] ?? 0) + rows[base + d]! * k;
      },
      close() {},
    };
    return { ok: true, pack };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function rmQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone.
  }
}

function rowScale(row: Float32Array): number {
  let max = 0;
  for (let i = 0; i < row.length; i++) {
    const a = Math.abs(row[i]!);
    if (a > max) max = a;
  }
  return max / 127;
}

/** Writes the pack in chunks; the rows are read twice (scales first) and never copied whole. */
export function writePack(
  path: string,
  input: {
    header: Omit<PackHeader, "format" | "count" | "tableSize">;
    charsmap: Uint8Array;
    pieces: { text: string; id: number; score: number; row: Float32Array }[];
  },
): void {
  const { pieces } = input;
  const count = pieces.length;
  const dims = input.header.dims;
  const tableSize = tableSizeFor(count);
  const header: PackHeader = { format: FORMAT, ...input.header, count, tableSize };
  const encoder = new TextEncoder();

  const keys = pieces.map((p) => encoder.encode(p.text));
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i]! + keys[i]!.length;
  const slots = new Uint32Array(tableSize);
  const mask = tableSize - 1;
  for (let i = 0; i < count; i++) {
    let slot = fnv1a(keys[i]!) & mask;
    while (slots[slot] !== 0) slot = (slot + 1) & mask;
    slots[slot] = i + 1;
  }
  const ids = new Uint32Array(count);
  const scores = new Float32Array(count);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ids[i] = pieces[i]!.id;
    scores[i] = pieces[i]!.score;
    scales[i] = rowScale(pieces[i]!.row);
  }

  // Never write the pack in place: an open mapping of the old file must stay valid (see openPack).
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  let written = 0;
  const put = (data: Uint8Array): void => {
    let off = 0;
    while (off < data.length) off += writeSync(fd, data, off, data.length - off);
    written += data.length;
  };
  const pad = (): void => {
    const n = align8(written) - written;
    if (n > 0) put(new Uint8Array(n));
  };
  const u32 = (n: number): Uint8Array => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return b;
  };
  const typed = (a: Uint32Array | Float32Array): Uint8Array =>
    new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let done = false;
  try {
    put(encoder.encode(MAGIC));
    const json = encoder.encode(JSON.stringify(header));
    put(u32(json.length));
    put(json);
    pad();
    put(u32(input.charsmap.length));
    put(input.charsmap);
    pad();
    put(typed(offsets));
    pad();
    const chunk = new Uint8Array(1 << 20);
    let fill = 0;
    for (const key of keys) {
      if (fill + key.length > chunk.length) {
        put(chunk.subarray(0, fill));
        fill = 0;
      }
      if (key.length > chunk.length) put(key);
      else {
        chunk.set(key, fill);
        fill += key.length;
      }
    }
    put(chunk.subarray(0, fill));
    pad();
    put(typed(ids));
    pad();
    put(typed(scores));
    pad();
    put(typed(slots));
    pad();
    put(typed(scales));
    pad();
    const batch = 4096;
    const q = new Int8Array(batch * dims);
    for (let start = 0; start < count; start += batch) {
      const end = Math.min(count, start + batch);
      for (let i = start; i < end; i++) {
        const row = pieces[i]!.row;
        const scale = scales[i]!;
        const o = (i - start) * dims;
        for (let d = 0; d < dims; d++) {
          q[o + d] = scale === 0 ? 0 : Math.max(-127, Math.min(127, Math.round(row[d]! / scale)));
        }
      }
      put(new Uint8Array(q.buffer, 0, (end - start) * dims));
    }
    done = true;
  } finally {
    closeSync(fd);
    if (!done) rmQuietly(tmp);
  }
  renameSync(tmp, path);
}
