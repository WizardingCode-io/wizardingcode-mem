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
import { closeSync, openSync, writeSync } from "node:fs";

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
  /** SentencePiece precompiled_charsmap bytes, as published. */
  charsmap: Uint8Array;
  /** Index of a piece (by its exact text, "▁" included), or -1. */
  find(piece: string): number;
  /** The original vocabulary id. */
  idOf(index: number): number;
  score(index: number): number;
  /** Adds row x scale x weight into `into` (length dims). */
  addRow(index: number, into: Float32Array, weight?: number): void;
  /** Bun offers no unmap: this drops our references and the mapping lives until the process ends. */
  close(): void;
}

export type PackResult = { ok: true; pack: Pack } | { ok: false; reason: string };

const MAGIC = "WCMEMEMB";
const FORMAT = "wcmem-embed-v1";
const align8 = (n: number): number => (n + 7) & ~7;

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

export function openPack(path: string): PackResult {
  try {
    const bytes = Bun.mmap(path) as Uint8Array;
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
    const { dims, count, tableSize } = header;
    if (!Number.isInteger(dims) || dims <= 0) return { ok: false, reason: "bad dims" };
    if (!Number.isInteger(count) || count < 0) return { ok: false, reason: "bad count" };
    if (
      !Number.isInteger(tableSize) ||
      tableSize < 1 ||
      (tableSize & (tableSize - 1)) !== 0 ||
      tableSize < count
    ) {
      return { ok: false, reason: "bad table size" };
    }
    pos = align8(pos + 4 + hlen);
    if (pos + 4 > bytes.length) return { ok: false, reason: "truncated" };
    const clen = view.getUint32(pos, true);
    const csStart = pos + 4;
    pos = align8(csStart + clen);
    const offStart = pos;
    pos = align8(offStart + (count + 1) * 4);
    if (pos > bytes.length) return { ok: false, reason: "truncated" };
    const offsets = new Uint32Array(bytes.buffer, bytes.byteOffset + offStart, count + 1);
    const blobLen = offsets[count]!;
    const blobStart = pos;
    pos = align8(blobStart + blobLen);
    const idsStart = pos;
    pos = align8(idsStart + count * 4);
    const scoresStart = pos;
    pos = align8(scoresStart + count * 4);
    const slotsStart = pos;
    pos = align8(slotsStart + tableSize * 4);
    const scalesStart = pos;
    pos = align8(scalesStart + count * 4);
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
    const charsmap = bytes.subarray(csStart, csStart + clen);
    const encoder = new TextEncoder();
    const mask = tableSize - 1;

    const pack: Pack = {
      header,
      charsmap,
      find(piece) {
        const key = encoder.encode(piece);
        let slot = fnv1a(key) & mask;
        for (let probes = 0; probes < tableSize; probes++) {
          const entry = slots[slot]!;
          if (entry === 0) return -1;
          const index = entry - 1;
          const start = offsets[index]!;
          const end = offsets[index + 1]!;
          if (end - start === key.length) {
            let same = true;
            for (let i = 0; i < key.length; i++) {
              if (blob[start + i] !== key[i]) {
                same = false;
                break;
              }
            }
            if (same) return index;
          }
          slot = (slot + 1) & mask;
        }
        return -1;
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

  const fd = openSync(path, "w");
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
  } finally {
    closeSync(fd);
  }
}
