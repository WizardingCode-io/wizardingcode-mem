import { describe, expect, test } from "bun:test";
import type { Redacted } from "../../src/core/redact.ts";
import { SAVE_THRESHOLD } from "../../src/distill/policy.ts";
import { heuristicJudge, heuristicJudgeV1 } from "../../src/judge/heuristic.ts";
import type { ConsolidateInput } from "../../src/judge/types.ts";
import { distillInput } from "../helpers/judge-input.ts";

const distill = (...args: Parameters<typeof distillInput>) =>
  heuristicJudge.distill(distillInput(...args));

/** Durability the judge gives to the candidate containing `fragment`. */
async function durability(prompt: string, finalText: string, fragment: string): Promise<number> {
  const input = distillInput(prompt, finalText);
  const verdict = await heuristicJudge.distill(input);
  const candidate = input.candidates.find((c) => c.text.includes(fragment));
  if (candidate === undefined) throw new Error(`no candidate contains "${fragment}"`);
  return verdict.durable[candidate.idx] as number;
}

describe("heuristic judge: is the turn worth saving", () => {
  test("identifies itself", async () => {
    expect(heuristicJudge.name).toBe("heuristic");
    expect((await distill("x", "y")).source).toBe("heuristic");
  });

  test("a bug fixed after an error is kept, as an important fix", async () => {
    const verdict = await distill(
      "The tests fail with a timeout",
      "Fixed: the root cause was the busy timeout being set after the first query. Moved the pragma to the top of openDb in src/store/db.ts.",
      { filesChanged: ["src/store/db.ts"], hadErrors: true },
    );
    expect(verdict.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(verdict.kind).toBe("fix");
    expect(verdict.importance).toBeGreaterThanOrEqual(3);
  });

  test("a user's correction is kept even when the answer is one word", async () => {
    const verdict = await distill(
      "No, never mock the database in these tests. Always use a real SQLite file.",
      "Understood.",
    );
    expect(verdict.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(verdict.kind).toBe("convention");
    expect(verdict.importance).toBeGreaterThanOrEqual(3);
  });

  test("the same in Portuguese", async () => {
    const correction = await distill(
      "Não uses mocks nestes testes. Usa sempre um ficheiro SQLite real.",
      "Entendido.",
    );
    expect(correction.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(correction.kind).toBe("convention");

    const fix = await distill(
      "os testes falham com timeout",
      "Corrigido: a causa raiz era o busy_timeout ser definido depois da primeira consulta em src/store/db.ts.",
      { filesChanged: ["src/store/db.ts"], hadErrors: true },
    );
    expect(fix.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(fix.kind).toBe("fix");
  });

  test("a decision with its reason is kept without any file being touched", async () => {
    const verdict = await distill(
      "Should we use Chroma or FTS5?",
      "We decided to use FTS5 instead of a vector store because it needs no extra process and ships inside SQLite.",
    );
    expect(verdict.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(verdict.kind).toBe("decision");
  });

  test("a pitfall is kept as a gotcha", async () => {
    const verdict = await distill(
      "why does it fail only sometimes?",
      "Note that `PRAGMA journal_mode` does not honour busy_timeout, so processes creating the database together must retry by hand.",
      { filesChanged: ["src/store/db.ts"] },
    );
    expect(verdict.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(verdict.kind).toBe("gotcha");
    expect(verdict.importance).toBeGreaterThanOrEqual(3);
  });

  test.each([
    ["small talk", "thanks!", "You're welcome! Let me know if you need anything else.", {}],
    [
      "a question answered from the code",
      "What does this function do?",
      "It reads the config file and returns the parsed object.",
      {},
    ],
    [
      "a trivial edit",
      "fix the typo in the README",
      "Fixed the typo.",
      { filesChanged: ["README.md"] },
    ],
    [
      "an error that was not resolved",
      "why is the build failing?",
      "The error persists. I will keep looking at the failing linker step.",
      { hadErrors: true },
    ],
    ["a turn with no answer", "deploy it", "", {}],
  ])("%s is not kept", async (_label, prompt, finalText, extra) => {
    const verdict = await distill(prompt, finalText, extra);
    expect(verdict.worthSaving).toBeLessThan(SAVE_THRESHOLD);
  });

  // Words like "don't", "must", "always" and "instead" appear in ordinary requests,
  // questions and complaints. Only a standing rule is worth every later session's attention.
  test.each([
    "I don't understand why this test fails, can you take a look?",
    "Can you use a map instead of a for loop in this one function?",
    "Use a map instead of a for loop in this function.",
    "Should I use a class here instead of a plain object?",
    "There must be a simpler way to write this query.",
    "This should not happen, the build was green yesterday.",
    "You must be joking, that deleted my changes!",
    "Don't worry about the tests for now, just make it compile.",
    "I always forget the syntax for this, how do I destructure an array?",
    "It always fails on the second run of the suite.",
    "Tem de haver uma forma mais simples de fazer este loop, não?",
    "Não quero perder tempo com isto agora, vê só se compila.",
    "Isto falha sempre na segunda execução dos testes.",
    "Podes usar um map em vez de um ciclo for aqui?",
  ])("a passing remark is not a standing rule: %s", async (prompt) => {
    const verdict = await distill(prompt, "Sure, I'll take a look at that now.");
    expect(verdict.worthSaving).toBeLessThan(SAVE_THRESHOLD);
  });

  test.each([
    "Never commit directly to the main branch.",
    "From now on, commit messages must be in English.",
    "No, don't use mocks for the database here.",
    "We always test against a real SQLite file.",
    "Commit messages must follow conventional commits.",
    "I prefer small commits with one change each.",
    "Não uses mocks nestes testes de integração.",
    "A partir de agora, os commits são sempre em inglês.",
    "Não quero um fork, quero fazer isto de raiz.",
  ])("a standing rule is kept: %s", async (prompt) => {
    const verdict = await distill(prompt, "Understood.");
    expect(verdict.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
    expect(verdict.kind).toBe("convention");
  });

  test("a turn that is not kept has no kind, no title and the lowest importance", async () => {
    expect(await distill("thanks!", "You're welcome!")).toMatchObject({
      kind: "none",
      titleIdx: null,
      importance: 1,
    });
  });

  test("security and production matters weigh more", async () => {
    const plain = await distill(
      "tidy the logger",
      "Fixed: the root cause was a duplicated handler in src/util/log.ts, so each line was written twice.",
      { filesChanged: ["src/util/log.ts"] },
    );
    const grave = await distill(
      "tidy the logger",
      "Fixed: the root cause was a credential written to the log in production by src/util/log.ts.",
      { filesChanged: ["src/util/log.ts"] },
    );
    expect(grave.importance).toBeGreaterThan(plain.importance);
  });
});

describe("heuristic judge: which sentences are durable", () => {
  test("rates every candidate, in order", async () => {
    const input = distillInput(
      "Always run the linter before committing.",
      "Added a pre-commit check. It runs the linter on staged files only.",
    );
    const verdict = await heuristicJudge.distill(input);
    expect(verdict.durable).toHaveLength(input.candidates.length);
    for (const p of verdict.durable) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  test.each([
    "Next, I will update the documentation as well.",
    "Would you like me to also add tests for this?",
    "Let me know if this works for you now.",
    "Vou agora atualizar a documentação do projeto.",
    "Queres que acrescente também os testes disto?",
  ])("a plan, an offer or a question is not durable: %s", async (sentence) => {
    const prefix = "The lease is released in a finally block because a crash used to leak it.";
    expect(await durability("go", `${prefix} ${sentence}`, sentence.slice(0, 20))).toBeLessThan(
      0.5,
    );
  });

  test("a statement of cause with an identifier is durable", async () => {
    expect(
      await durability(
        "go",
        "The lease was never released because `finishTurn` was skipped when the judge threw.",
        "finishTurn",
      ),
    ).toBeGreaterThanOrEqual(0.5);
  });

  test("a sentence that leans on the conversation is less durable than one that stands alone", async () => {
    const alone = await durability(
      "go",
      "The drain lease was never released by the worker because the finally block was skipped.",
      "drain lease",
    );
    const leaning = await durability(
      "go",
      "It was never released by the worker because the finally block was skipped.",
      "never released",
    );
    expect(alone).toBeGreaterThan(leaning);
  });

  test("in the prompt, an instruction for now is not durable but a standing rule is", async () => {
    expect(
      await durability("Fix the login bug in the session module.", "Done.", "login bug"),
    ).toBeLessThan(0.5);
    expect(
      await durability("Never commit directly to the main branch.", "Done.", "Never commit"),
    ).toBeGreaterThanOrEqual(0.5);
  });

  test("the title is a durable sentence short enough to be one", async () => {
    const input = distillInput(
      "the queue loses turns",
      "Fixed: the root cause was that turns were opened at turn end, so interrupted turns were never queued. Turns now open at the prompt in src/hooks/handle.ts.",
      { filesChanged: ["src/hooks/handle.ts"], hadErrors: true },
    );
    const verdict = await heuristicJudge.distill(input);
    const title = input.candidates.find((c) => c.idx === verdict.titleIdx);
    expect(title).toBeDefined();
    expect(title?.text.length).toBeLessThanOrEqual(120);
    expect(verdict.durable[title?.idx as number]).toBeGreaterThanOrEqual(0.5);
  });

  test("for a correction, the title is the user's own rule", async () => {
    const input = distillInput(
      "No, never mock the database in these tests. Always use a real SQLite file.",
      "Understood, I switched the tests to a temporary database file.",
    );
    const verdict = await heuristicJudge.distill(input);
    expect(input.candidates.find((c) => c.idx === verdict.titleIdx)?.source).toBe("prompt");
  });
});

describe("heuristic judge: how a new memory relates to existing ones", () => {
  const body = (text: string) => text as Redacted;
  const input = (
    draft: { title: string; body: string; files?: string[] },
    neighbour: { title: string; body: string; files?: string[] },
  ): ConsolidateInput => ({
    draft: {
      title: draft.title,
      body: body(draft.body),
      kind: "decision",
      files: draft.files ?? [],
    },
    neighbours: [
      { id: 7, title: neighbour.title, body: body(neighbour.body), files: neighbour.files ?? [] },
    ],
  });
  const relate = async (...args: Parameters<typeof input>) =>
    (await heuristicJudge.consolidate(input(...args))).perNeighbour[0];

  test("the same statement about the same files is the same memory", async () => {
    const verdict = await relate(
      {
        title: "The hook opens the turn at the prompt",
        body: "Turns open at the prompt so interrupted turns are queued.",
        files: ["src/hooks/handle.ts"],
      },
      {
        title: "The hook opens the turn at the prompt event",
        body: "Turns open at the prompt, so interrupted turns are still queued.",
        files: ["src/hooks/handle.ts"],
      },
    );
    expect(verdict).toMatchObject({ id: 7, relation: "same" });
    expect(verdict?.contradicts).toBeLessThan(0.5);
  });

  test("a statement that replaces an older one contradicts it", async () => {
    const verdict = await relate(
      {
        title: "The retry limit is now five",
        body: "The retry limit is five; it is no longer three attempts.",
      },
      { title: "The retry limit is three", body: "The retry limit is three attempts." },
    );
    expect(verdict?.relation).not.toBe("different");
    expect(verdict?.contradicts).toBeGreaterThanOrEqual(0.7);
  });

  test("the same in Portuguese", async () => {
    const verdict = await relate(
      {
        title: "O limite de tentativas passou a cinco",
        body: "O limite de tentativas é cinco; já não são três tentativas.",
      },
      {
        title: "O limite de tentativas é três",
        body: "O limite de tentativas são três tentativas.",
      },
    );
    expect(verdict?.contradicts).toBeGreaterThanOrEqual(0.7);
  });

  test("repeating a statement that already says what it replaced does not contradict it", async () => {
    const statement = {
      title: "The retry limit is now five",
      body: "The retry limit is five; it is no longer three attempts.",
    };
    const verdict = await relate(statement, statement);
    expect(verdict?.relation).toBe("same");
    expect(verdict?.contradicts).toBeLessThan(0.5);
  });

  test("unrelated statements are different", async () => {
    const verdict = await relate(
      { title: "FTS5 folds diacritics", body: "The tokenizer removes diacritics before matching." },
      {
        title: "Hooks exit zero",
        body: "A hook never exits with code two, which would block the host.",
      },
    );
    expect(verdict).toMatchObject({ relation: "different" });
    expect(verdict?.contradicts).toBeLessThan(0.5);
  });

  test("similar words about different files are related, not the same", async () => {
    const verdict = await relate(
      {
        title: "The command validates its arguments first",
        body: "The command validates its arguments before opening the database.",
        files: ["src/cli/commands/status.ts"],
      },
      {
        title: "The command validates its arguments first",
        body: "The command validates its arguments before opening the database.",
        files: ["src/cli/commands/doctor.ts"],
      },
    );
    expect(verdict?.relation).toBe("related");
  });
});

describe("heuristic judge, version 2: records of a session", () => {
  test("identifies as version 2", () => {
    expect(heuristicJudge.version).toBe("2");
    expect(heuristicJudge.versions).toEqual({ heuristic: "2" });
  });

  test("a sentence that reports a merge with its hash is not durable", async () => {
    expect(
      await durability(
        "merge it",
        "PR #2941 MERGED em `dev` — merge commit `b3282d5fe`, confirmado no remoto.",
        "MERGED",
      ),
    ).toBeLessThan(0.5);
  });

  test("a verdict line and a test count are not durable", async () => {
    expect(
      await durability(
        "status?",
        "Quality Gate verdict for round 2: REJECTED, two findings in src/gate.ts.",
        "REJECTED",
      ),
    ).toBeLessThan(0.5);
    expect(
      await durability(
        "run them",
        "All 286/286 tests pass after the change to src/store/db.ts.",
        "286/286",
      ),
    ).toBeLessThan(0.5);
  });

  test("a cause with a path keeps its durability", async () => {
    expect(
      await durability(
        "why?",
        "The cause was a pending timer in src/hooks/stop.ts that kept the process alive.",
        "pending timer",
      ),
    ).toBeGreaterThanOrEqual(0.5);
  });

  test("a report with a cue word in it is not worth saving when every sentence is a report", async () => {
    const verdict = await distill(
      "merge it",
      "Fixed and merged: PR #88 merged after the gate PASSED. Wave 4 closed in `909ce45cf`. All 120/120 tests pass.",
    );
    expect(verdict.worthSaving).toBeLessThan(SAVE_THRESHOLD);
  });

  test("an answer that is mostly a report is not worth saving, even after edits", async () => {
    const verdict = await distill(
      "close the wave",
      "Wave 4 closed in `909ce45cf` and pushed to `origin/dev`. PR #88 merged after the gate PASSED. All 120/120 tests pass on src/app/index.ts.",
      { filesChanged: ["src/app/index.ts"] },
    );
    expect(verdict.worthSaving).toBeLessThan(SAVE_THRESHOLD);
  });
});

describe("heuristic judge, version 1: the report signals off", () => {
  test("identifies as version 1", () => {
    expect(heuristicJudgeV1.version).toBe("1");
    expect(heuristicJudgeV1.versions).toEqual({ heuristic: "1" });
  });

  test("report sentences keep their version 1 durability, and a report answer its worth", async () => {
    const merge = distillInput(
      "merge it",
      "PR #2941 MERGED em `dev` — merge commit `b3282d5fe`, confirmado no remoto.",
    );
    expect((await heuristicJudgeV1.distill(merge)).durable).toEqual([0.6]);
    const report = await heuristicJudgeV1.distill(
      distillInput(
        "merge it",
        "Fixed and merged: PR #88 merged after the gate PASSED. Wave 4 closed in `909ce45cf`. All 120/120 tests pass.",
      ),
    );
    expect(report.worthSaving).toBeGreaterThanOrEqual(SAVE_THRESHOLD);
  });

  test("on a turn with no report signal, both versions answer the same", async () => {
    const input = distillInput(
      "why?",
      "The cause was a pending timer in src/hooks/stop.ts that kept the process alive.",
    );
    expect(await heuristicJudgeV1.distill(input)).toEqual(await heuristicJudge.distill(input));
  });
});
