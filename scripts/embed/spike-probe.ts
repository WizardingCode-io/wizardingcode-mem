/**
 * Spike probe (ADR 0014): what the prompt hook would do for semantic recall, in a process of its
 * own. Compiled like the product binary:
 *
 *   bun build --compile --outfile <scratch>/spike-probe scripts/embed/spike-probe.ts
 *
 * Usage: `spike-probe <pack> <vectors.bin> <prompt>` prints `ms_open ms_embed ms_scan best_score`;
 * `spike-probe --noop` exits at once (the cost of the process alone). vectors.bin holds N records
 * of a float32 scale (little-endian) followed by 256 int8 components. Dev-only; never shipped.
 */
import { embed } from "../../src/embed/embed.ts";
import { openPack } from "../../src/embed/pack.ts";
import { clip } from "../../src/util/text.ts";

const DIMS = 256;
const RECORD = 4 + DIMS;
const KEEP = 20;
/** buildQuery's limit: the hook clips the prompt the same way before embedding it. */
const MAX_PROMPT_CHARS = 4000;

const args = process.argv.slice(2);
if (args[0] === "--noop") process.exit(0);
const [packPath, vectorsPath, prompt] = args;
if (packPath === undefined || vectorsPath === undefined || prompt === undefined) {
  console.error("usage: spike-probe <pack> <vectors.bin> <prompt> | --noop");
  process.exit(1);
}

const t0 = performance.now();
const opened = openPack(packPath);
if (!opened.ok) {
  console.error(`pack: ${opened.reason}`);
  process.exit(1);
}
const t1 = performance.now();
const query = embed(opened.pack, clip(prompt, MAX_PROMPT_CHARS));
const t2 = performance.now();

let best = Number.NEGATIVE_INFINITY;
if (query !== null) {
  const buffer = await Bun.file(vectorsPath).arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Int8Array(buffer);
  const count = Math.floor(buffer.byteLength / RECORD);
  // The best KEEP scores, kept sorted descending (a small insertion list beats a heap at 20).
  const top: number[] = [];
  for (let r = 0; r < count; r++) {
    const offset = r * RECORD;
    const scale = view.getFloat32(offset, true);
    let dot = 0;
    const base = offset + 4;
    for (let d = 0; d < DIMS; d++) dot += query[d]! * bytes[base + d]!;
    // The stored vector is unit length before quantisation, so dot x scale is the cosine.
    const score = dot * scale;
    if (top.length < KEEP || score > top[top.length - 1]!) {
      let i = top.length < KEEP ? top.length : KEEP - 1;
      while (i > 0 && top[i - 1]! < score) {
        top[i] = top[i - 1]!;
        i--;
      }
      top[i] = score;
    }
  }
  best = top[0] ?? Number.NEGATIVE_INFINITY;
}
const t3 = performance.now();

console.log(`${(t1 - t0).toFixed(3)} ${(t2 - t1).toFixed(3)} ${(t3 - t2).toFixed(3)} ${best}`);
process.exit(0);
