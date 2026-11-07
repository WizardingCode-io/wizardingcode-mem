import type { MemoryKind } from "../core/types.ts";
import { MEMORY_KINDS } from "../core/types.ts";
import type { Answer, Question } from "./client.ts";
import type {
  ConsolidateInput,
  ConsolidateVerdict,
  DistillInput,
  DistillVerdict,
  PersonalInput,
  PersonalVerdict,
} from "./types.ts";

// The questions a System One model is asked, and how its answers become verdicts.
// Pure: no network, no database. Thresholds stay in distill/policy.ts.

const TITLE_MAX_CHARS = 160;
// --- Version 1: kept for the import rejudge (ADR 0023, D-2) ---------------------------
const KIND_CRITERIA_V1: Record<MemoryKind | "none", string> = {
  decision: "A choice between alternatives, with its rationale",
  fix: "A bug or error and what resolved it",
  gotcha: "A non-obvious pitfall, limitation or surprising behaviour",
  convention: "A rule or preference for how work is done in this project",
  change: "A lasting change to behaviour, structure or interfaces",
  discovery: "A fact learned about how the existing system works",
  none: "No lasting knowledge",
};

function distillStateV1(input: DistillInput) {
  return {
    user_prompt: input.prompt,
    assistant_final_message: input.finalText,
    files_changed: input.filesChanged,
    commands: input.commands,
    had_errors: input.hadErrors,
    candidates: input.candidates.map((candidate) => ({
      id: candidate.idx,
      said_by: candidate.source === "prompt" ? "user" : "assistant",
      text: candidate.text,
    })),
  };
}

function distillQuestionsV1(): Record<string, Question> {
  return {
    worth: {
      type: "noul",
      instructions:
        "Would a developer starting a new coding session on this repository weeks from now work better by knowing something stated in `user_prompt` or `assistant_final_message`?",
      criteria: {
        true: "It records a decision and its reason, a user correction or preference, a non-obvious pitfall and its fix, a project convention, or a lasting change to how the code works.",
        false:
          "Small talk, a status update, a question, a plan not yet carried out, a restatement of the request, or detail obvious from reading the code.",
      },
    },
    kind: {
      type: "choice",
      instructions: "What kind of lasting knowledge does this turn mainly contain?",
      criteria: KIND_CRITERIA_V1,
    },
    importance: {
      type: "score",
      instructions: "How costly would it be for a future session not to know this?",
      criteria: [
        "Trivial: nothing is lost",
        "Minor: saves a few minutes",
        "Useful: avoids a wrong turn or a repeated investigation",
        "Important: avoids a bug, a rejected approach, or repeating a user correction",
        "Critical: avoids data loss, a security problem, or breaking a hard project rule",
      ],
    },
  };
}

// --- Version 2 (ADR 0023) -------------------------------------------------------------
// Every question names the same reader, defined once in the state, and says what is not
// knowledge: a labelled sample showed that "stays true after the conversation" let records
// of a session through ("PR merged" stays true). The thresholds are in distill/policy.ts.

const READER =
  "a developer who joins this repository a month from now and never saw this conversation";
const KNOWLEDGE =
  "A standing rule or preference of the project or its author; a decision and the reason for it; the cause of a bug and what fixed it; a non-obvious pitfall, limitation or surprising behaviour; how a part of the system works or is configured.";
const RECORD =
  "What was done, delivered, committed, merged, opened, closed, approved or rejected in this session; the state of a task, a review, a gate or a plan; a question, an offer or small talk; a restatement of the request; detail obvious from reading the code.";

const KIND_CRITERIA: Record<MemoryKind | "none", string> = {
  decision:
    "A choice between alternatives and the reason for it. Not a verdict of a review, a gate or a test run, and not the approval of a plan.",
  fix: "A bug or error, its cause, and what resolved it. Not that a fix was delivered, committed or merged.",
  gotcha:
    "A non-obvious pitfall, limitation or surprising behaviour of the code, a tool or a service.",
  convention:
    "A standing rule or preference for how work is done in this project, from the author or the team. Not a step or a plan for this session.",
  change:
    "What is now true of the code's behaviour, structure or interfaces, stated as the new state. Not that something was done, committed, merged, closed or delivered.",
  discovery: "A fact learned about how the existing system works or is configured.",
  none: "A record of what happened in the session, a status, a plan, a question, small talk, or nothing lasting.",
};

/** The JSON state the questions refer to by path; version 2 adds `reader`. */
export function distillState(input: DistillInput) {
  if (input.wording === 1) return distillStateV1(input);
  return { reader: READER, ...distillStateV1(input) };
}

export function distillQuestions(input: DistillInput): Record<string, Question> {
  if (input.wording === 1) return distillQuestionsV1();
  const questions: Record<string, Question> = {
    worth: {
      type: "noul",
      instructions:
        "Does `user_prompt` or `assistant_final_message` state something that `reader` would work differently for knowing?",
      criteria: { true: KNOWLEDGE, false: RECORD },
    },
    kind: {
      type: "choice",
      instructions: "What kind of knowledge does this turn mainly contain, for `reader`?",
      criteria: KIND_CRITERIA,
    },
    importance: {
      type: "score",
      instructions:
        "How costly would it be for `reader` not to know this? Rate the knowledge in the sentences, not the amount of work the message reports.",
      criteria: [
        "Nothing: they would do the same without it",
        "Minutes: a detail they would find quickly in the code or the docs",
        "An investigation: a cause, a behaviour or a location that takes real time to find",
        "A mistake: a rule of the project, an approach already rejected, or a correction the author gave",
        "Damage: data loss, a security problem, or breaking a hard rule of the project",
      ],
    },
  };
  for (const candidate of input.candidates) {
    questions[`knowledge_${candidate.idx}`] = {
      type: "noul",
      instructions: `Would \`reader\` work differently for reading \`candidates[${candidate.idx}].text\` on its own, with nothing else from this conversation?`,
      criteria: {
        true: "On its own it states a standing rule or preference, a decision with its reason, a cause and its fix, a pitfall or surprising behaviour, or how something works or is configured.",
        false:
          "It reports what was done, delivered, committed, merged, opened, closed, approved or rejected; the state of a task, review, gate or plan; it is a question, an offer or an instruction to the person in the conversation; it is a heading, or it needs the rest of the conversation to be understood.",
      },
    };
  }
  if (input.candidates.length > 0) {
    questions.title = {
      type: "choice",
      instructions:
        "Which candidate, read by `reader` on its own, best states the knowledge of this turn: the rule, the decision and its reason, the cause and its fix, or the fact?",
      criteria: Object.fromEntries([
        ...input.candidates.map((candidate) => [
          `c${candidate.idx}`,
          candidate.text.slice(0, TITLE_MAX_CHARS),
        ]),
        ["none", "No candidate states knowledge on its own."],
      ]),
    };
  }
  return questions;
}

class MissingAnswer extends Error {
  constructor(id: string) {
    super(`no usable answer for "${id}"`);
    this.name = "MissingAnswer";
  }
}

const noul = (answers: Record<string, Answer>, id: string): number => {
  const answer = answers[id];
  if (answer?.type !== "noul" || typeof answer.noul !== "number") throw new MissingAnswer(id);
  return answer.noul;
};
const choice = (answers: Record<string, Answer>, id: string) => {
  const answer = answers[id];
  if (answer?.type !== "choice" || typeof answer.choice !== "string") throw new MissingAnswer(id);
  return answer;
};
const score = (answers: Record<string, Answer>, id: string) => {
  const answer = answers[id];
  if (answer?.type !== "score" || typeof answer.score !== "number") throw new MissingAnswer(id);
  return answer;
};

export function distillVerdict(
  input: DistillInput,
  answers: Record<string, Answer>,
): DistillVerdict {
  const kind = choice(answers, "kind");
  const kindValue = (MEMORY_KINDS as readonly string[]).includes(kind.choice)
    ? (kind.choice as MemoryKind)
    : "none";
  const importance = Math.min(5, Math.max(1, Math.round(score(answers, "importance").score) + 1));
  // `durable` keeps its name in the verdict: in version 2 it is the probability that the
  // sentence is knowledge on its own. Version 1 asks nothing per sentence (the import
  // rejudge sends no candidate), so no sentence counts as knowledge and there is no title.
  const perSentence = input.wording !== 1;
  const durable = input.candidates.map((candidate) =>
    perSentence ? noul(answers, `knowledge_${candidate.idx}`) : 0,
  );
  let titleIdx: number | null = null;
  if (perSentence && input.candidates.length > 0) {
    const title = choice(answers, "title").choice;
    const match = /^c(\d+)$/.exec(title);
    const idx = match ? Number(match[1]) : null;
    titleIdx = idx !== null && input.candidates.some((c) => c.idx === idx) ? idx : null;
  }
  return {
    worthSaving: noul(answers, "worth"),
    kind: kindValue,
    kindConfidence: kind.confidence,
    importance: importance as DistillVerdict["importance"],
    durable,
    titleIdx,
    source: "typesafe",
  };
}

export function consolidateState(input: ConsolidateInput) {
  return {
    new_memory: { title: input.draft.title, body: input.draft.body, files: input.draft.files },
    existing: input.neighbours.map((neighbour, i) => ({
      index: i,
      title: neighbour.title,
      body: neighbour.body,
      files: neighbour.files,
    })),
  };
}

export function consolidateQuestions(input: ConsolidateInput): Record<string, Question> {
  const questions: Record<string, Question> = {};
  input.neighbours.forEach((_, i) => {
    questions[`rel_${i}`] = {
      type: "score",
      instructions: `How does the information in \`new_memory\` relate to \`existing[${i}]\`?`,
      criteria: [
        "They are about different things",
        "Same topic, but each carries information the other lacks",
        "They state the same information",
      ],
    };
    questions[`contra_${i}`] = {
      type: "noul",
      instructions: `Does \`new_memory\` state something that makes \`existing[${i}]\` no longer true or no longer the current approach?`,
      criteria: {
        true: "The new memory reverses, replaces or corrects what the existing one says.",
        false: "Both can be true at the same time.",
      },
    };
  });
  return questions;
}

export function consolidateVerdict(
  input: ConsolidateInput,
  answers: Record<string, Answer>,
): ConsolidateVerdict {
  return {
    source: "typesafe",
    perNeighbour: input.neighbours.map((neighbour, i) => {
      const relationScore = score(answers, `rel_${i}`).score;
      const relation =
        relationScore >= 1.5 ? "same" : relationScore >= 0.5 ? "related" : "different";
      return {
        id: neighbour.id,
        relation,
        relationScore,
        contradicts: noul(answers, `contra_${i}`),
      };
    }),
  };
}

export function personalState(input: PersonalInput) {
  return { rule: { title: input.title, body: input.body }, projects: input.projects };
}

export function personalQuestions(): Record<string, Question> {
  return {
    personal: {
      type: "noul",
      instructions:
        "Is `rule` the developer's own way of working, one that would hold in any repository they work on, rather than something true only of the code in `projects`?",
      criteria: {
        true: "A personal habit or preference: how to test, commit, write documents, name things or work with tools, wherever the developer works.",
        false:
          "A fact, constraint or choice about these projects' own code, data, architecture or dependencies, which another repository would not share.",
      },
    },
  };
}

export function personalVerdict(answers: Record<string, Answer>): PersonalVerdict {
  const p = noul(answers, "personal");
  return p >= 0.5 ? { personal: true, confidence: p } : { personal: false, confidence: 1 - p };
}
