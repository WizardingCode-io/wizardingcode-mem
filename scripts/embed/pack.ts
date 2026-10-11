/**
 * Builds a wcmem-embed-v1 pack from the published model files.
 *   bun scripts/embed/pack.ts <tokenizer.json> <model.safetensors> <out.wcpack> [--subset <reference.json>]
 * With --subset only the pieces that occur inside the reference texts (plus [UNK]) are kept, for tests.
 */
import { closeSync, openSync, readSync } from "node:fs";
import { writePack } from "../../src/embed/pack.ts";

const args = process.argv.slice(2);
const subsetAt = args.indexOf("--subset");
const subsetPath = subsetAt >= 0 ? args[subsetAt + 1] : undefined;
const [tokenizerPath, safetensorsPath, outPath] =
  subsetAt >= 0 ? args.filter((_, i) => i !== subsetAt && i !== subsetAt + 1) : args;
if (!tokenizerPath || !safetensorsPath || !outPath) {
  console.error(
    "usage: pack.ts <tokenizer.json> <model.safetensors> <out.wcpack> [--subset <reference.json>]",
  );
  process.exit(2);
}

const tokenizer = await Bun.file(tokenizerPath).json();
if (tokenizer.model?.type !== "Unigram")
  throw new Error(`tokenizer model is ${tokenizer.model?.type}, expected Unigram`);
const vocab: [string, number][] = tokenizer.model.vocab;
const unkId: number = tokenizer.model.unk_id;
type Normalizer = { type: string; precompiled_charsmap?: string; normalizers?: Normalizer[] };
/** The normaliser chain may be nested Sequences; the Precompiled step is somewhere inside. */
const findPrecompiled = (n: Normalizer | undefined): Normalizer | undefined =>
  n?.type === "Precompiled" ? n : n?.normalizers?.map(findPrecompiled).find(Boolean);
const precompiled = findPrecompiled(tokenizer.normalizer);
if (!precompiled?.precompiled_charsmap)
  throw new Error("no Precompiled normaliser in tokenizer.json");
const charsmap = new Uint8Array(Buffer.from(precompiled.precompiled_charsmap, "base64"));

// safetensors: u64 header length, JSON header, raw data.
const fd = openSync(safetensorsPath, "r");
const lenBuf = new Uint8Array(8);
readSync(fd, lenBuf, 0, 8, 0);
const headerLen = Number(new DataView(lenBuf.buffer).getBigUint64(0, true));
const headerBuf = new Uint8Array(headerLen);
readSync(fd, headerBuf, 0, headerLen, 8);
closeSync(fd);
const st = JSON.parse(new TextDecoder().decode(headerBuf)) as Record<
  string,
  { dtype: string; shape: number[]; data_offsets: [number, number] }
>;
const tensors = Object.entries(st).filter(
  ([k, t]) =>
    k !== "__metadata__" &&
    t.dtype === "F32" &&
    t.shape.length === 2 &&
    t.shape[0] === vocab.length,
);
if (tensors.length !== 1)
  throw new Error(`expected one F32 tensor of ${vocab.length} rows, found ${tensors.length}`);
const [, tensor] = tensors[0]!;
const dims = tensor.shape[1]!;
const [begin, end] = tensor.data_offsets;
if (end - begin !== vocab.length * dims * 4)
  throw new Error("tensor byte range does not match its shape");
const dataStart = 8 + headerLen + begin;
if (dataStart % 4 !== 0) throw new Error("tensor data is not 4-byte aligned");

// One read of the matrix; rows are views into it.
const file = Bun.file(safetensorsPath);
const matrix = new Float32Array(
  await file.slice(dataStart, dataStart + (end - begin)).arrayBuffer(),
);

let minScore = Number.POSITIVE_INFINITY;
let maxPieceChars = 0;
for (const [piece, score] of vocab) {
  if (score < minScore) minScore = score;
  const n = [...piece].length;
  if (n > maxPieceChars) maxPieceChars = n;
}

let keep: (piece: string, id: number) => boolean = () => true;
if (subsetPath) {
  const reference = await Bun.file(subsetPath).json();
  const grams = new Set<string>();
  for (const item of reference.items as { normalized: string }[]) {
    const chars = [...("▁" + item.normalized.replaceAll(" ", "▁"))];
    for (let i = 0; i < chars.length; i++) {
      let s = "";
      for (let j = i; j < Math.min(chars.length, i + maxPieceChars); j++) {
        s += chars[j];
        grams.add(s);
      }
    }
  }
  keep = (piece, id) => id === unkId || grams.has(piece);
}

const pieces: { text: string; id: number; score: number; row: Float32Array }[] = [];
for (let id = 0; id < vocab.length; id++) {
  const [text, score] = vocab[id]!;
  if (keep(text, id))
    pieces.push({ text, id, score, row: matrix.subarray(id * dims, (id + 1) * dims) });
}

writePack(outPath, {
  header: {
    model: "minishlab/potion-multilingual-128M",
    revision: process.env.WCMEM_MODEL_REVISION ?? "73908c3438cf03b6a01bcb9611d62b23d0726f08",
    dims,
    vocabSize: vocab.length,
    unkId,
    minScore,
    maxPieceChars,
  },
  charsmap,
  pieces,
});
console.log(
  `${outPath}: ${pieces.length} pieces of ${vocab.length}, minScore ${minScore}, maxPieceChars ${maxPieceChars}`,
);
