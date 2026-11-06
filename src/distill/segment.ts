import { clip } from "../util/text.ts";

/** Candidates cost judgment tokens, and the judge accepts a bounded number of questions. */
const DEFAULT_MAX_CANDIDATES = 40;
/** The answer is where the work is described; the prompt gets a quarter of the room. */
const PROMPT_SHARE = 0.25;
const MIN_CHARS = 20;
const MAX_CHARS = 400;
const MIN_WORDS = 3;

const FENCE = /```[\s\S]*?(?:```|$)/g;
const INLINE_CODE = /`[^`\n]+`/g;
const HEADING = /^#{1,6}\s/;
const TABLE_ROW = /^\|/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const QUOTE_MARK = /^(?:>\s*)+/;
const BULLET = /^(?:[-*+•]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s+)?/;
const WORD = /\p{L}[\p{L}\p{N}_'-]*/gu;

// End punctuation, then space, then something a sentence can start with.
// U+E000 (private use) opens a protected inline-code span.
const BOUNDARY = /([.!?]+)\s+(?=[\p{Lu}\d"'“‘([\uE000])/gu;

// Lower case, without the final dot. Single letters ("p. ex.", initials) are handled separately.
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "cf",
  "approx",
  "aprox",
  "ex",
  "fig",
  "no",
  "nº",
  "dr",
  "dra",
  "sr",
  "sra",
  "mr",
  "mrs",
  "ms",
  "inc",
  "ltd",
  "al",
]);

/** The words of a text, as the segmenter counts them (letters first, then letters, digits, `_`, `'`, `-`). */
export function wordCount(text: string): number {
  return (text.match(WORD) ?? []).length;
}

function endsWithAbbreviation(before: string): boolean {
  const token = (before.match(/\S+$/)?.[0] ?? "").replace(/^[("'[]+/, "").toLowerCase();
  return token.length === 1 || ABBREVIATIONS.has(token);
}

/** Splits one block of prose at sentence boundaries. Nothing is filtered or trimmed. */
export function splitSentences(block: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of block.matchAll(BOUNDARY)) {
    const punctuation = match[1] ?? "";
    if (punctuation === "." && endsWithAbbreviation(block.slice(start, match.index))) continue;
    const end = match.index + punctuation.length;
    sentences.push(block.slice(start, end));
    start = match.index + match[0].length;
  }
  sentences.push(block.slice(start));
  return sentences;
}

function stripEmphasis(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, "$1");
}

/** Keeps `max` items in order: mostly from the start, the rest from the end. */
function fromBothEnds<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const head = Math.ceil(max * 0.6);
  return [...items.slice(0, head), ...items.slice(items.length - (max - head))];
}

/**
 * Splits prose into self-standing sentences worth judging. Code blocks, headings and
 * tables are dropped: they are not statements. Nothing is rewritten; a sentence is
 * returned as it was written, minus markdown decoration.
 */
export function segment(text: string, options: { maxCandidates?: number } = {}): string[] {
  const spans: string[] = [];
  const protectedText = text.replace(FENCE, "\n").replace(INLINE_CODE, (span) => {
    spans.push(span);
    return `\uE000${spans.length - 1}\uE000`;
  });

  const seen = new Set<string>();
  const sentences: string[] = [];
  for (const rawLine of protectedText.split("\n")) {
    let line = rawLine.trim().replace(QUOTE_MARK, "");
    if (line === "" || HEADING.test(line) || TABLE_ROW.test(line) || RULE.test(line)) continue;
    line = stripEmphasis(line.replace(BULLET, ""));

    for (const piece of splitSentences(line)) {
      const sentence = piece
        .replace(/\uE000(\d+)\uE000/g, (_, index: string) => spans[Number(index)] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (sentence.length < MIN_CHARS) continue;
      if (wordCount(sentence) < MIN_WORDS) continue;
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sentences.push(clip(sentence, MAX_CHARS, "…"));
    }
  }
  return fromBothEnds(sentences, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
}

export interface Candidate {
  idx: number;
  /** Where the sentence was written: by the user, or by the assistant in its final message. */
  source: "prompt" | "final";
  text: string;
}

/**
 * The sentences of one turn that a judge will rate. The user's prompt is included
 * because corrections and preferences, the most durable knowledge, are stated there.
 */
export function candidates(
  prompt: string,
  finalText: string | null,
  options: { maxCandidates?: number } = {},
): Candidate[] {
  const max = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const promptMax = Math.max(1, Math.floor(max * PROMPT_SHARE));
  const fromPrompt = segment(prompt, { maxCandidates: promptMax });
  const fromFinal =
    finalText === null ? [] : segment(finalText, { maxCandidates: max - promptMax });
  return [
    ...fromPrompt.map((text) => ({ source: "prompt" as const, text })),
    ...fromFinal.map((text) => ({ source: "final" as const, text })),
  ].map((candidate, idx) => ({ idx, ...candidate }));
}
