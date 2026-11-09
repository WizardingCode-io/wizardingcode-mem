import type { Redacted } from "../core/redact.ts";
import type { MemoryKind } from "../core/types.ts";

/**
 * A judge answers the semantic questions of the pipeline. It never decides what happens:
 * it returns probabilities and labels, and the thresholds that turn them into actions
 * live in code (`distill/policy.ts`).
 */
export type JudgeSource = "typesafe" | "heuristic";

export interface DistillCandidate {
  idx: number;
  /** Written by the user (`prompt`) or by the assistant in its final message (`final`). */
  source: "prompt" | "final";
  text: Redacted;
}

export interface DistillInput {
  prompt: Redacted;
  /** Empty when the turn was interrupted before the assistant answered. */
  finalText: Redacted;
  candidates: DistillCandidate[];
  filesChanged: string[];
  commands: Redacted[];
  hadErrors: boolean;
  /**
   * The wording of the questions: 2 (the default) for distillation, 1 for the import
   * rejudge, which keeps the version 1 questions (ADR 0023, D-2). A judge without
   * questions ignores it.
   */
  wording?: 1 | 2;
}

export interface DistillVerdict {
  /** Probability that the turn holds knowledge a later session would work better for knowing. */
  worthSaving: number;
  kind: MemoryKind | "none";
  kindConfidence: number;
  importance: 1 | 2 | 3 | 4 | 5;
  /** Per candidate, aligned by `idx`: probability that it is a durable, self-standing fact. */
  durable: number[];
  /** The candidate that works best alone as a title; null when none does. */
  titleIdx: number | null;
  source: JudgeSource;
}

export interface ConsolidateInput {
  draft: { title: string; body: Redacted; kind: MemoryKind; files: string[] };
  /** Existing memories that might say the same thing, nearest first. */
  neighbours: { id: number; title: string; body: Redacted; files: string[] }[];
}

/**
 * The texts a consolidation compares, whatever they are: memory's `ConsolidateInput` is
 * one, and so are the entries of knowledge's `relate`, with no files.
 */
export interface ConsolidateTexts {
  draft: { title: string; body: string; files: string[] };
  neighbours: { id: number; title: string; body: string; files: string[] }[];
}

export interface ConsolidateVerdict {
  perNeighbour: {
    id: number;
    relation: "different" | "related" | "same";
    /** 0 different, 1 related, 2 same; fractional when the judge is unsure. */
    relationScore: number;
    /** Probability that the draft makes this neighbour no longer true. */
    contradicts: number;
  }[];
  source: JudgeSource;
}

/** A knowledge draft and its nearest entries; every text is redacted before a judge sees it. */
export interface RelateInput {
  draft: { title: Redacted; body: Redacted };
  neighbours: { index: number; title: Redacted; body: Redacted }[];
}

/** `consolidate`'s verdict, keyed by each neighbour's `index`. */
export interface RelateVerdict {
  source: JudgeSource;
  perNeighbour: {
    index: number;
    relation: "different" | "related" | "same";
    relationScore: number;
    contradicts: number;
  }[];
}

export interface PersonalInput {
  title: string;
  body: string;
  /** The names of the projects the rule was found in. */
  projects: string[];
}

export interface PersonalVerdict {
  /** Whether the rule is the author's way of working rather than a fact of its project. */
  personal: boolean;
  /** How sure the judge is of `personal`, 0.5 to 1; 0 when no judge could say. */
  confidence: number;
}

export interface Judge {
  readonly name: JudgeSource | "fallback";
  /** Recorded on each memory, so that it can be judged again when a judge improves. */
  readonly version: string;
  /** The version of each judge that may answer through this one, by its name. */
  readonly versions: Partial<Record<JudgeSource, string>>;
  distill(input: DistillInput): Promise<DistillVerdict>;
  consolidate(input: ConsolidateInput): Promise<ConsolidateVerdict>;
  /** Knowledge's duplicates and contradictions: `consolidate`'s logic, with no files. */
  relate(input: RelateInput): Promise<RelateVerdict>;
  /** Only judges that can tell have it; without it, a proposed rule stands and the author decides. */
  personal?(input: PersonalInput): Promise<PersonalVerdict>;
}
