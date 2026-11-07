import type { MemoryKind } from "../core/types.ts";
import { tokens } from "../util/words.ts";
import type {
  ConsolidateInput,
  ConsolidateVerdict,
  DistillCandidate,
  DistillInput,
  DistillVerdict,
  Judge,
} from "./types.ts";

// The judge that needs no network and no key: rules over wording, in English and
// Portuguese. It is the default, and the fallback when a model-backed judge is
// unavailable. It reads cues, not meaning, and is tuned to keep too little rather
// than too much: a missed memory costs less than a wrong one injected every session.

// --- What the user said -----------------------------------------------------------

// A standing rule is something the user wants followed from here on. The same words
// ("don't", "must", "always", "instead") fill ordinary requests, questions and
// complaints, so a cue counts only in a sentence that is none of those.

/** Says the rule outlasts this turn. */
const STANDING = /\b(?:never|always|from now on|nunca|sempre|a partir de agora|doravante)\b/i;
/** "always" and "never" used to describe what happens, not to say what to do. */
const OBSERVATION =
  /\b(?:i|it|this|that|he|she|they|there)\s+(?:always|never)\b|\b(?:always|never|sempre|nunca)\s+(?:fails?|breaks?|crash(?:es)?|happens?|works?|worked|falha|funciona|acontece)\b|\b(?:fails?|breaks?|falha|falham|funciona|acontece)\s+(?:sempre|nunca)\b/i;
/** A prohibition, at the start of a clause: "don't …", "no, don't …", "não uses …". */
const PROHIBITION =
  /(?:^|[.!,;:]\s+)(?:(?:no|não),?\s+)?(?:(?:please|por favor),?\s+)?(?:don't|do not|stop using|stop doing|avoid|não (?:uses|faças|usar|fazer|quero|queremos)|evita|deixa de|para de)\b/i;
const MODAL =
  /\b(?:must|should)(?: not)?\b|\bshouldn't\b|\b(?:temos|têm) (?:que|de)\b|\bdevem(?:os)?\b|\bobrigatóri[oa]s?\b/i;
/** "must" and "should" about one situation: "this should not happen", "you must be joking". */
const MODAL_ABOUT_A_SITUATION =
  /\b(?:i|you|he|she|it|this|that|there|they|something|someone)\s+(?:must|should|shouldn't)\b/i;
const PREFERENCE = /\b(?:i|we) prefer\b|\bprefiro\b|\bpreferimos\b/i;
const QUESTION = /\?["')\]]*$/;
const REQUEST =
  /^(?:(?:can|could|would|will) you|please (?:can|could)|podes|pode|consegues|poderias|dá para)\b/i;
/** Limits the sentence to here and now. */
const ONE_OFF =
  /\b(?:for now|this time|right now|just this once|in this (?:one )?(?:function|file|case|test)|por agora|para já|desta vez|neste caso|só desta vez)\b|(?<!a partir de )\bagora\b/i;

export function isStandingRule(sentence: string): boolean {
  const text = sentence.trim();
  if (QUESTION.test(text) || REQUEST.test(text) || ONE_OFF.test(text)) return false;
  if (STANDING.test(text) && !OBSERVATION.test(text)) return true;
  if (PROHIBITION.test(text) || PREFERENCE.test(text)) return true;
  return MODAL.test(text) && !MODAL_ABOUT_A_SITUATION.test(text);
}

// --- What the assistant said ------------------------------------------------------

const RESOLUTION = [
  /\b(?:fixed|resolved|the fix|root cause|the cause was|found it|found the (?:bug|problem|cause|issue))\b/i,
  /\b(?:corrigid[oa]|corrigi|resolvid[oa]|causa raiz|a causa (?:era|foi)|encontrei a causa)\b/i,
];
const DECISION = [
  /\b(?:because|decided|we chose|i chose|trade-?off|instead of|rather than|the reason|so that|in order to|due to)\b/i,
  /\b(?:porque|decidimos|decidi|decidido|escolhemos|escolhi|em vez de|a razão|para que|devido a|por causa de)\b/i,
];
const GOTCHA = [
  /\b(?:gotcha|pitfall|caveat|be careful|beware|note that|watch out|surprisingly|unexpectedly|silently|by default|does not (?:honou?r|respect|support)|doesn't (?:honou?r|respect|support)|only works)\b/i,
  /\b(?:atenção|cuidado|armadilha|nota que|repara que|inesperadamente|silenciosamente|por omissão|não respeita|não suporta|só funciona)\b/i,
];
const DISCOVERY = [
  /\b(?:it turns out|turns out|i found that|we found that|discovered that|under the hood|is (?:stored|defined|located|implemented|handled) (?:in|by))\b/i,
  /\b(?:afinal|descobri que|descobrimos que|verifica-se que|por baixo|está (?:definid|guardad|implementad)[oa] em)\b/i,
];
const CRITICAL =
  /\b(?:security|vulnerab\w+|credentials?|secrets?|data loss|production|breaking change|segurança|credenci\w+|segredos?|perda de dados|produção)\b/i;

/** Talk about the conversation rather than about the project. */
const NOT_A_FACT = [
  /\?\s*$/,
  /\b(?:i will|i'll|i am going to|i'm going to|next,? i|let me|would you like|do you want|shall i|should i)\b/i,
  /\b(?:vou|irei|vamos|queres que|quer que|diz-me|posso)\b/i,
];
/** Opens with a word that points back into a conversation the reader will not have. */
const LEANS_ON_CONTEXT =
  /^(?:it|this|that|they|these|those|he|she|isto|isso|aquilo|eles?|elas?)\b/i;

/** Something a search could later match exactly: code, a path, a file, a symbol. */
const IDENTIFIER =
  /`[^`]+`|[\w.-]+\/[\w./-]+|\b\w+\.(?:ts|tsx|js|jsx|json|md|sql|py|go|rs|toml|ya?ml|sh|css|html)\b|\b[a-z]+[A-Z]\w*\b|\b[A-Z][a-z0-9]+[A-Z]\w*\b|\b\w+_\w+\b|\b[A-Z][A-Z0-9_]{2,}\b/;

const SUPERSEDES = [
  /\b(?:no longer|not anymore|replaced|replaces|reverted|deprecated|removed|now uses|is now|was changed to|switched (?:to|from))\b/i,
  /\b(?:já não|deixou de|substitu\w+|revertid[oa]|removid[oa]|passou a|passa a|agora usa|mudou para)\b/i,
];

// --- Records of a session ---------------------------------------------------------
// The medium signals of the 2026-10-13 sample: they mark a report of what was done more
// often than not, but they sit on knowledge too ("Decisão aplicada (commit 5808e41)"), so
// they lower a sentence's knowledge probability instead of dropping it. "done" and "feito"
// are left out on purpose: too common in ordinary sentences.

/** 7 to 40 hex characters with a digit and a letter: neither "2026" nor "facade". */
const COMMIT_HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/;
const PULL_REQUEST = /\b(?:PR|MR)\s*[#!]\s*\d+\b|\/(?:pull|merge_requests)\/\d+/i;
const STATUS_VERB =
  /\b(?:delivered|merged|committed|closed|shipped|pushed|entregues?|fechad[oa]s?|conclu[ií]d[oa]s?|commitad[oa]s?|integrad[oa]s?|fundid[oa]s?|gravad[oa]s?|selad[oa]s?|lançad[oa]s?|despachad[oa]s?)\b/i;
const VERDICT = /\b(?:verdict|veredicto|REJECTED|APPROVED)\b/;
const TEST_COUNT =
  /\b\d+\s*\/\s*\d+\b|\btests? (?:pass(?:es|ed)?|green)\b|\btestes? (?:passam|passou|verdes?)\b/i;
const REPORT = [COMMIT_HASH, PULL_REQUEST, STATUS_VERB, VERDICT, TEST_COUNT];
/** What a sentence with a report signal loses; the floor of 0.05 still holds. */
const REPORT_PENALTY = 0.25;
/** An answer with at least this share of report sentences gets the worth discount. */
const REPORT_SHARE = 0.6;
const REPORT_DISCOUNT = 0.2;

const SUBSTANTIVE_CHARS = 120;
const THIN_CHARS = 80;

const any = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

function durability(candidate: DistillCandidate, reportSignals: boolean): number {
  const text: string = candidate.text;
  if (candidate.source === "prompt") return isStandingRule(text) ? 0.75 : 0.1;
  if (any(text, NOT_A_FACT)) return 0.05;
  let score = 0.3;
  if (IDENTIFIER.test(text)) score += 0.2;
  if (any(text, [...RESOLUTION, ...DECISION, ...GOTCHA, ...DISCOVERY])) score += 0.2;
  if (text.length >= 40 && text.length <= 300) score += 0.1;
  if (LEANS_ON_CONTEXT.test(text)) score -= 0.2;
  if (reportSignals && any(text, REPORT)) score -= REPORT_PENALTY;
  return clamp(score, 0.05, 0.95);
}

function distill(input: DistillInput, reportSignals: boolean): DistillVerdict {
  const prompt: string = input.prompt;
  const final: string = input.finalText;

  // Judged a sentence at a time: a cue in one sentence says nothing about the others.
  const correction = input.candidates.some(
    (candidate) => candidate.source === "prompt" && isStandingRule(candidate.text),
  );
  const resolution = any(final, RESOLUTION);
  const decision = any(final, DECISION);
  const gotcha = any(final, GOTCHA);
  const discovery = any(final, DISCOVERY);
  const edits = input.filesChanged.length > 0;
  const cue = resolution || decision || gotcha || discovery;

  const durable = input.candidates.map((candidate) => durability(candidate, reportSignals));
  const hasDurable = durable.some((p) => p >= 0.5);

  let worth = 0.15;
  if (cue) worth += 0.35;
  if (correction) worth += 0.45;
  if (edits) worth += 0.25;
  if (edits && final.length >= SUBSTANTIVE_CHARS && IDENTIFIER.test(final)) worth += 0.15;
  if (input.hadErrors && resolution) worth += 0.15;
  // A short answer cannot carry knowledge, unless the knowledge is the user's own rule.
  if (final.length < THIN_CHARS && !correction) worth -= 0.35;
  if (!edits && !cue && !correction) worth -= 0.2;
  // Mostly a report of the session: the cue words it carries ("fixed", "merged") are news,
  // not knowledge.
  const finals = input.candidates.filter((candidate) => candidate.source === "final");
  const reporting = finals.filter((candidate) => any(candidate.text, REPORT)).length;
  if (reportSignals && finals.length > 0 && reporting / finals.length >= REPORT_SHARE) {
    worth -= REPORT_DISCOUNT;
  }
  // With no sentence to keep, there is nothing to make a memory from.
  if (!hasDurable) worth = Math.min(worth, 0.3);

  let kind: MemoryKind | "none" = "none";
  let kindConfidence = 0.5;
  if (correction) [kind, kindConfidence] = ["convention", 0.7];
  else if (resolution) [kind, kindConfidence] = ["fix", input.hadErrors ? 0.8 : 0.65];
  else if (gotcha) [kind, kindConfidence] = ["gotcha", 0.65];
  else if (decision) [kind, kindConfidence] = ["decision", 0.65];
  else if (discovery) [kind, kindConfidence] = ["discovery", 0.6];
  else if (edits) [kind, kindConfidence] = ["change", 0.55];

  let importance = kind === "none" ? 1 : 2;
  if (kind !== "none") {
    if (correction) importance += 1;
    if (kind === "fix" && input.hadErrors) importance += 1;
    if (kind === "gotcha") importance += 1;
    if (CRITICAL.test(final) || CRITICAL.test(prompt)) importance += 1;
  }

  // The title is the best durable sentence that is short enough to be one. For a
  // correction it is the user's own wording.
  const eligible = input.candidates.filter((c) => (durable[c.idx] ?? 0) >= 0.5);
  const rank = (c: DistillCandidate) =>
    (correction && c.source === "prompt" ? 10 : 0) +
    (c.text.length <= 120 ? 5 : 0) +
    (durable[c.idx] ?? 0);
  const title = eligible.reduce<DistillCandidate | null>(
    (best, c) => (best === null || rank(c) > rank(best) ? c : best),
    null,
  );

  return {
    worthSaving: clamp(worth),
    kind,
    kindConfidence,
    importance: clamp(importance, 1, 5) as DistillVerdict["importance"],
    durable,
    titleIdx: title?.idx ?? null,
    source: "heuristic",
  };
}

// --- Consolidation ----------------------------------------------------------------

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

function consolidate(input: ConsolidateInput): ConsolidateVerdict {
  const draftText = `${input.draft.title} ${input.draft.body}`;
  const draftTokens = tokens(draftText);
  const replaces = any(draftText, SUPERSEDES);

  return {
    source: "heuristic",
    perNeighbour: input.neighbours.map((neighbour) => {
      const overlap = jaccard(draftTokens, tokens(`${neighbour.title} ${neighbour.body}`));
      const sameFiles =
        (input.draft.files.length === 0 && neighbour.files.length === 0) ||
        input.draft.files.some((file) => neighbour.files.includes(file));
      // Same words about different files are two facts, not one.
      const relation =
        overlap >= 0.6 && sameFiles ? "same" : overlap >= 0.3 ? "related" : "different";
      return {
        id: neighbour.id,
        relation,
        relationScore: relation === "same" ? 2 : relation === "related" ? 1 : 0,
        // A near-identical neighbour already says what it replaced: nothing is contradicted.
        contradicts: replaces && overlap >= 0.5 && overlap < 0.9 ? 0.8 : 0.1,
      };
    }),
  };
}

export const heuristicJudge: Judge = {
  name: "heuristic",
  version: "2",
  versions: { heuristic: "2" },
  distill: async (input) => distill(input, true),
  consolidate: async (input) => consolidate(input),
};

/**
 * Version 1 of the heuristic: the same rules without the report signals. Never used by the
 * drain; the quality proof compares it with version 2 (ADR 0023, D-6).
 */
export const heuristicJudgeV1: Judge = {
  name: "heuristic",
  version: "1",
  versions: { heuristic: "1" },
  distill: async (input) => distill(input, false),
  consolidate: async (input) => consolidate(input),
};
