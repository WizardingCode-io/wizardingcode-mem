// What never reaches the judge (spec 2026-10-14, section 1). Two layers, both pure:
// `stripHost` takes the host's own blocks out of a text before it is segmented, and
// `dropNoise` drops the sentences that a labelled sample showed are never knowledge
// (97–100% of hits were records of a session). Every pattern is named, so that the
// proof's report can say what each one dropped. The medium signals (commit hashes,
// "PR #", status verbs, test counts) are not here: they hit knowledge too often, and
// they are the judge's to weigh.

export interface NoisePattern {
  name: string;
  pattern: RegExp;
}

// --- Blocks: the host speaking, quoted by the assistant --------------------------

/** A block element: to its close, or to the end of the text when it never closes. */
const block = (tag: string) => new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(?:</${tag}>|$)`, "g");
/** `<summary>` is inline: to its close, or to the end of its line. */
const SUMMARY = /<summary\b[^>]*>(?:[^\n]*?<\/summary>|[^\n]*)/g;
const DETAILS = /<\/?details\b[^>]*>/g;

const HOST_BLOCKS: readonly RegExp[] = [
  block("agent-message"),
  block("task-notification"),
  block("system-reminder"),
  SUMMARY,
  DETAILS,
];

/** The text without the host's blocks. Ordinary angle brackets (generics, HTML) stay. */
export function stripHost(text: string): string {
  let out = text;
  for (const pattern of HOST_BLOCKS) out = out.replace(pattern, "");
  return out;
}

// --- Sentences: never knowledge ---------------------------------------------------

/** In the order they are tried; the first match names the drop. */
export const NOISE_PATTERNS: readonly NoisePattern[] = [
  {
    // What a host frame leaves once its tags are gone: the lines around a subagent's
    // report, and the metadata of a background task.
    name: "host-frame",
    pattern:
      /^(?:\[Subagent hand-back\]|Another Claude session sent a message|That "other Claude session" is an agent|The report follows|The harness indents every line|Async agent launched successfully|The agent is working in the background|Do not duplicate this agent's work|Do NOT Read or tail this file|agentId:|output_file:)|This tool result is internal metadata|NOT a message from the user|carr(?:y|ies) no user authority/,
  },
  { name: "status-label", pattern: /^(?:Status|Estado|State)\s*:/ },
  { name: "template-label", pattern: /^(?:Title|Body|Título|Corpo)\s*:\s/ },
  // Two or more colon-separated parts: `[arka:gate:4]`, `[arka:routing]`. A one-part
  // bracket (`[x]`, `[en]`, `[2024]`) is not a protocol tag.
  { name: "protocol-tag", pattern: /^\[[a-z][a-z0-9-]*(?::[a-z0-9-]+)+\]/i },
  // The capitalised verdict label, a short gap and a colon, then the verdict word; or the
  // verdict opening the sentence. "Only APPROVED campaigns are sent" and "If the verdict
  // is FAILED, ..." are rules and pass.
  {
    name: "verdict",
    pattern:
      /\b(?:Verdict|Veredicto)\b[^:\n]{0,40}:\s*(?:REJECTED|APPROVED|PASSED|FAILED)\b|^(?:REJECTED|APPROVED|PASSED|FAILED)\s*[:—–-]/,
  },
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
