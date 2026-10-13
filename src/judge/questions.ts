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
const KIND_CRITERIA: Record<MemoryKind | "none", string> = {
  decision: "A choice between alternatives, with its rationale",
  fix: "A bug or error and what resolved it",
  gotcha: "A non-obvious pitfall, limitation or surprising behaviour",
  convention: "A rule or preference for how work is done in this project",
  change: "A lasting change to behaviour, structure or interfaces",
  discovery: "A fact learned about how the existing system works",
  none: "No lasting knowledge",
};

export function distillState(input: DistillInput) {
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

export function distillQuestions(input: DistillInput): Record<string, Question> {
  const questions: Record<string, Question> = {
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
      criteria: KIND_CRITERIA,
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
  for (const candidate of input.candidates) {
    questions[`durable_${candidate.idx}`] = {
      type: "noul",
      instructions: `Is \`candidates[${candidate.idx}].text\` a fact about this project that stays true and useful after this conversation ends, and can be understood without the rest of the conversation?`,
      criteria: {
        true: "A self-contained statement of a decision, cause, fix, rule, constraint, or how something works.",
        false:
          "Progress narration, an offer or question to the user, a statement that needs the conversation to be understood, or a transient state.",
      },
    };
  }
  if (input.candidates.length > 0) {
    questions.title = {
      type: "choice",
      instructions:
        "Which candidate works best alone as a one-line title for what was learned in this turn?",
      criteria: Object.fromEntries([
        ...input.candidates.map((candidate) => [
          `c${candidate.idx}`,
          candidate.text.slice(0, TITLE_MAX_CHARS),
        ]),
        ["none", "No candidate works as a title"],
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
  const durable = input.candidates.map((candidate) => noul(answers, `durable_${candidate.idx}`));
  let titleIdx: number | null = null;
  if (input.candidates.length > 0) {
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
