// What never reaches the judge (spec 2026-10-14, section 1). Two layers, both pure:
// `stripHost` takes the host's own blocks out of a text before it is segmented, and
// `dropNoise` drops the sentences that a labelled sample showed are never knowledge
// (97–100% of hits were records of a session). Every pattern is named, so that the
// proof's report can say what each one dropped. The medium signals (commit hashes,
// "PR #", status verbs, test counts) are not here: they hit knowledge too often, and
// they are the judge's to weigh. Nor are verdict words and bracketed protocol tags
// (ADR 0023, D-3): their precision on the sample was too low to drop a sentence unseen.

export interface NoisePattern {
  name: string;
  pattern: RegExp;
}

// --- Blocks: the host speaking, quoted by the assistant --------------------------

const BLOCK_TAGS = ["agent-message", "task-notification", "system-reminder"] as const;
/** A block element, from its opening tag to its close. */
const CLOSED_BLOCKS = BLOCK_TAGS.map(
  (tag) => new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, "g"),
);
/** A block tag opening a line: where a host block cut short begins. */
const OPENS_A_LINE = new RegExp(`^[ \\t]*<(?:${BLOCK_TAGS.join("|")})\\b[^>]*>`);
const FENCE = /^[ \t]*(?:```|~~~)/;
/** `<summary>` is inline: to its close, or to the end of its line. */
const SUMMARY = /<summary\b[^>]*>(?:[^\n]*?<\/summary>|[^\n]*)/g;
const DETAILS = /<\/?details\b[^>]*>/g;

/**
 * Where a host block that never closes begins: a block tag that opens a line outside a
 * fenced block. A tag named in prose or in backticks does not open a line, and is text.
 */
function cutShortAt(text: string): number {
  let inFence = false;
  let at = 0;
  for (const line of text.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    else if (!inFence && OPENS_A_LINE.test(line)) return at;
    at += line.length + 1;
  }
  return -1;
}

/**
 * The text without the host's blocks: each block to its close; one that never closes, to the
 * end of the text when its tag opens a line outside a fence (a host block cut short).
 * Ordinary angle brackets (generics, HTML) and tags named in prose or in backticks stay.
 */
export function stripHost(text: string): string {
  let out = text;
  for (const pattern of CLOSED_BLOCKS) out = out.replace(pattern, "");
  const cut = cutShortAt(out);
  if (cut >= 0) out = out.slice(0, cut);
  return out.replace(SUMMARY, "").replace(DETAILS, "");
}

// --- Sentences: never knowledge ---------------------------------------------------

/** In the order they are tried; the first match names the drop. */
export const NOISE_PATTERNS: readonly NoisePattern[] = [
  {
    // What a host frame leaves once its tags are gone: the fixed lines around a subagent's
    // report, and the metadata of a background task. Anchored at the start of the sentence:
    // a sentence that quotes one of these phrases while discussing the host is not the host.
    name: "host-frame",
    pattern:
      /^(?:\[Subagent hand-back\]|Another Claude session sent a message|That "other Claude session" is an agent|The report follows|It is model output, NOT a message from the user|The harness indents every line|This tool result is internal metadata|Async agent launched successfully|The agent is working in the background|Do not duplicate this agent's work|Do NOT Read or tail this file|agentId:|output_file:)/,
  },
  { name: "status-label", pattern: /^(?:Status|Estado|State)\s*:/ },
  { name: "template-label", pattern: /^(?:Title|Body|Título|Corpo)\s*:\s/ },
];

export function noiseOf(text: string): string | null {
  for (const { name, pattern } of NOISE_PATTERNS) if (pattern.test(text)) return name;
  return null;
}

/**
 * The candidates worth judging, re-indexed from 0 so that the judge's `candidates[i]`
 * paths stay dense, and the ones dropped with the name of the pattern that dropped them.
 */
export function dropNoise<T extends { idx: number; text: string }>(
  candidates: T[],
): { kept: T[]; dropped: { candidate: T; pattern: string }[] } {
  const kept: T[] = [];
  const dropped: { candidate: T; pattern: string }[] = [];
  for (const candidate of candidates) {
    const pattern = noiseOf(candidate.text);
    if (pattern === null) kept.push({ ...candidate, idx: kept.length });
    else dropped.push({ candidate, pattern });
  }
  return { kept, dropped };
}

const escapeRegExp = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The text without the given sentences, as the segmenter returned them (`candidates()`): the
 * segmenter collapsed whitespace and dropped emphasis markers, so any run of whitespace in a
 * sentence matches any run in the text, and `*` or `**` may sit between its characters. A
 * sentence the segmenter clipped (ending in "…") goes to the end of its line. A sentence
 * that is not found is left alone.
 */
export function withoutSentences(text: string, sentences: string[]): string {
  let out = text;
  for (const sentence of sentences) {
    const clipped = sentence.endsWith("…");
    const body = clipped ? sentence.slice(0, -1) : sentence;
    const pattern = [...body]
      .map((char) => (/\s/.test(char) ? "\\s+" : `${escapeRegExp(char)}\\*{0,2}`))
      .join("");
    out = out.replace(new RegExp(`\\*{0,2}${pattern}${clipped ? "[^\\n]*" : ""}`), "");
  }
  return out;
}
