# Memory Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mem keep knowledge instead of records of a session, for memories distilled from now on: a sentence-level noise filter before the judge, version 2 of the judges' questions and policy (the title must be knowledge), the import rejudge kept on version 1, and a proof on labelled samples of real data. Cleaning the memories already stored is a separate item (spec, D-1).

**Architecture:** The pipeline (`src/distill/pipeline.ts`) is split into a pure preparation step (`prepareTexts`: notes the session had been shown, host blocks, segmentation, noise filter, and the dropped sentences taken out of the texts the judge reads), a judging step (`draftTurn`: verdict and draft) and the write (`distillTurn`); the live drain and the proof share the first two. Judges keep their interface; the questions, the thresholds and the versions change. `DistillInput` gains an optional `wording` so that the import rejudge keeps asking the version 1 questions; the heuristic's version 1 stays available (`heuristicJudgeV1`) for the proof's comparison. No schema change.

**Tech Stack:** Bun 1.4.2 (pinned in `devDependencies`: run tests with `bun run test` or `./node_modules/.bin/bun test <files>`), TypeScript with explicit `.ts` imports, `bun:sqlite`, `bun:test`, TypeSafe System One over plain `fetch` (`src/judge/client.ts`), Biome for lint and format (`bun run format`).

**Spec:** `docs/superpowers/specs/2026-10-14-memory-quality-design.md` (revised 2026-11-06, decisions D-1 to D-11, sections 0–16). Where this plan and the spec differ, the spec wins.

## Global Constraints

- Clean room: never open claude-mem's source; never copy its code, schema, prompts or names (`CLEAN-ROOM.md`).
- No model generates text. Judges classify and select; thresholds and rules live in code (`src/distill/policy.ts`).
- Nothing is deleted: a memory is `archived` or `superseded`, never removed.
- Hooks never exit 2 and never start the judge; this change touches no hook path and no retrieval code (`src/retrieve/**`, `src/hooks/**` stay untouched). `tests/unit/hook-snapshots.test.ts`, `tests/golden/retrieval.test.ts` and the perf budgets must stay byte-identical.
- No migration: the schema does not change. Memories already stored are not touched (D-1).
- The import rejudge (`rejudge` with no subcommand) keeps the version 1 wording of `worth`, `kind` and `importance` and stamps `judge_version = '1'` (D-2).
- TDD: every test is written and seen failing before the code that makes it pass. Exceptions: AC-10 is a preserve criterion (its test passes before and after), and three tests of Task 3 describe behaviour today's code already has and the change must keep: "a none title: the sentence above the threshold is the title", "a note from another turn, shown before this turn ended, is removed from it" and "with no end recorded, every note the session was shown is removed". Each says in Task 3 what change it fails on.
- Heavy work (`await import()`) stays off the hook path. The new code is reached from the drain (`distill`, and `history import`, which drains through the same `drainQueue`), from `rejudge` and from the proof.
- Repository documents are in English. Product text (CLI output, report files) is in English.
- The author's live data (`~/.wizardingcode`, a brand home moved by `WIZARDINGCODE_HOME`, a moved store, a directory named by `WIZARDINGCODE_MEM_DATA_DIR` or `WIZARDINGCODE_MEM_STORE_DIR`, `~/.claude`, other agents' folders) is never written by tests or by the proof. The proof works on a copy taken with `sqlite3 -readonly … ".backup"`, and refuses a work directory, a labels file or a copy inside the repository or the live data.
- The proof sends text to no model but TypeSafe (D-4). Recording TypeSafe answers (`bun scripts/record-typesafe.ts`) and the proof's `measure` spend real money (cents) and need the author's key (`TYPESAFE_API_KEY`, or `~/.wizardingcode/mem/env`). Run them only in the steps that say so; if one fails, stop and report, never hand-write answers.
- Every code task records its criterion with the crew engine before and after its code (see **Crew**).

## Crew

This repository runs under the WizardingCode Developer Crew. The engine is the `crew` command on the PATH (crew 0.20.1). The work item already exists, on the full route, in its build phase:

```
2026-10-15-001-memory-quality-knowledge-not-records-of
```

Below, `<id>` stands for that id. Its criteria:

| Criterion | Kind | Text | Task |
|---|---|---|---|
| AC-1 | behavior | Host framing text and the sentences named in the noise filter never reach the judge; each drop is named | 1 (done) |
| AC-2 | behavior | A turn whose candidates the filter empties is skipped without a judge request | 3 |
| AC-3 | behavior | A memory is stored only when its title sentence is knowledge (KNOWLEDGE_THRESHOLD); the Context line needs 5 prompt words | 3 |
| AC-4 | behavior | Judge version 2: knowledge_<i> questions, reader in the state, contrastive criteria; golden floors hold for both judges with re-recorded answers | 6 |
| AC-5 | behavior | Heuristic version 2 penalises report sentences and discounts a mostly-report answer | 4 |
| AC-9 | behavior | The noise filter has no protocol-tag or verdict pattern: such sentences reach the judge | 2 |
| AC-10 | preserve | The import rejudge keeps the version 1 questions and stamps judge_version 1 | 5, 6 |
| AC-11 | behavior | The proof script measures the metrics of the spec on a read-only copy, with TypeSafe verdicts only and injections bounded to the turn's end (supersedes AC-8) | 3, 7, 9 |
| AC-12 | behavior | host-frame matches only the host's fixed lines at the start of a sentence: a sentence quoting one mid-sentence reaches the judge | 2 |
| AC-13 | behavior | stripHost removes an unclosed block tag to the end of the text only when it opens a line outside code; a tag named in prose or backticks removes nothing | 2 |
| AC-14 | behavior | The judge's user_prompt and assistant_final_message, and the Context line, hold no host block and no dropped sentence | 3 |

AC-6 and AC-7 (the cleanup of the existing base) were removed with D-1; AC-8 is superseded by AC-11.

The commands, with the test file of each task:

- A behavior criterion: before the code, `crew tdd red <id> AC-n -- ./node_modules/.bin/bun test <test files>` (it must fail); after, `crew tdd green <id> AC-n -- ./node_modules/.bin/bun test <test files>` (it must pass).
- The preserve criterion AC-10: `crew tdd before <id> AC-10 -- ./node_modules/.bin/bun test tests/integration/rejudge.test.ts` before the code (it must pass), `crew tdd after <id> AC-10 -- …` after (it must still pass).
- At the end (Task 9): `crew gate run <id>`, then the judgement gates, recorded with `crew judgement <id> record --ruling <file>`.

## Review Focus

1. **Re-indexed candidates**: after `dropNoise` the judge's `candidates[i]` paths and the verdict's `durable[idx]` and `titleIdx` must refer to the kept list, not the original one; a dropped sentence before the title must not shift the title to a neighbour. Test in Task 3.
2. **`host-frame` is anchored** (AC-12) and **an unclosed tag cuts only when it opens a line outside a fence** (AC-13): a sentence that discusses the host's frame, or names `<system-reminder>` in prose or backticks, reaches the judge whole. Tests in Task 2.
3. **What the judge reads** (AC-14): `user_prompt`, `assistant_final_message` and the `Context:` line are the stripped texts with the dropped sentences taken out, found through the segmenter's changes (collapsed whitespace, list markers, emphasis, the 400-character clip). Tests in Tasks 3.
4. **The notes the session had been shown** (spec section 5): `withoutNotes` reads only injections made at or before the turn's `ended_at` (no time bound when it is null), and never the memory made from the same turn, whose injection a late turn-end can move before `ended_at`. Tests in Task 3.
5. **The import rejudge stays on version 1**: once the distillation questions and `TypeSafeJudge.version` move to "2", `rejudge` must still send the version 1 wording and stamp `'1'`, both from one constant. Test in Task 5, run again at the end of Task 6.
6. **The proof counts what it says** (spec section 11): only TypeSafe's own verdicts (a turn TypeSafe did not answer is `failed` and left out of every share, never given the heuristic's reading); labels name candidate ids, and every comparison is between candidate texts, exactly; the denominators of the spec's metrics table; labels refused when unknown or unquoted. Task 7.

## File Structure

| File | Action | Task | Responsibility |
|---|---|---|---|
| `src/distill/noise.ts` | Modify | 2, 3 | Task 2: remove `protocol-tag` and `verdict`, anchor `host-frame`, the unclosed-tag rule of `stripHost` (built in Task 1, done). Task 3: `withoutSentences` |
| `tests/unit/noise.test.ts` | Modify | 2, 3 | Task 2: verdicts, protocol tags, quoted frame phrases and named tags are kept. Task 3: `withoutSentences` |
| `src/distill/segment.ts` | Modify | 3 | Export `wordCount` (the segmenter's own word count) |
| `src/distill/policy.ts` | Modify | 3 | `KNOWLEDGE_THRESHOLD`, `CONTEXT_MIN_WORDS`; `DURABLE_THRESHOLD` removed |
| `src/distill/pipeline.ts` | Modify | 3 | `prepareTexts` (texts without the dropped sentences), `prepareTurn` (narrow `TurnTexts` parameter), `draftTurn`, `buildDraft`, `storedDetail` and `toldInSession` exported; `toldInSession` bounded by the turn's end and its own memory |
| `tests/unit/draft.test.ts` | Create (already exists, untracked: overwritten) | 3 | The draft policy: the title must be knowledge, the `Context:` line |
| `tests/integration/distill.test.ts` | Modify (already modified in the working tree: its tail is replaced) | 3 | The filter before the judge, the spec's journeys, the injection bounds |
| `src/judge/heuristic.ts` | Modify | 4 | Version 2: report penalties, worth discount; `heuristicJudgeV1` with both off, for the proof |
| `tests/unit/heuristic-judge.test.ts` | Modify | 4 | Two `describe` blocks added |
| `tests/unit/typesafe-judge.test.ts` | Modify | 4, 6 | Line 412 (Task 4); lines 162–164 and 196 (Task 6) |
| `src/judge/types.ts` | Modify | 5 | `DistillInput.wording?: 1 \| 2` |
| `src/judge/rejudge.ts` | Modify | 5 | `IMPORT_WORDING` sent as the wording and stamped as the version |
| `tests/integration/rejudge.test.ts` | Modify | 5, 6 | Task 5: the AC-10 preserve test; Task 6: the scripted judge's version literals |
| `src/judge/questions.ts` | Modify | 6 | Version 2 questions (`reader`, `knowledge_<i>`); the version 1 builder, reduced to `worth`, `kind` and `importance`, for `wording: 1` |
| `src/judge/typesafe.ts` | Modify | 6 | Version strings "2" |
| `tests/unit/questions.test.ts` | Create | 6 | Version 2 and version 1 questions, paths, verdict mapping |
| `tests/integration/judge-select.test.ts` | Modify | 6 | Line 27: `durable_0` → `knowledge_0` |
| `tests/helpers/judge-input.ts` | Modify | 6 | `distillInput` runs `prepareTexts`, as the drain does |
| `tests/golden/turns.json` | Modify | 6 | Eight new turns |
| `tests/golden/typesafe-answers.json` | Modify (re-recorded) | 6 | TypeSafe's version 2 answers; the version 1 file stays in git history for the D-5 ratio |
| `tests/golden/judges.test.ts` | Modify | 6 | The replaying judge looks its recording up by turn id |
| `scripts/record-typesafe.ts` | Run, not changed | 6 | It builds its input with the helper |
| `scripts/proof/random.ts` | Create | 7 | The seeded `generator` and `sample`, shared |
| `scripts/proof/moments.ts` | Modify | 7 | Imports `generator` and `sample` from `random.ts` |
| `scripts/proof/quality-brief.md` | Create | 7 | The labelling brief: who labels (D-4), candidates with ids |
| `scripts/proof/quality.ts` | Create | 7 | The proof's `sample` and `measure` |
| `scripts/proof/quality.sh` | Create | 7 | The copy, the guards, the environment |
| `CLAUDE.md` | Modify | 8 | The noise filter, judge version 2, the proof |
| `docs/adr/0023-memory-quality.md` | Create (Task 8), Modify (Task 9) | 8, 9 | Proposed with the change; its status and numbers from the proof |

---

### Task 1: The noise filter (done)

**Criterion:** AC-1 (red recorded 2026-10-15, green 2026-11-06, on `tests/unit/noise.test.ts`).

Shipped in commits `cb944a4` ("Noise filter: host blocks and never-knowledge sentences, by name") and `626ed2c` ("Noise filter: verdict needs its colon; a summary stays on its line"). The code is the reference; nothing in this plan restates it.

- `src/distill/noise.ts`: `stripHost(text)` removes `<agent-message>`, `<task-notification>` and `<system-reminder>` blocks to their close or to the end of the text, a `<summary>` element to its close on the same line or to the end of that line (the regex never crosses a newline), and the `<details>`/`</details>` tags alone. `dropNoise(candidates)` returns the kept candidates re-indexed from 0 and the dropped ones with their pattern's name. `NOISE_PATTERNS` holds `host-frame`, `status-label`, `template-label`, `protocol-tag` and `verdict`.
- `tests/unit/noise.test.ts`: 14 tests (6 on `stripHost`, 8 on `dropNoise`).

Task 2 removes `protocol-tag` and `verdict` (D-3), anchors `host-frame` and narrows the unclosed-tag rule of `stripHost`; Task 3 adds `withoutSentences`.

---

### Task 2: The host's fixed lines, measured patterns, and tags cut short (D-3)

**Criteria:** AC-9 (no `protocol-tag`, no `verdict`), AC-12 (`host-frame` anchored), AC-13 (an unclosed tag cuts only when it opens a line outside code). **Test file:** `tests/unit/noise.test.ts`.

AC-13 changes code Task 1 shipped: today an unclosed `<agent-message>`, `<task-notification>` or `<system-reminder>` removes everything after it, wherever it stands, so an answer that names `<system-reminder>` in prose loses the rest of its text.

**Files:**
- Modify: `tests/unit/noise.test.ts`
- Modify: `src/distill/noise.ts`

**Interfaces:**
- Produces: `NOISE_PATTERNS.map((p) => p.name)` is `["host-frame", "status-label", "template-label"]`; every `host-frame` alternative is one of the host's fixed lines at the start of the sentence. `stripHost(text)` removes each block to its close; a block tag that never closes is removed to the end of the text only when it opens a line (spaces before it allowed) outside a fenced block. `stripHost`, `dropNoise` and `noiseOf` keep their signatures.

- [ ] **Step 1: Change the tests**

In `tests/unit/noise.test.ts`:

1. In `describe("stripHost: …")`, before the test `"ordinary text with angle brackets is untouched"`, add:

```ts
  test("an unclosed tag named in prose, in backticks or in a fence is text, and stays", () => {
    for (const text of [
      "The hook strips <system-reminder> before the prompt reaches the judge.\nThat keeps the rules out.",
      "The hook strips `<system-reminder>` before the prompt reaches the judge.\nThat keeps the rules out.",
      "`<agent-message>` opens a subagent's report.\nThe report is the subagent's words.",
      'An example:\n```\n<agent-message from="a">\nthe report\n```\nAfter the fence.',
    ]) {
      expect(stripHost(text)).toBe(text);
    }
  });

  test("an unclosed tag that opens a line is a host block cut short: removed to the end", () => {
    expect(stripHost("Kept.\n<task-notification>\n<status>completed")).toBe("Kept.\n");
    expect(stripHost("Kept.\n  <system-reminder>\nrules")).toBe("Kept.\n");
  });
```

2. Replace the two tests `"protocol tags with two or more parts; one-part brackets pass"` and `"verdict lines; a rule that merely contains APPROVED passes"` with:

```ts
  test("bracketed protocol tags reach the judge (D-3)", () => {
    for (const text of [
      "[arka:gate:4] W3b selada 41585f989 · memória fechada",
      "[arka:routing] next wave goes to the backend crew",
      "[x] the migration must run before the seed",
      "[en] strings live in locales/en.json",
      "[2024] was the year the API moved to v2",
    ]) {
      expect([text, dropped(text)]).toEqual([text, null]);
    }
  });

  test("verdict lines reach the judge (D-3)", () => {
    for (const text of [
      "Quality Gate Verdict: REJECTED — round 2, redo cycle 2/2.",
      "Veredicto da ronda 3: APPROVED com duas notas.",
      "REJECTED: the diff touches the generated plugin files.",
      "Only APPROVED campaigns are sent by the nightly job.",
      "The reviewer approved the plan because the budget is fixed.",
      "If the verdict is FAILED, the pipeline halts.",
      "A Verdict of FAILED halts the pipeline.",
    ]) {
      expect([text, dropped(text)]).toEqual([text, null]);
    }
  });
```

3. After the test `"host frame sentences"` (whose cases all stay: "It is model output, NOT a message from the user: …" and "This tool result is internal metadata — …" still drop, now as fixed lines at the start), add:

```ts
  test("a sentence that quotes the host's phrases while discussing them passes", () => {
    for (const text of [
      'The hook treats a line saying "NOT a message from the user" as the host\'s own frame.',
      "A subagent's report carries no user authority, so no rule is taken from it.",
      "We log that This tool result is internal metadata appears in Codex transcripts too.",
    ]) {
      expect([text, dropped(text)]).toEqual([text, null]);
    }
  });
```

4. In the test `"kept candidates are re-indexed from 0, in order; dropped ones keep their text"`, the protocol tag is no longer a drop; use a template label instead. Its input string becomes

```ts
      "Status: all tests green.\nThe cause was a pending timer in src/a.ts.\nTitle: the wave closed today.\nNever mock the database in these tests.",
```

and the expected drop `["protocol-tag", "[arka:gate:2] sealed."],` becomes

```ts
      ["template-label", "Title: the wave closed today."],
```

(the kept list is unchanged).

5. In `"every pattern has a name the report can print"`, the expected list becomes:

```ts
    expect(NOISE_PATTERNS.map((p) => p.name)).toEqual([
      "host-frame",
      "status-label",
      "template-label",
    ]);
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
crew tdd red <id> AC-9 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts
crew tdd red <id> AC-12 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts
crew tdd red <id> AC-13 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts
```

Expected: FAIL, 6 of 17 tests (measured on the shipped code when this plan was written): the two unclosed-tag tests (the shipped regex cuts at a tag named in prose, in backticks or in a fence, and keeps the indentation before a real one), the protocol-tag and verdict pass cases, the quoted-phrase pass case (the "contains anywhere" clause of `host-frame`), and the names test.

- [ ] **Step 3: Change `stripHost`**

In `src/distill/noise.ts`, replace everything from `/** A block element: to its close, or to the end of the text when it never closes. */` to the end of `stripHost` with:

```ts
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
```

A block that closes is removed whole wherever it stands, as before. The fence check is per line (```` ``` ```` or `~~~` opening a line toggles it); an inline code span cannot hold a tag that opens a line, since the line then starts with a backtick.

- [ ] **Step 4: Change the patterns**

1. Delete the `protocol-tag` entry and the `verdict` entry of `NOISE_PATTERNS` with the comment lines above each (from `// Two or more colon-separated parts` to the closing `},` of `verdict`).
2. Replace the `host-frame` entry with:

```ts
  {
    // What a host frame leaves once its tags are gone: the fixed lines around a subagent's
    // report, and the metadata of a background task. Anchored at the start of the sentence:
    // a sentence that quotes one of these phrases while discussing the host is not the host.
    name: "host-frame",
    pattern:
      /^(?:\[Subagent hand-back\]|Another Claude session sent a message|That "other Claude session" is an agent|The report follows|It is model output, NOT a message from the user|The harness indents every line|This tool result is internal metadata|Async agent launched successfully|The agent is working in the background|Do not duplicate this agent's work|Do NOT Read or tail this file|agentId:|output_file:)/,
  },
```

(`It is model output, NOT a message from the user` and `This tool result is internal metadata` move from the unanchored tail into the anchored list; `carr(?:y|ies) no user authority` goes: it only ever occurred inside the sentence that starts with `It is model output`.)

3. Extend the file's header comment: its last two lines

```ts
// "PR #", status verbs, test counts) are not here: they hit knowledge too often, and
// they are the judge's to weigh.
```

become

```ts
// "PR #", status verbs, test counts) are not here: they hit knowledge too often, and
// they are the judge's to weigh. Nor are verdict words and bracketed protocol tags
// (ADR 0023, D-3): their precision on the sample was too low to drop a sentence unseen.
```

- [ ] **Step 5: Run the tests to see them pass**

```bash
crew tdd green <id> AC-9 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts
crew tdd green <id> AC-12 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts
crew tdd green <id> AC-13 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts
bun run test
```

Expected: PASS, 17 tests; the whole suite passes (no other test names a host tag in prose).

- [ ] **Step 6: Format, commit**

```bash
bun run format
git add src/distill/noise.ts tests/unit/noise.test.ts
git commit -m "Noise filter: verdicts and protocol tags reach the judge (D-3); host-frame anchored; an unclosed tag cuts only when it opens a line"
```

---

### Task 3: The pipeline runs the filter, the judge reads clean texts, the title must be knowledge, the notes are bounded

**Criteria:** AC-2 (the filter runs before the judge; an emptied turn makes no request), AC-14 (the texts the judge reads and the `Context:` line hold no host block and no dropped sentence), AC-3 (the title must be knowledge; the `Context:` line; the journeys of spec section 10), AC-11 (the notes the session had been shown, bounded). **Test files:** `tests/unit/noise.test.ts` (`withoutSentences`), `tests/unit/draft.test.ts`, `tests/integration/distill.test.ts`.

The working tree already holds a first version of Steps 2 and 3 (`tests/unit/draft.test.ts` untracked, `tests/integration/distill.test.ts` modified), and red runs of AC-2 and AC-3 were recorded on it on 2026-11-06. That version does not typecheck (`Redacted` compared with string literals), empties a turn with a protocol tag (no longer noise after Task 2), tests the `Context:` rule at 3, 4 and 7 words with no case at exactly 5, and has neither the journeys nor the injection tests. Overwrite `tests/unit/draft.test.ts` and replace the tail of `tests/integration/distill.test.ts` with the code below, then record the red runs again.

**How a dropped sentence leaves the text (AC-14).** The noise filter drops candidates, which are the segmenter's output, not substrings of the text: the segmenter trims list markers and quote marks, removes `*`/`**` emphasis, collapses whitespace and clips at 400 characters with "…". `withoutSentences` (in `noise.ts`, pure) therefore finds each dropped sentence with a pattern built from it: any run of whitespace matches any run, `*` or `**` may sit between its characters, and a clipped sentence is removed to the end of its line. What is left of a list marker (`- `) stays, harmless. A sentence it cannot find is left in the text; the judge still never rates it, since it is not a candidate.

**Files:**
- Modify: `src/distill/noise.ts` (`withoutSentences`)
- Modify: `tests/unit/noise.test.ts` (one `describe` added)
- Modify: `src/distill/segment.ts`
- Modify: `src/distill/policy.ts`
- Modify: `src/distill/pipeline.ts`
- Create: `tests/unit/draft.test.ts` (overwrites the untracked file)
- Modify: `tests/integration/distill.test.ts` (its tail, after `describe("distill: consolidation", …)`)

**Interfaces:**
- Consumes: `stripHost`, `dropNoise` (`src/distill/noise.ts`); `candidates` (`src/distill/segment.ts`); `withoutNotes` (`src/retrieve/render.ts`); `consolidate`, `Draft` (`src/distill/consolidate.ts`); `withWrite` (`src/store/db.ts`).
- Produces:
  - `noise.ts`: `withoutSentences(text: string, sentences: string[]): string`.
  - `segment.ts`: `wordCount(text: string): number` (the segmenter's own `WORD` pattern; its `MIN_WORDS` check uses it).
  - `pipeline.ts` (Task 6's test helper and Task 7's proof use these):
    - `interface PreparedTexts { prompt: Redacted; finalText: Redacted; candidates: DistillCandidate[]; dropped: { text: string; pattern: string }[] }`; `prompt` and `finalText` are the texts after `withoutNotes` and `stripHost`, with the dropped sentences taken out.
    - `prepareTexts(prompt: Redacted, finalText: Redacted | null, told: string[]): PreparedTexts` (pure)
    - `interface PreparedTurn extends PreparedTexts { detail: TurnDetail }`
    - `type TurnTexts = Pick<QueuedTurn, "id" | "sessionId" | "endedAt" | "prompt" | "finalText">`
    - `prepareTurn(db: Db, turn: TurnTexts, detail: TurnDetail): PreparedTurn`
    - `toldInSession(db: Db, turnId: number, sessionId: number, endedAt: number | null): string[]` (exported for the proof)
    - `draftTurn(judge: Judge, prepared: PreparedTurn): Promise<{ verdict: DistillVerdict | null; draft: Draft | null }>` (asks nothing when no candidate is left)
    - `buildDraft(prompt: string, cands: DistillCandidate[], verdict: DistillVerdict, detail: TurnDetail): Draft | null`
    - `storedDetail(db: Db, turnId: number): TurnDetail` (now exported)
  - `policy.ts`: `KNOWLEDGE_THRESHOLD = 0.5`, `CONTEXT_MIN_WORDS = 5`; `DURABLE_THRESHOLD` is gone.

- [ ] **Step 1: The unit tests of `withoutSentences`**

In `tests/unit/noise.test.ts`, the import from `../../src/distill/noise.ts` adds `withoutSentences`, and before `describe("dropNoise: …")` add:

```ts
describe("withoutSentences: a dropped sentence leaves the text the judge reads", () => {
  test("found through collapsed whitespace, list markers and emphasis", () => {
    expect(
      withoutSentences("- **Status:**  all tests green.\nThe cause was a timer.", [
        "Status: all tests green.",
      ]),
    ).toBe("- \nThe cause was a timer.");
  });

  test("a clipped sentence goes to the end of its line; one not found changes nothing", () => {
    expect(withoutSentences("Status: a very long line\nKept.", ["Status: a very…"])).toBe(
      "\nKept.",
    );
    expect(withoutSentences("Kept.", ["Status: elsewhere."])).toBe("Kept.");
  });
});
```

- [ ] **Step 2: The unit tests of the draft policy**

`tests/unit/draft.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { TurnDetail } from "../../src/adapters/types.ts";
import type { Redacted } from "../../src/core/redact.ts";
import type { Draft } from "../../src/distill/consolidate.ts";
import { buildDraft } from "../../src/distill/pipeline.ts";
import type { DistillCandidate, DistillVerdict } from "../../src/judge/types.ts";

const detail: TurnDetail = {
  filesRead: [],
  filesChanged: [],
  commands: [],
  errors: [],
  savedMemory: false,
};
const cand = (
  idx: number,
  text: string,
  source: "prompt" | "final" = "final",
): DistillCandidate => ({ idx, source, text: text as Redacted });
/** The body as text, for comparison with a literal. */
const bodyOf = (draft: Draft | null) => draft?.body as string | undefined;
const verdict = (over: Partial<DistillVerdict>): DistillVerdict => ({
  worthSaving: 0.9,
  kind: "fix",
  kindConfidence: 0.8,
  importance: 3,
  durable: [],
  titleIdx: null,
  source: "typesafe",
  ...over,
});

describe("buildDraft: the title must be knowledge", () => {
  const cands = [
    cand(0, "Bottom line: the wave closed in 909ce45cf and the gate is next."),
    cand(1, "The e2e never fires the real POST: sending is paid, everything is intercepted."),
    cand(2, "Next I will open the PR."),
  ];

  test("the judge's title stands when that sentence is knowledge", () => {
    const draft = buildDraft(
      "força W4 com tudo o que falta",
      cands,
      verdict({ durable: [0.2, 0.9, 0.1], titleIdx: 1 }),
      detail,
    );
    expect(draft?.title).toBe(
      "The e2e never fires the real POST: sending is paid, everything is intercepted.",
    );
    expect(bodyOf(draft)).toBe("Context: força W4 com tudo o que falta");
  });

  test("a title the judge chose but did not rate as knowledge gives way to the surest knowledge sentence", () => {
    const draft = buildDraft("", cands, verdict({ durable: [0.3, 0.8, 0.1], titleIdx: 0 }), detail);
    expect(draft?.title).toBe(cands[1]?.text);
  });

  test("with no knowledge sentence there is no memory, however worth the turn", () => {
    expect(
      buildDraft(
        "",
        cands,
        verdict({ worthSaving: 0.95, durable: [0.4, 0.45, 0.1], titleIdx: 0 }),
        detail,
      ),
    ).toBeNull();
  });

  test("facts are the knowledge sentences, at most five, in writing order, without the title", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      cand(i, `Fact number ${i} about src/f${i}.ts.`),
    );
    const draft = buildDraft(
      "",
      many,
      verdict({ durable: [0.9, 0.6, 0.7, 0.2, 0.95, 0.55, 0.8, 0.65], titleIdx: 4 }),
      detail,
    );
    expect(draft?.title).toBe("Fact number 4 about src/f4.ts.");
    expect(draft?.body.split("\n")).toEqual([
      "Fact number 0 about src/f0.ts.",
      "Fact number 2 about src/f2.ts.",
      "Fact number 6 about src/f6.ts.",
      "Fact number 7 about src/f7.ts.",
    ]);
  });
});

describe("buildDraft: the Context line", () => {
  const cands = [cand(0, "The cause was a pending timer in src/a.ts.")];
  const v = verdict({ durable: [0.9], titleIdx: 0 });

  test("needs at least five words in the prompt", () => {
    expect(bodyOf(buildDraft("ok força segue", cands, v, detail))).toBe("");
    expect(bodyOf(buildDraft("ok, força, segue já!", cands, v, detail))).toBe("");
    expect(bodyOf(buildDraft("the tests hang at exit", cands, v, detail))).toBe(
      "Context: the tests hang at exit",
    );
  });

  test("a title taken from the prompt gets none", () => {
    const rule = [cand(0, "Never mock the database in these tests.", "prompt")];
    expect(bodyOf(buildDraft("Never mock the database in these tests.", rule, v, detail))).toBe("");
  });
});
```

- [ ] **Step 3: The integration tests**

In `tests/integration/distill.test.ts`, the type import from `../../src/judge/types.ts` becomes `import type { DistillInput, Judge } from "../../src/judge/types.ts";`, and the end of the file, after the `describe("distill: consolidation", …)` block, is:

```ts
/** A judge that records what it is asked, rates every answer sentence as knowledge (the prompt not), and titles with the candidate at `titleAt`. */
function recording(seen: DistillInput[], titleAt = 0): Judge {
  return {
    name: "typesafe",
    version: "2",
    versions: { typesafe: "2" },
    distill: async (input) => {
      seen.push(input);
      return {
        worthSaving: 0.9,
        kind: "fix",
        kindConfidence: 0.9,
        importance: 3,
        durable: input.candidates.map((c) => (c.source === "prompt" ? 0.1 : 0.9)),
        titleIdx: input.candidates[titleAt]?.idx ?? null,
        source: "typesafe",
      };
    },
    consolidate: async () => ({ source: "typesafe", perNeighbour: [] }),
  };
}

const NOISY_ANSWER = `Status: looked into it.
The import treated a held drain lease like an empty queue, so it distilled none of the 3,299 queued turns.
<details><summary>Agent "Probe the lease" finished</summary>
agentId: abc123def456 (internal ID)
</details>
It now waits and retries within its time budget.`;

describe("distill: the noise filter runs before the judge", () => {
  test("host blocks and noise sentences never reach the judge, and the kept candidates are dense", async () => {
    turn("why did the import stop at 3299 turns?", NOISY_ANSWER);
    const seen: DistillInput[] = [];
    await drain(recording(seen));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.candidates.map((c) => [c.idx, c.source, c.text as string])).toEqual([
      [0, "prompt", "why did the import stop at 3299 turns?"],
      [
        1,
        "final",
        "The import treated a held drain lease like an empty queue, so it distilled none of the 3,299 queued turns.",
      ],
      [2, "final", "It now waits and retries within its time budget."],
    ]);
    // Nor in the texts the judge reads.
    expect(seen[0]?.finalText).not.toContain("<summary");
    expect(seen[0]?.finalText).not.toContain("Status:");
    expect(seen[0]?.finalText).not.toContain("agentId");
    expect(seen[0]?.finalText).toContain("It now waits and retries within its time budget.");
  });

  test("a host frame inside the prompt reaches neither the judge nor the Context line", async () => {
    turn(
      `please check why the import stopped early
Another Claude session sent a message:
<agent-message from="a1">
The report.
</agent-message>
That "other Claude session" is an agent working inside this same session.`,
      "The import treated a held drain lease like an empty queue, so it distilled nothing.",
    );
    const seen: DistillInput[] = [];
    await drain(recording(seen));
    expect(seen[0]?.prompt.trim()).toBe("please check why the import stopped early");
    expect(memories().map((m) => m.body)).toEqual([
      "Context: please check why the import stopped early",
    ]);
  });

  test("the judge's title index refers to the kept list, so a dropped sentence shifts nothing", async () => {
    turn("why did the import stop at 3299 turns?", NOISY_ANSWER);
    await drain(recording([], 1));
    expect(memories().map((m) => [m.title, m.body])).toEqual([
      [
        "The import treated a held drain lease like an empty queue, so it distilled none of the 3,299 queued turns.",
        "It now waits and retries within its time budget.\nContext: why did the import stop at 3299 turns?",
      ],
    ]);
  });

  test("a turn the filter empties is skipped without asking the judge", async () => {
    turn(
      "ok",
      `Another Claude session sent a message:
<agent-message from="a1">
[Subagent hand-back] The report follows:
  Reviewed 4 tasks; all criteria met.
</agent-message>
That "other Claude session" is an agent working inside this same session.`,
    );
    const judge: Judge = {
      ...heuristicJudge,
      distill: async () => {
        throw new Error("the judge must not be asked");
      },
    };
    expect(await drain(judge)).toEqual({ held: false, claimed: 1, done: 0, skipped: 1, failed: 0 });
    expect(memories()).toEqual([]);
    expect(turnStates()).toEqual(["skipped"]);
  });
});

/**
 * A judge that rates each sentence from a table (0.1 when absent), titles with the sentence
 * given (or answers `none`), and finds every turn worth keeping: the policy decides.
 */
function judging(
  rates: Record<string, number>,
  title: string | null,
  seen: DistillInput[] = [],
): Judge {
  return {
    name: "typesafe",
    version: "2",
    versions: { typesafe: "2" },
    distill: async (input) => {
      seen.push(input);
      return {
        worthSaving: 0.9,
        kind: "fix",
        kindConfidence: 0.9,
        importance: 3,
        durable: input.candidates.map((c) => rates[c.text] ?? 0.1),
        titleIdx: input.candidates.find((c) => c.text === title)?.idx ?? null,
        source: "typesafe",
      };
    },
    consolidate: async () => ({ source: "typesafe", perNeighbour: [] }),
  };
}

const BOTTOM_LINE = "Bottom line: the wave is closed and the gate is next.";
const E2E = "The e2e never fires the real POST: sending is paid, everything is intercepted.";
const CAUSE = "The cause was a pending timer in src/hooks/stop.ts that kept the process alive.";

describe("distill: the journeys of the spec (section 10)", () => {
  test("a turn that is only a status report stores nothing", async () => {
    turn(
      "ok",
      "Status: the wave is closed and pushed to origin. Next I will open the pull request for review.",
    );
    const seen: DistillInput[] = [];
    expect(await drain(judging({}, null, seen))).toMatchObject({ done: 0, skipped: 1 });
    expect(seen[0]?.candidates.map((c) => c.text as string)).toEqual([
      "Next I will open the pull request for review.",
    ]);
    expect(memories()).toEqual([]);
  });

  test("a mixed turn: the judge's title is not knowledge, the knowledge sentence is the title", async () => {
    turn("ok", `${BOTTOM_LINE} ${E2E}`);
    await drain(judging({ [BOTTOM_LINE]: 0.2, [E2E]: 0.9 }, BOTTOM_LINE));
    expect(memories().map((m) => [m.title, m.body])).toEqual([[E2E, ""]]);
  });

  test("a none title: the sentence above the threshold is the title", async () => {
    turn("ok", `${BOTTOM_LINE} ${E2E}`);
    await drain(judging({ [E2E]: 0.8 }, null));
    expect(memories().map((m) => m.title)).toEqual([E2E]);
  });

  test("a short acknowledgement with a fix: stored, with no Context line", async () => {
    turn("aprovo", `${CAUSE} I removed it and the hook now exits at once.`);
    await drain(judging({ [CAUSE]: 0.9 }, CAUSE));
    expect(memories().map((m) => [m.title, m.body])).toEqual([[CAUSE, ""]]);
  });
});

describe("distill: the notes the session had been shown", () => {
  /** Learns the busy-timeout fix in turn 1, then has turn 2 of the same session repeat it. */
  async function repeatedInASecondTurn(): Promise<number> {
    turn("the tests fail with a timeout", FIX);
    await drain();
    turn(
      "is openDb still slow?",
      "As noted before: Fixed: the root cause was the busy timeout being set after the first query. Moved the pragma to the top of `openDb` in src/store/db.ts. So nothing new here.",
    );
    // Only the injection each test writes: what retrieval chose to show is not the point.
    db.run("DELETE FROM injections");
    return clock;
  }
  const inject = (at: number) =>
    db.run(
      "INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at) VALUES (1, 0, 1, 'prompt', 40, ?)",
      [at],
    );

  test("a note from another turn, shown after this turn ended, does not take this turn's sentences", async () => {
    const ended = await repeatedInASecondTurn();
    inject(ended + 60_000);
    const seen: DistillInput[] = [];
    await drain(recording(seen));
    expect(seen[0]?.candidates.map((c) => c.text as string)).toContain(
      "Moved the pragma to the top of `openDb` in src/store/db.ts.",
    );
  });

  test("a note from another turn, shown before this turn ended, is removed from it", async () => {
    const ended = await repeatedInASecondTurn();
    inject(ended - 500);
    const seen: DistillInput[] = [];
    await drain(recording(seen));
    expect(seen[0]?.candidates.map((c) => c.text as string)).not.toContain(
      "Moved the pragma to the top of `openDb` in src/store/db.ts.",
    );
  });

  test("a turn ended again later keeps its sentences from its own memory, shown before that end", async () => {
    const turnId = turn("the tests fail with a timeout", FIX);
    await drain();
    db.run(
      "INSERT INTO injections (session_id, context_epoch, memory_id, event, tokens, at) VALUES (1, 0, 1, 'prompt', 40, ?)",
      [clock + 500],
    );
    // A late turn-end with more text queues the turn again, with a later ended_at.
    hook("turn-end", { turnId, finalText: `${FIX} The WAL mode is set in the same place.` });
    const seen: DistillInput[] = [];
    await drain(recording(seen));
    expect(seen[0]?.candidates.map((c) => c.text as string)).toContain(
      "Moved the pragma to the top of `openDb` in src/store/db.ts.",
    );
  });

  test("with no end recorded, every note the session was shown is removed", async () => {
    turn("the tests fail with a timeout", FIX);
    await drain();
    db.run("DELETE FROM turns");
    hook("prompt", { sessionId: "s2", turnId: "q1", prompt: "why is openDb slow here?" });
    hook("turn-end", {
      sessionId: "s2",
      turnId: "q1",
      finalText:
        "As noted before: Fixed: the root cause was the busy timeout being set after the first query. Moved the pragma to the top of `openDb` in src/store/db.ts. So nothing new here.",
    });
    db.run("UPDATE turns SET ended_at = NULL");
    db.run("UPDATE injections SET at = at + 3600000");
    await drain();
    expect(memories()).toHaveLength(1);
    expect(memories()[0]?.evidence_count).toBe(1);
  });
});
```

Notes on these tests:

- "a host frame inside the prompt …": `isFromTheHost` only empties a prompt that opens with a host tag; here the user's words come first, so the frame lines around the removed block survive `stripHost`, are dropped as `host-frame`, and must leave the prompt the judge reads and the `Context:` line.
- The two "note from another turn" tests isolate the time bound: the note is turn 1's memory, shown in the same session, so the self-exclusion does not apply. They delete the injections retrieval wrote and insert one by hand, after (one minute) or before (half a second) turn 2's `ended_at`.
- The re-ended turn goes through the real turn-end hook: a second ending with a different answer queues a `done` turn again with a later `ended_at` (`completeTurn`, `src/store/turns.ts`), so a memory made from the first ending was shown before the second; only the self-exclusion keeps the turn's sentences.
- The null case quotes the note without its wrapper, so that only the injection read can remove it.

- [ ] **Step 4: Run them to see them fail**

```bash
crew tdd red <id> AC-14 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts tests/integration/distill.test.ts -t "withoutSentences|never reach the judge|host frame inside the prompt"
crew tdd red <id> AC-3 -- ./node_modules/.bin/bun test tests/unit/draft.test.ts tests/integration/distill.test.ts -t "Context line|title must be knowledge|journeys"
crew tdd red <id> AC-2 -- ./node_modules/.bin/bun test tests/integration/distill.test.ts -t "noise filter"
crew tdd red <id> AC-11 -- ./node_modules/.bin/bun test tests/integration/distill.test.ts -t "notes the session had been shown"
```

Expected, each run FAIL (measured on today's pipeline, with Task 2 done, when this plan was written):

- `noise.test.ts`: `withoutSentences` is not exported (SyntaxError on the import); `draft.test.ts`: `buildDraft` is not exported.
- The noise filter tests (4): the judge sees `Status:` and `agentId:` among the candidates and in the answer; the frame lines reach the prompt and the `Context:` line; the title index shifts; the emptied turn calls the judge, which throws, so the turn is `failed`.
- The journeys: the status report fails on its candidates assertion (the `Status:` sentence reaches the judge; today's policy stores nothing either, since no sentence reaches 0.5), the mixed turn (today's policy keeps the judge's title) and the short acknowledgement (`Context: aprovo`) fail. "a none title: …" passes already: today's policy falls back to the first durable sentence, the same one here; it guards the fallback of the new policy.
- The notes: "a note from another turn, shown after this turn ended, …" and "a turn ended again later …" fail (no bound today). "a note from another turn, shown before this turn ended, is removed from it" and "with no end recorded, …" pass already (today nothing is bounded); they fail on a bound that is too strict or that forgets the null (checked when this plan was written by writing `i.at <= ?` without the null branch).

- [ ] **Step 5: `withoutSentences`, the word count and the policy**

At the end of `src/distill/noise.ts`, add:

```ts
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
```

In `src/distill/segment.ts`, add before `function endsWithAbbreviation(`:

```ts
/** The words of a text, as the segmenter counts them (letters first, then letters, digits, `_`, `'`, `-`). */
export function wordCount(text: string): number {
  return (text.match(WORD) ?? []).length;
}
```

and in `segment`, `if ((sentence.match(WORD) ?? []).length < MIN_WORDS) continue;` becomes `if (wordCount(sentence) < MIN_WORDS) continue;`.

In `src/distill/policy.ts`, replace

```ts
/** A sentence becomes one of a memory's facts when its durability reaches this. */
export const DURABLE_THRESHOLD = 0.5;
```

with

```ts
/**
 * A sentence becomes one of a memory's facts, and may be its title, when the probability
 * that it is knowledge on its own reaches this. A turn with no such sentence yields no
 * memory, whatever `worthSaving` said: the title must be knowledge.
 */
export const KNOWLEDGE_THRESHOLD = 0.5;

/** The `Context:` line (the prompt the answer replied to) is added only when the prompt has at least this many words: "aprovo" gives the reader nothing. */
export const CONTEXT_MIN_WORDS = 5;
```

`DURABLE_THRESHOLD` has no other user than `pipeline.ts` (`grep -rn DURABLE_THRESHOLD src tests scripts` finds only it).

- [ ] **Step 6: Change the pipeline**

In `src/distill/pipeline.ts`, four edits; everything else stays as it is (the detail reading, the consolidation, the write and the supersession loop).

(a) The imports: the policy import becomes the block below, preceded by the noise import, and the segment import adds `wordCount`:

```ts
import { dropNoise, stripHost, withoutSentences } from "./noise.ts";
import {
  CONTEXT_MIN_WORDS,
  KNOWLEDGE_THRESHOLD,
  MAX_FACTS,
  SAVE_THRESHOLD,
  TITLE_MAX_CHARS,
} from "./policy.ts";
import { candidates, wordCount } from "./segment.ts";
```

(b) `storedDetail` is exported; its comment becomes:

```ts
/**
 * What a turn was stored with: a history turn's transcript tail no longer holds an old
 * turn, and the quality proof reads turns whose transcripts may be gone.
 */
export function storedDetail(db: Db, turnId: number): TurnDetail {
```

(c) Replace everything from `function buildDraft(` (with no comment above it today) to the end of `toldInSession` with:

```ts
/**
 * The memory a verdict allows, or null. The title must be knowledge: the judge's choice
 * when that sentence reaches the threshold, otherwise the surest sentence that does; with
 * none, no memory, whatever `worthSaving` said.
 */
export function buildDraft(
  prompt: string,
  cands: DistillCandidate[],
  verdict: DistillVerdict,
  detail: TurnDetail,
): Draft | null {
  if (verdict.worthSaving < SAVE_THRESHOLD || verdict.kind === "none") return null;
  // `durable` keeps its name in the verdict: it is the per-candidate knowledge probability.
  const knowledge = (candidate: DistillCandidate) => verdict.durable[candidate.idx] ?? 0;
  const surestFirst = (a: DistillCandidate, b: DistillCandidate) =>
    knowledge(b) - knowledge(a) || a.idx - b.idx;
  const known = cands.filter((candidate) => knowledge(candidate) >= KNOWLEDGE_THRESHOLD);
  const chosen = cands.find((candidate) => candidate.idx === verdict.titleIdx);
  const title =
    chosen !== undefined && knowledge(chosen) >= KNOWLEDGE_THRESHOLD
      ? chosen
      : [...known].sort(surestFirst)[0];
  if (title === undefined) return null;

  // The strongest facts, shown in the order they were written.
  const facts = [...known]
    .sort(surestFirst)
    .slice(0, MAX_FACTS)
    .sort((a, b) => a.idx - b.idx)
    .filter((candidate) => candidate.idx !== title.idx)
    .map((candidate) => candidate.text as string);

  // What the user had asked gives the answer's sentences their referent. A bare "ok"
  // gives none, and a rule taken from the prompt itself needs none.
  const asked = prompt.replace(/\s+/g, " ").trim();
  if (title.source === "final" && wordCount(asked) >= CONTEXT_MIN_WORDS) {
    facts.push(`Context: ${clip(asked, CONTEXT_MAX_CHARS, "…")}`);
  }

  const changed = detail.filesChanged.slice(0, MAX_CHANGED_FILES);
  const read = detail.filesRead.filter((path) => !changed.includes(path)).slice(0, MAX_READ_FILES);
  return {
    kind: verdict.kind,
    title: clip(title.text, TITLE_MAX_CHARS, "…"),
    body: facts.join("\n") as Redacted,
    importance: verdict.importance,
    files: [
      ...changed.map((path) => ({ path, role: "changed" as const })),
      ...read.map((path) => ({ path, role: "read" as const })),
    ],
  };
}

/**
 * The titles and facts of every note this session had been shown when the turn ended. A
 * note shown later cannot have been repeated in the turn. With no end recorded, every note
 * of the session counts. A memory made from this same turn never counts: a late turn-end
 * moves `ended_at` later (`completeTurn`, `src/store/turns.ts`), past the moment the
 * memory of its first ending was shown, and it would take the turn's own sentences away.
 * Exported for the quality proof, which shows the labeller the turn as the pipeline reads it.
 */
export function toldInSession(
  db: Db,
  turnId: number,
  sessionId: number,
  endedAt: number | null,
): string[] {
  return db
    .query<{ title: string; body: string }, [number, number | null, number | null, number]>(
      `SELECT DISTINCT m.title, m.body FROM injections i JOIN memories m ON m.id = i.memory_id
        WHERE i.session_id = ? AND (? IS NULL OR i.at <= ?)
          AND (m.source_turn_id IS NULL OR m.source_turn_id <> ?)`,
    )
    .all(sessionId, endedAt, endedAt, turnId)
    .flatMap((note) => [note.title, ...note.body.split("\n")]);
}

export interface PreparedTexts {
  /** What the judge reads as `user_prompt`, and what the `Context:` line quotes. */
  prompt: Redacted;
  /** What the judge reads as `assistant_final_message`. */
  finalText: Redacted;
  /** What the judge rates: the sentences the noise filter kept, re-indexed from 0. */
  candidates: DistillCandidate[];
  /** The sentences the noise filter dropped, each with the name of its pattern. */
  dropped: { text: string; pattern: string }[];
}

/**
 * A turn's texts as a judge sees them, and the sentences it rates: the notes the session
 * had been shown (`told`) and the host's blocks are removed, the texts are segmented, the
 * noise filter runs, and the sentences it dropped are taken out of the texts too, so that
 * neither the host's frame nor a noise sentence reaches the judge or the `Context:` line.
 * Pure. Text cut from redacted text is itself redacted.
 */
export function prepareTexts(
  prompt: Redacted,
  finalText: Redacted | null,
  told: string[],
): PreparedTexts {
  // A host notification is not the user speaking: no rule comes from it, and it gives
  // the answer no context.
  const asked = isFromTheHost(prompt) ? "" : stripHost(withoutNotes(prompt, told));
  const answer = stripHost(withoutNotes(finalText ?? "", told));
  const segmented = candidates(asked, answer).map((candidate) => ({
    ...candidate,
    text: candidate.text as Redacted,
  }));
  const { kept, dropped } = dropNoise(segmented);
  const droppedFrom = (source: "prompt" | "final") =>
    dropped
      .filter(({ candidate }) => candidate.source === source)
      .map(({ candidate }) => candidate.text);
  return {
    prompt: withoutSentences(asked, droppedFrom("prompt")) as Redacted,
    finalText: withoutSentences(answer, droppedFrom("final")) as Redacted,
    candidates: kept,
    dropped: dropped.map(({ candidate, pattern }) => ({ text: candidate.text, pattern })),
  };
}

export interface PreparedTurn extends PreparedTexts {
  detail: TurnDetail;
}

/** What `prepareTurn` reads of a turn. */
export type TurnTexts = Pick<QueuedTurn, "id" | "sessionId" | "endedAt" | "prompt" | "finalText">;

/** The turn as a judge will see it. The live drain and the quality proof both start here. */
export function prepareTurn(db: Db, turn: TurnTexts, detail: TurnDetail): PreparedTurn {
  const told = toldInSession(db, turn.id, turn.sessionId, turn.endedAt);
  return { ...prepareTexts(turn.prompt, turn.finalText, told), detail };
}

/**
 * The judge's verdict and the draft it allows. With no candidate left there is nothing to
 * select from: the judge is not asked, and there is no verdict.
 */
export async function draftTurn(
  judge: Judge,
  prepared: PreparedTurn,
): Promise<{ verdict: DistillVerdict | null; draft: Draft | null }> {
  if (prepared.candidates.length === 0) return { verdict: null, draft: null };
  const verdict = await judge.distill({
    prompt: prepared.prompt,
    finalText: prepared.finalText,
    candidates: prepared.candidates,
    filesChanged: prepared.detail.filesChanged,
    commands: prepared.detail.commands as Redacted[],
    hadErrors: prepared.detail.errors.length > 0,
  });
  return {
    verdict,
    draft: buildDraft(prepared.prompt, prepared.candidates, verdict, prepared.detail),
  };
}
```

(d) In `distillTurn`, replace everything from `// Text cut from redacted text is itself redacted.` to the end of the `if (draft === null) { … }` block with:

```ts
  const { verdict, draft } = await draftTurn(deps.judge, prepareTurn(db, turn, detail));
  if (verdict === null || draft === null) {
    finish("skipped");
    return "skipped";
  }
```

The rest of `distillTurn` reads `verdict.source` and `draft` as before; TypeScript narrows both to non-null after the check. A `QueuedTurn` is a `TurnTexts`, so the drain passes its turn as it is. `buildDraft` receives `prepared.prompt`, the cleaned prompt, so the `Context:` line quotes the same text the judge read.

- [ ] **Step 7: Run the new tests**

```bash
crew tdd green <id> AC-14 -- ./node_modules/.bin/bun test tests/unit/noise.test.ts tests/integration/distill.test.ts -t "withoutSentences|never reach the judge|host frame inside the prompt"
crew tdd green <id> AC-3 -- ./node_modules/.bin/bun test tests/unit/draft.test.ts tests/integration/distill.test.ts -t "Context line|title must be knowledge|journeys"
crew tdd green <id> AC-2 -- ./node_modules/.bin/bun test tests/integration/distill.test.ts -t "noise filter"
crew tdd green <id> AC-11 -- ./node_modules/.bin/bun test tests/integration/distill.test.ts -t "notes the session had been shown"
```

Expected: PASS (2 `withoutSentences` tests, 6 in `draft.test.ts`, 4 journeys, 4 noise filter tests, 4 notes tests).

- [ ] **Step 8: Run the distill suite, and tell a legitimate change from a bug**

Run: `./node_modules/.bin/bun test tests/unit/noise.test.ts tests/unit/draft.test.ts tests/integration/distill.test.ts`
Expected: PASS, every test (19 in `noise.test.ts`, 51 in `distill.test.ts`). When this plan was written, the pipeline above changed no existing expectation anywhere in the suite. The heuristic judge already titles with a sentence it rates ≥ 0.5. The fixtures that carry host blocks (`tests/integration/distill.test.ts:504–524`: a `<task-notification>` prompt and an `<agent-message>` prompt) open their prompt with the block, which `isFromTheHost` already empties; their answers carry no block and no noise label.

If an existing test fails anyway, its expected value may change only for one of these reasons, each checked on the failing turn:

1. **The `Context:` line.** It is missing because the prompt has fewer than five words (`CONTEXT_MIN_WORDS`, counted with `wordCount`), or it is shorter because a dropped sentence or a host block left the prompt.
2. **The title rule.** The title differs, or there is no memory, because the judge's chosen title had a knowledge probability under `KNOWLEDGE_THRESHOLD`. Print `verdict.durable` and `verdict.titleIdx` for the turn: the new title must be the sentence with the highest value ≥ 0.5 (lowest index on a tie), or no memory when none reaches 0.5.
3. **The filter.** A sentence is gone because `stripHost` removed the block around it or `dropNoise` dropped it. Run `dropNoise(candidates(stripHost(prompt), stripHost(final)))` on the turn's texts: the sentence must be in a host block or in `dropped` with a pattern name.
4. **Indices.** A candidate index shifted because a sentence before it was dropped (same sentences, renumbered).

Any other difference (a fact missing that none of the four explains, a changed kind or importance, a hook snapshot, a retrieval golden) is a bug in Steps 5–6: fix the code, not the test. When an expectation changes, name the reason (1–4) in the commit message.

- [ ] **Step 9: Run the whole suite**

Run: `bun run test`
Expected: PASS. `tests/unit/hook-snapshots.test.ts` and `tests/golden/retrieval.test.ts` must not change at all.

- [ ] **Step 10: Format, commit**

```bash
bun run format
git add src/distill/noise.ts tests/unit/noise.test.ts src/distill/segment.ts src/distill/policy.ts src/distill/pipeline.ts tests/unit/draft.test.ts tests/integration/distill.test.ts
git commit -m "Distillation: the filter runs before the judge, which reads no dropped sentence; the title must be knowledge; Context needs five words; notes bounded by the turn's end and its own memory"
```

(Add any test file whose expectation changed in Steps 8–9, with its reason.)

---

### Task 4: The heuristic judge, version 2

**Criterion:** AC-5. **Test file:** `tests/unit/heuristic-judge.test.ts`.

The spec's rules (section 9): a sentence of the answer with a report signal (a commit hash, a pull request reference, a status verb in English or Portuguese, a verdict word, a test count) has a lower knowledge probability; an answer whose sentences mostly carry report signals has a lower `worth`. The amounts, lists and share are constants: a sentence loses `REPORT_PENALTY` (0.25), never below 0.05 (the existing clamp); an answer where at least `REPORT_SHARE` (60%) of the sentences carry a signal loses `REPORT_DISCOUNT` (0.2) of its worth. "done" and "feito" are left out of the status verbs on purpose: they are too common in ordinary sentences. With both turned off the heuristic answers as version 1 does: that is `heuristicJudgeV1`, which the drain never uses and the proof compares with version 2 (D-6).

**Why a second judge object rather than one switch on `wording`.** Reading `DistillInput.wording` in the heuristic would give both judges one switch, but spec section 7 says the heuristic ignores the field, and it would change what `rejudge` does when TypeSafe fails: `makeJudge`'s fallback hands the same input, `wording: 1`, to the heuristic, whose verdicts `rejudge` discards today and whose meaning would then silently differ from the version it reports ("2"). `heuristicJudgeV1` keeps the switch inside the heuristic (one `reportSignals` flag, passed to `durability` and `distill`) and keeps each object's reported version true to what it answers.

**Files:**
- Modify: `src/judge/heuristic.ts`
- Modify: `tests/unit/typesafe-judge.test.ts` (line 412)
- Modify: `tests/unit/heuristic-judge.test.ts` (two `describe` blocks added)

**Interfaces:**
- Produces: `heuristicJudge` (`version: "2"`, `versions: { heuristic: "2" }`) and `heuristicJudgeV1` (`version: "1"`, `versions: { heuristic: "1" }`, report signals off); the same `Judge` interface.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/heuristic-judge.test.ts`, the judge import becomes `import { heuristicJudge, heuristicJudgeV1 } from "../../src/judge/heuristic.ts";`, and at the end of the file:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

```bash
crew tdd red <id> AC-5 -- ./node_modules/.bin/bun test tests/unit/heuristic-judge.test.ts
```

Expected: FAIL. `heuristicJudgeV1` is not exported (SyntaxError on the import). Without the version 1 `describe`, the version 2 tests fail on today's code: the version is "1", the merge, verdict and test-count sentences score 0.6, and both report answers keep a worth of 0.5 or more.

- [ ] **Step 3: Add the report signals**

In `src/judge/heuristic.ts`, before `const SUBSTANTIVE_CHARS = 120;`, add:

```ts
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
```

`durability` and `distill` take the switch:

- `function durability(candidate: DistillCandidate): number {` becomes `function durability(candidate: DistillCandidate, reportSignals: boolean): number {`, and after `if (LEANS_ON_CONTEXT.test(text)) score -= 0.2;` add `if (reportSignals && any(text, REPORT)) score -= REPORT_PENALTY;` (the existing `clamp(score, 0.05, 0.95)` keeps the floor of 0.05);
- `function distill(input: DistillInput): DistillVerdict {` becomes `function distill(input: DistillInput, reportSignals: boolean): DistillVerdict {`; `const durable = input.candidates.map(durability);` becomes `const durable = input.candidates.map((candidate) => durability(candidate, reportSignals));`; after `if (!edits && !cue && !correction) worth -= 0.2;` add:

```ts
  // Mostly a report of the session: the cue words it carries ("fixed", "merged") are news,
  // not knowledge.
  const finals = input.candidates.filter((candidate) => candidate.source === "final");
  const reporting = finals.filter((candidate) => any(candidate.text, REPORT)).length;
  if (reportSignals && finals.length > 0 && reporting / finals.length >= REPORT_SHARE) {
    worth -= REPORT_DISCOUNT;
  }
```

At the bottom, the two judges:

```ts
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
```

- [ ] **Step 4: The fallback's merged versions**

`tests/unit/typesafe-judge.test.ts`, line 412, checks the versions `withFallback` merges from its `working` stub (`versions: { typesafe: "1" }`, line 398) and `heuristicJudge`. Change it to:

```ts
    expect(judge.versions).toEqual({ typesafe: "1", heuristic: "2" });
```

The stubs' own literals at lines 386–387 and 398 stay "1": they are the test's judges, not TypeSafe's.

- [ ] **Step 5: Run the unit tests and the golden set**

```bash
crew tdd green <id> AC-5 -- ./node_modules/.bin/bun test tests/unit/heuristic-judge.test.ts
./node_modules/.bin/bun test tests/unit/typesafe-judge.test.ts tests/golden/filter.test.ts tests/golden/judges.test.ts
```

Expected: PASS. Measured when this plan was written: the heuristic version 2 keeps precision and recall at 100% on the 32 golden turns, kind 88%. If a golden turn that is `worth: true` is now missed, the signals are too broad for that text: narrow the regex that hit it (print `verdict.durable` for the turn to see which sentence dropped) rather than touching a floor. Do not touch `tests/golden/typesafe-answers.json` in this task.

- [ ] **Step 6: Whole suite, format, commit**

```bash
bun run test
bun run format
git add src/judge/heuristic.ts tests/unit/heuristic-judge.test.ts tests/unit/typesafe-judge.test.ts
git commit -m "Heuristic judge version 2: report sentences lose knowledge, a report answer loses worth; version 1 kept for the proof"
```

`bun run test` must pass before the commit: the version change reaches every test that merges or records the heuristic's version (only line 412 did when this plan was written).

---

### Task 5: The import rejudge keeps version 1 (D-2)

**Criterion:** AC-10 (preserve). **Test file:** `tests/integration/rejudge.test.ts`.

Today `rejudge` (`src/judge/rejudge.ts:122`) stamps `options.judge.versions.typesafe`, which Task 6 makes "2", and asks whatever `distillQuestions` builds. This task makes the import rejudge independent of the distillation questions' version before Task 6 changes them: one constant, `IMPORT_WORDING`, is the wording it sends and the version it stamps. The test is written first and passes before the change (it describes today's behaviour); it must still pass after this task and after Task 6, which is when it protects something.

**Files:**
- Modify: `src/judge/types.ts` (`DistillInput.wording`)
- Modify: `src/judge/rejudge.ts`
- Modify: `tests/integration/rejudge.test.ts` (two imports, one `describe` added)

**Interfaces:**
- Produces: `DistillInput.wording?: 1 | 2` (absent means 2); `IMPORT_WORDING = 1` and `IMPORT_JUDGE_VERSION = String(IMPORT_WORDING)` exported from `src/judge/rejudge.ts`. Task 6's `distillState`, `distillQuestions` and `distillVerdict` read `wording`.

- [ ] **Step 1: Write the preserve test**

In `tests/integration/rejudge.test.ts`, add `import type { SystemOneRequest } from "../../src/judge/client.ts";` after the `importClaudeMem` import and `import { TypeSafeJudge } from "../../src/judge/typesafe.ts";` after the `Judge` type import, and append at the end of the file:

```ts
/** The real TypeSafe judge, its service a stand-in that records each request and answers yes. */
function recordingTypeSafe(requests: SystemOneRequest[]): TypeSafeJudge {
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as SystemOneRequest);
    return new Response(
      JSON.stringify({
        model: "jev",
        answers: {
          worth: { type: "noul", noul: 0.9 },
          kind: { type: "choice", choice: "decision", probabilities: {}, confidence: 0.9 },
          importance: { type: "score", score: 3, legend: {}, probabilities: {}, confidence: 0.9 },
        },
        usage: { input_tokens: 10, output_tokens: 1 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return new TypeSafeJudge({ apiKey: "recorded", fetch: fetchFn });
}

describe("rejudge keeps the version 1 questions (ADR 0023, D-2)", () => {
  test("asks worth, kind and importance in their version 1 wording, and stamps judge_version '1'", async () => {
    const requests: SystemOneRequest[] = [];
    const report = await rejudge(db, { judge: recordingTypeSafe(requests), now: NOW });
    expect(report).toMatchObject({ judged: 4, failed: 0 });
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      expect(Object.keys(request.questions).sort()).toEqual(["importance", "kind", "worth"]);
      expect(request.questions.worth?.instructions).toBe(
        "Would a developer starting a new coding session on this repository weeks from now work better by knowing something stated in `user_prompt` or `assistant_final_message`?",
      );
      expect(request.questions.kind?.instructions).toBe(
        "What kind of lasting knowledge does this turn mainly contain?",
      );
      expect(request.questions.importance?.instructions).toBe(
        "How costly would it be for a future session not to know this?",
      );
      expect(request.state).not.toHaveProperty("reader");
    }
    expect(
      db.query("SELECT DISTINCT judge_version FROM memories WHERE judge = 'typesafe'").all(),
    ).toEqual([{ judge_version: "1" }]);
  });
});
```

The judge is the real `TypeSafeJudge` with a stand-in service, so the test sees the request as TypeSafe would and the version the judge itself reports.

- [ ] **Step 2: Run it before the change**

```bash
crew tdd before <id> AC-10 -- ./node_modules/.bin/bun test tests/integration/rejudge.test.ts
```

Expected: PASS, 10 tests (today's questions are the version 1 wording and `TypeSafeJudge.version` is "1").

- [ ] **Step 3: The wording field**

In `src/judge/types.ts`, at the end of `DistillInput`, after `hadErrors: boolean;`, add:

```ts
  /**
   * The wording of the questions: 2 (the default) for distillation, 1 for the import
   * rejudge, which keeps the version 1 questions (ADR 0023, D-2). A judge without
   * questions ignores it.
   */
  wording?: 1 | 2;
```

- [ ] **Step 4: One constant for the wording and the stamp**

In `src/judge/rejudge.ts`:

- the type import becomes `import type { DistillInput, DistillVerdict, Judge } from "./types.ts";`;
- before `/** After this many failures in a row …` add:

```ts
/**
 * The import rejudge keeps the version 1 questions (ADR 0023, D-2): the wording it asks in,
 * and the version it stamps, both from this one constant, so they cannot drift apart.
 */
export const IMPORT_WORDING = 1;
export const IMPORT_JUDGE_VERSION = String(IMPORT_WORDING);
```

- `asInput` is typed and sends the wording:

```ts
function asInput(db: Db, row: Row): DistillInput {
  return {
    prompt: "" as Redacted,
    finalText: `${row.title}\n${row.body}` as Redacted,
    candidates: [],
    filesChanged: filesChanged(db, row.id),
    commands: [],
    hadErrors: false,
    wording: IMPORT_WORDING,
  };
}
```

- in `rejudge`, the check stays and the stamp comes from the constant:

```ts
  if (options.judge.versions.typesafe === undefined)
    throw new Error("rejudge needs a judge that can answer through TypeSafe");
```

and in the write, `update.run(kind, verdict.importance, keep ? "active" : "archived", IMPORT_JUDGE_VERSION, row.id);` (the `const version = …` line is removed).

Until Task 6, `questions.ts` ignores `wording` (its only wording is version 1), so nothing the service sees changes.

- [ ] **Step 5: Run it after the change**

```bash
crew tdd after <id> AC-10 -- ./node_modules/.bin/bun test tests/integration/rejudge.test.ts
bun run typecheck
```

Expected: PASS, 10 tests; typecheck clean.

- [ ] **Step 6: Format, commit**

```bash
bun run format
git add src/judge/types.ts src/judge/rejudge.ts tests/integration/rejudge.test.ts
git commit -m "Import rejudge: one constant for the version 1 wording and the stamp (D-2)"
```

---

### Task 6: The questions, version 2, and the golden set

**Criterion:** AC-4; AC-10 recorded again at the end. **Test files:** `tests/unit/questions.test.ts`, `tests/golden/judges.test.ts`, `tests/golden/filter.test.ts`.

**The version 1 builder** keeps only `worth`, `kind` and `importance`, the questions `rejudge` asks (spec section 7): its `durable_<i>` loop and its `title` block are deleted. With `wording: 1`, `distillVerdict` reads no per-sentence answer: every candidate's `durable` is 0 and there is no title. The proof never asks version 1 again (section 11).

**D-5, the token ceiling, is measured here, on the golden turns** (spec section 11): version 1's input tokens per turn are the `inputTokens` recorded in `tests/golden/typesafe-answers.json` today; version 2's are the ones Step 7 records. The version 1 file is not kept beside the new one: it stays in git history (`git show HEAD:tests/golden/typesafe-answers.json` before this task's commit), and Step 7 copies it to the scratchpad before recording.

**Files:**
- Modify: `src/judge/questions.ts` (the version 1 builders renamed, reduced to three questions; version 2 added; consolidation and personal untouched)
- Modify: `src/judge/typesafe.ts` (version strings)
- Modify: `tests/unit/typesafe-judge.test.ts`, `tests/integration/judge-select.test.ts`, `tests/integration/rejudge.test.ts` (question ids and version literals, listed in Step 4)
- Modify: `tests/helpers/judge-input.ts` (the golden input goes through the filter)
- Modify: `tests/golden/turns.json` (eight turns), `tests/golden/typesafe-answers.json` (re-recorded), `tests/golden/judges.test.ts` (the replaying judge)
- Create: `tests/unit/questions.test.ts`

**Interfaces:**
- Consumes: `DistillInput.wording` (Task 5), `prepareTexts` (Task 3).
- Produces: `distillState(input)` with a `reader` field (none with `wording: 1`); `distillQuestions(input)` with ids `worth`, `kind`, `importance`, `knowledge_<idx>` (one per candidate) and `title` (when there are candidates), or exactly `worth`, `kind` and `importance` with `wording: 1`; `distillVerdict(input, answers)` reading `knowledge_<idx>` into `durable` (with `wording: 1`, 0 for every candidate and no title); `TypeSafeJudge.version === "2"`.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/questions.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { distillQuestions, distillState, distillVerdict } from "../../src/judge/questions.ts";
import { distillInput } from "../helpers/judge-input.ts";

const input = distillInput(
  "the tests hang after the last case",
  "The cause was a pending timer in src/a.ts. Next I will open the PR.",
);

describe("questions, version 2", () => {
  test("the state names the reader once, and candidates are indexed as the questions address them", () => {
    const state = distillState(input);
    expect(state).toMatchObject({
      reader:
        "a developer who joins this repository a month from now and never saw this conversation",
    });
    expect(state.candidates.map((c) => c.id)).toEqual([0, 1, 2]);
  });

  test("one knowledge question per candidate, named by its index, plus worth, kind, importance and title", () => {
    const questions = distillQuestions(input);
    expect(Object.keys(questions).sort()).toEqual([
      "importance",
      "kind",
      "knowledge_0",
      "knowledge_1",
      "knowledge_2",
      "title",
      "worth",
    ]);
    expect(questions.knowledge_1?.instructions).toContain("`candidates[1].text`");
    expect(questions.knowledge_1?.instructions).toContain("`reader`");
    expect(questions.worth?.criteria).toMatchObject({ false: expect.stringContaining("merged") });
    expect(questions.kind?.criteria).toMatchObject({
      change: expect.stringContaining("Not that something was done"),
    });
    expect(questions.title?.criteria).toMatchObject({
      none: "No candidate states knowledge on its own.",
    });
  });

  test("every path a question names exists in the state", () => {
    const state = distillState(input) as Record<string, unknown>;
    for (const question of Object.values(distillQuestions(input))) {
      for (const [, path = ""] of question.instructions.matchAll(
        /`([a-z_]+(?:\[\d+\]\.[a-z_]+)?)`/g,
      )) {
        const [, root = "", index, field = ""] =
          /^([a-z_]+)(?:\[(\d+)\]\.([a-z_]+))?$/.exec(path) ?? [];
        const value = state[root];
        const found =
          index === undefined
            ? value !== undefined
            : field in ((value as Record<string, unknown>[])[Number(index)] ?? {});
        expect([path, found]).toEqual([path, true]);
      }
    }
  });

  test("the verdict reads knowledge_<i> into durable, and a title of none is null", () => {
    const verdict = distillVerdict(input, {
      worth: { type: "noul", noul: 0.8 },
      kind: { type: "choice", choice: "fix", probabilities: { fix: 0.9 }, confidence: 0.9 },
      importance: { type: "score", score: 2.2, legend: {}, probabilities: {}, confidence: 0.8 },
      knowledge_0: { type: "noul", noul: 0.1 },
      knowledge_1: { type: "noul", noul: 0.9 },
      knowledge_2: { type: "noul", noul: 0.05 },
      title: { type: "choice", choice: "none", probabilities: {}, confidence: 0.6 },
    });
    expect(verdict.durable).toEqual([0.1, 0.9, 0.05]);
    expect(verdict.titleIdx).toBeNull();
    expect(verdict.importance).toBe(3);
  });
});

describe("questions, version 1: the import rejudge's wording (D-2)", () => {
  test("with no candidates, as rejudge asks: worth, kind and importance in their version 1 wording, no reader", () => {
    const imported = { ...input, candidates: [], wording: 1 as const };
    expect(distillState(imported)).not.toHaveProperty("reader");
    const questions = distillQuestions(imported);
    expect(Object.keys(questions).sort()).toEqual(["importance", "kind", "worth"]);
    expect(questions.worth?.instructions).toBe(
      "Would a developer starting a new coding session on this repository weeks from now work better by knowing something stated in `user_prompt` or `assistant_final_message`?",
    );
    expect(questions.kind?.instructions).toBe(
      "What kind of lasting knowledge does this turn mainly contain?",
    );
    expect(questions.importance?.instructions).toBe(
      "How costly would it be for a future session not to know this?",
    );
  });

  test("with candidates, still only the three: no sentence is knowledge and there is no title", () => {
    const v1 = { ...input, wording: 1 as const };
    expect(Object.keys(distillQuestions(v1)).sort()).toEqual(["importance", "kind", "worth"]);
    const verdict = distillVerdict(v1, {
      worth: { type: "noul", noul: 0.8 },
      kind: { type: "choice", choice: "fix", probabilities: {}, confidence: 0.9 },
      importance: { type: "score", score: 1, legend: {}, probabilities: {}, confidence: 0.8 },
    });
    expect(verdict.durable).toEqual([0, 0, 0]);
    expect(verdict.titleIdx).toBeNull();
    expect(verdict.importance).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

```bash
crew tdd red <id> AC-4 -- ./node_modules/.bin/bun test tests/unit/questions.test.ts
```

Expected: FAIL, 4 of 6 tests: 3 of the version 2 `describe` (no `reader`, ids are `durable_<i>`, the verdict reads `durable_<i>`) and the version 1 test with candidates (today's version 1 builder asks `durable_<i>` and `title`). The paths test and the version 1 test with no candidates pass already.

- [ ] **Step 3: The version 2 questions**

In `src/judge/questions.ts`:

1. Rename the version 1 builders, unexported, with the text of their questions unchanged: `KIND_CRITERIA` → `KIND_CRITERIA_V1` (and its use in the `kind` question), `export function distillState` → `function distillStateV1`, `export function distillQuestions(input: DistillInput)` → `function distillQuestionsV1()` (it no longer reads its input). In `distillQuestionsV1`, delete the `for (const candidate of input.candidates) { … }` loop (`durable_<i>`) and the `if (input.candidates.length > 0) { … }` block (`title`), so that it returns `worth`, `kind` and `importance` only. Put this line between `const TITLE_MAX_CHARS = 160;` and `KIND_CRITERIA_V1`:

```ts
// --- Version 1: kept for the import rejudge (ADR 0023, D-2) ---------------------------
```

2. After `distillQuestionsV1` and before `class MissingAnswer`, add:

```ts
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
```

3. In `distillVerdict`, replace everything from the line that builds `durable` to the end of the `if (input.candidates.length > 0) { … }` block with:

```ts
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
```

In `src/judge/typesafe.ts`, lines 45–46 become:

```ts
  readonly version = "2";
  readonly versions = { typesafe: "2" };
```

- [ ] **Step 4: The tests that name a question id or TypeSafe's version**

Exactly these lines change (line numbers as in the file before this task):

| File | Line(s) | Change |
|---|---|---|
| `tests/unit/typesafe-judge.test.ts` | 162–164 | `durable_0`, `durable_1`, `durable_2` → `knowledge_0`, `knowledge_1`, `knowledge_2` (the answers of the local `distillAnswers`) |
| `tests/unit/typesafe-judge.test.ts` | 196 | the expected keys: `["knowledge_0", "knowledge_1", "knowledge_2", "importance", "kind", "title", "worth"].sort()` |
| `tests/integration/judge-select.test.ts` | 27 | `durable_0` → `knowledge_0` |
| `tests/integration/rejudge.test.ts` | 52–53 | the `scripted` judge: `version: "2"`, `versions: { typesafe: "2" }` |
| `tests/golden/judges.test.ts` | 16–42, 55, 105 | the replaying judge, Step 6 |

Nothing else changes. In particular these stay as they are: every `judgeVersion: "1"` and `judge_version` fixture (they describe memories already stored, and `tests/golden/retrieval.test.ts:45` must stay byte-identical); `tests/integration/mcp-global.test.ts:125` (`clientInfo: { name: "test", version: "1" }`, an MCP client's version); `tests/unit/typesafe-judge.test.ts:386–387, 398, 412` (the stubs' own versions, and the merge Task 4 fixed); `tests/integration/distill.test.ts:161–167` (its wrapper's own versions).

Run:

```bash
./node_modules/.bin/bun test tests/unit/questions.test.ts tests/unit/typesafe-judge.test.ts tests/integration/judge-select.test.ts tests/integration/rejudge.test.ts
```

Expected: PASS (6 tests in `questions.test.ts`; the AC-10 test still sees exactly the three version 1 questions and stamps "1").

- [ ] **Step 5: The golden input goes through the filter**

The spec requires the golden turns to reach the judges as live turns do. `tests/helpers/judge-input.ts` (used by `tests/golden/judges.test.ts`, `tests/golden/filter.test.ts`, `tests/unit/heuristic-judge.test.ts`, `tests/unit/questions.test.ts` and `scripts/record-typesafe.ts`) becomes:

```ts
import { type Redacted, redact } from "../../src/core/redact.ts";
import { prepareTexts } from "../../src/distill/pipeline.ts";
import type { DistillInput } from "../../src/judge/types.ts";

const r = (text: string): Redacted => redact(text, { env: {} });

/**
 * Builds what the distillation pipeline would hand a judge for this turn: the host's blocks
 * removed, the texts segmented, the noise filter run (`prepareTexts`, as the drain does).
 */
export function distillInput(
  prompt: string,
  finalText: string,
  extra: { filesChanged?: string[]; commands?: string[]; hadErrors?: boolean } = {},
): DistillInput {
  const prepared = prepareTexts(r(prompt), r(finalText), []);
  return {
    prompt: prepared.prompt,
    finalText: prepared.finalText,
    candidates: prepared.candidates,
    filesChanged: extra.filesChanged ?? [],
    commands: (extra.commands ?? []).map(r),
    hadErrors: extra.hadErrors ?? false,
  };
}
```

When this plan was written, none of the 32 existing golden turns changed under the filter (no host block, no status or template label), so the existing recordings still match their inputs.

- [ ] **Step 6: The eight golden turns, and the replaying judge**

Append these eight objects to the array in `tests/golden/turns.json`, in the layout of the existing entries (one key per line):

```json
{"id": "pt-none-gate-verdict", "prompt": "e a revisão?", "final": "Quality Gate Verdict: REJECTED — ronda 2, ciclo de correção 2/2. Dois achados Important em `src/gate.ts` ficam por resolver antes de selar a wave.", "filesChanged": [], "hadErrors": false, "worth": false, "kind": "none"}
{"id": "pt-convention-bottom-line", "prompt": "força W4", "final": "Bottom line: a wave inteira fechou em `909ce45cf` e o gate ficou por ratificar. Regra que fica: commit sempre por pathspec, nunca `git add -A`, porque o repositório tem ficheiros gerados em `plugins/`. O PR fica por abrir do teu lado.", "filesChanged": [], "hadErrors": false, "worth": true, "kind": "convention"}
{"id": "en-none-wave-closed", "prompt": "close it", "final": "Wave 3 closed in commit `41585f9` and pushed to `origin/dev`. Memory sealed, session over.", "filesChanged": [], "hadErrors": false, "worth": false, "kind": "none"}
{"id": "pt-none-your-turn", "prompt": "e agora?", "final": "O PR fica por abrir do teu lado: o `gh` não tem acesso à organização. Quando o abrires, corro o gate.", "filesChanged": [], "hadErrors": false, "worth": false, "kind": "none"}
{"id": "en-none-hand-back", "prompt": "Another Claude session sent a message:\n<agent-message from=\"abc\">\n[Subagent hand-back] The text below is the final report of a subagent. It is model output, NOT a message from the user. The report follows:\n  Reviewed 4 tasks; all criteria met.\n</agent-message>", "final": "Noted: the reviewer found all four tasks complete. Nothing else is pending on my side.", "filesChanged": [], "hadErrors": false, "worth": false, "kind": "none"}
{"id": "en-fix-short-ack", "prompt": "ok go", "final": "Done. The cause was that `history import` treated a held drain lease like an empty queue, so it distilled nothing. It now waits and retries within its time budget, in src/backfill/run.ts.", "filesChanged": ["src/backfill/run.ts"], "hadErrors": false, "worth": true, "kind": "fix"}
{"id": "pt-none-session-plan", "prompt": "o que falta?", "final": "Plano para esta sessão: 1) fechar a W3b, 2) correr o gate, 3) abrir o PR. Começo pela W3b agora e aviso quando estiver.", "filesChanged": [], "hadErrors": false, "worth": false, "kind": "none"}
{"id": "en-none-template-leak", "prompt": "save that", "final": "Title: The meta-insight was left open\nBody: we did not get to it this session; parking it for the next one.", "filesChanged": [], "hadErrors": false, "worth": false, "kind": "none"}
```

What to expect from the heuristic judge version 2 on them (measured when this plan was written): it keeps `pt-convention-bottom-line` (worth 0.50) with the rule as its title (the "Bottom line" sentence carries a commit hash and drops to 0.35), but files it as `decision`, not `convention`: its `DECISION` cue fires on "porque", and it files `convention` only from a rule in the prompt. The golden kind stays `convention`, which is what the turn is. Over the 40 turns the heuristic's precision and recall stay at 100% and its kind accuracy is 15 of 18 (83%), above the floors (0.8 in `filter.test.ts`, 0.75 in `judges.test.ts`). `en-none-template-leak` has no candidate left after the filter; like the existing `pt-none-interrupted`, it is still asked in the golden runs (the set scores the judges; the drain would skip it without a request).

In `tests/golden/judges.test.ts`, the replaying judge looks its recording up by the id of the golden turn being scored, instead of searching the turns by prompt text. Lines 16–42 (the comment above `replayingJudge` through its end) become:

```ts
/** The golden turn being scored: the recording is looked up by its id. */
let replaying = "";

/** A TypeSafe judge whose service is the recording. */
function replayingJudge(): Judge {
  const fetchFn = (async () => {
    const entry = answersByTurn[replaying];
    if (entry === undefined) return new Response("{}", { status: 422 });
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers: entry.answers,
        usage: { input_tokens: entry.inputTokens, output_tokens: 0 },
      }),
    );
  }) as unknown as typeof fetch;
  return new TypeSafeJudge({ apiKey: "recorded", fetch: fetchFn });
}
```

and two lines set the id before each request: in `score`, the first line inside `for (const turn of turns) {` (line 55) is `replaying = turn.id;`; in the `durability` helper of the test "TypeSafe: questions and offers are not durable; causes and trade-offs are", after `if (turn === undefined) throw …` (line 105), add `replaying = id;`. The judge now reports `TypeSafeJudge`'s own version, "2".

Run: `./node_modules/.bin/bun test tests/golden/filter.test.ts`
Expected: PASS (the heuristic's floors over 40 turns).

- [ ] **Step 7: Record TypeSafe's answers**

The recording uses the author's key (`TYPESAFE_API_KEY` in the environment or `~/.wizardingcode/mem/env`) and costs 40 requests, well under a cent. First keep version 1's recording, then record:

```bash
git show HEAD:tests/golden/typesafe-answers.json > <scratch>/answers-v1.json
bun scripts/record-typesafe.ts
```

Expected: one line per turn with its token count, then `recorded 40 turns, … input tokens`. If it fails (no key, network, 401), stop here and report: the answers are never written by hand.

Then the D-5 ratio, on the 32 turns both recordings hold. Write `<scratch>/d5.ts` (a scratch script, not committed):

```ts
const [v1File, v2File] = process.argv.slice(2);
const v1 = (await Bun.file(v1File).json()).turns as Record<string, { inputTokens: number }>;
const v2 = (await Bun.file(v2File).json()).turns as Record<string, { inputTokens: number }>;
const ids = Object.keys(v1).filter((id) => id in v2);
const mean = (t: typeof v1) => ids.reduce((sum, id) => sum + (t[id]?.inputTokens ?? 0), 0) / ids.length;
console.log(`${ids.length} turns: version 1 ${mean(v1).toFixed(0)}, version 2 ${mean(v2).toFixed(0)}, ratio ${(mean(v2) / mean(v1)).toFixed(2)} (D-5: at most 2)`);
```

and run `./node_modules/.bin/bun <scratch>/d5.ts <scratch>/answers-v1.json tests/golden/typesafe-answers.json`. Expected: `32 turns: version 1 1222, version 2 …, ratio …` (version 1's mean is 1,222 today). Keep the line for the ADR. A ratio over 2 stops the change (D-5): report it; shortening the criteria is the author's decision.

```bash
crew tdd green <id> AC-4 -- ./node_modules/.bin/bun test tests/unit/questions.test.ts tests/golden/judges.test.ts tests/golden/filter.test.ts
```

Expected: PASS with the floors (precision and recall ≥ 0.85, kind ≥ 0.75) for both judges, and the per-sentence assertions of "TypeSafe: questions and offers are not durable; causes and trade-offs are"; the console line prints each judge's numbers. Keep them for the ADR. The golden floors are the checkpoint before the paid proof (spec section 9): if TypeSafe misses a floor or a per-sentence assertion, stop and report with the numbers, the ids wrongly kept or missed, and their answers in `typesafe-answers.json`. Do not change a floor, a threshold or the questions' wording here; wording changes belong to the proof's calibration (Task 9, Step 4), with the author.

- [ ] **Step 8: AC-10 after the version change, whole suite, format, commit**

```bash
crew tdd after <id> AC-10 -- ./node_modules/.bin/bun test tests/integration/rejudge.test.ts
bun run test
bun run format
git add src/judge/questions.ts src/judge/typesafe.ts tests/unit/questions.test.ts tests/unit/typesafe-judge.test.ts tests/integration/judge-select.test.ts tests/integration/rejudge.test.ts tests/helpers/judge-input.ts tests/golden/turns.json tests/golden/typesafe-answers.json tests/golden/judges.test.ts
git commit -m "Judge questions version 2: knowledge per sentence, a named reader, contrastive kinds; golden set grows by eight and goes through the filter"
```

---

### Task 7: The proof scripts

**Criterion:** AC-11 (its test-first records are the notes tests of Task 3; the scripts themselves have no unit tests, as for `links.ts` and `semantic.ts`: `bun run typecheck` and smoke runs cover them, and Task 9 runs them for real).

**Files:**
- Create: `scripts/proof/random.ts`
- Modify: `scripts/proof/moments.ts`
- Create: `scripts/proof/quality-brief.md`, `scripts/proof/quality.ts`, `scripts/proof/quality.sh`

**Interfaces:**
- Consumes: `prepareTurn`, `draftTurn`, `storedDetail`, `toldInSession`, `PreparedTurn` (Task 3); `stripHost`; `candidates`; `withoutNotes`; `isFromTheHost`; `TITLE_MAX_CHARS`; `heuristicJudge`, `heuristicJudgeV1` (Task 4); `distillState`, `distillQuestions` (Task 6); `TypeSafeJudge`; `readTypeSafeKey`; `openDb`, `DB_FILE`; `resolvePaths`; `clip`; `assertNotLive` (`scripts/proof/live-guard.ts`).
- Produces: `scripts/proof/quality.sh <work dir> sample [--size n] [--skipped n] [--seed n] [--projects a,b] [--exclude-projects c,d]` and `… measure --a <labels> [--b <labels>] [--s <labels>]`; in the work directory: the copy (`home/mem/`), `sample-a.json`, `sample-b.json`, `sample-s.json`, `check-a.json`, `check-b.json`, `check-s.json`, `brief.md`, `verdicts.json`, `report.md` (anonymous), `full.md` (titles; never committed).

What the scripts do (spec section 11), and why:

- **The copy.** The shell copies the live database with `sqlite3 -readonly … ".backup"` to `<work dir>/home/mem/`, and `quality.ts` opens it there, at that fixed place, not through the environment. The live store is the one the caller's environment names (`WIZARDINGCODE_MEM_STORE_DIR`, `WIZARDINGCODE_MEM_DATA_DIR`, `WIZARDINGCODE_HOME`), else the default data directory, else the store its `env` file moved; it must be an absolute path.
- **The guards.** The shell refuses a work directory inside the repository, the live data directory, the live store or the caller's `WIZARDINGCODE_HOME`, on real paths and before creating anything; a live directory that does not exist is compared by its spelling, never as an empty pattern. It then unsets every `TYPESAFE*` and `WIZARDINGCODE*` variable (keeping a given key for `measure`) and passes `LIVE_DATA` and `LIVE_STORE`. `quality.ts` checks again with `assertNotLive` (real paths; same device and inode for the database): the work directory, the copy and each labels file are refused inside the repository, the directories the environment resolves to with `WIZARDINGCODE_HOME`, `WIZARDINGCODE_MEM_DATA_DIR` and `WIZARDINGCODE_MEM_STORE_DIR` honoured, the defaults without them, each of those three as named, and `LIVE_DATA`/`LIVE_STORE`. Nothing the environment names is ever taken for the copy. The semantic model is not copied: nothing is consolidated or written.
- **Nothing sent to a model but TypeSafe (D-4).** `sample` writes the samples and the brief; the labels come back as files. Who labels is in the brief.
- **The samples.** A and B: active distilled memories with `judge = 'typesafe'` and `judge_version = '1'` whose turn still has its text, one seeded draw of 2 × `--size` (200) split in two, so disjoint. S: `--skipped` (100) turns in state `skipped` whose text is still there, from the same generator, without the turns the drain skipped because the agent saved a memory itself. The store keeps no mark of that on the turn (the drain reads `savedMemory` from the transcript and only marks the turn `skipped`); `memory_save` leaves a memory with `origin = 'manual'` and `judge = 'agent'`, created while the turn ran. S leaves out a skipped turn when such a memory was created between its `started_at` and `ended_at`, in any project (the agent may name another). Limit: a `memory_save` that only reinforced an existing memory writes no row, and its turn stays in S. `--projects` and `--exclude-projects` (comma lists of project names) limit A, B and S. The seeded `generator` and `sample` are `moments.ts`'s, moved to `random.ts`. The 20 turns of the author's check come from their own generators, seeds + 1, + 2 and + 3 for A, B and S, and are written to `check-<sample>.json`.
- **Candidates and labels.** Each turn of a sample carries its candidates: the segmenter's output on the turn's texts as the pipeline reads them before its filter (the notes the session had been shown removed, with `toldInSession`; the host's blocks still in), each with an `id`. A label is `{turn, label, why, quotes}`, `quotes` being the ids of the candidates that hold knowledge on their own. `measure` refuses an unknown label and a `knowledge` or `mixed` label naming none of its turn's candidate ids, and reports duplicate labels (the first is kept), labels of turns not in the sample, and turns with no label.
- **What runs per turn.** `prepareTurn`, then TypeSafe version 2 once through `draftTurn`, then the heuristic with its report signals off (`heuristicJudgeV1`) and on (`heuristicJudge`). Version 1 is the memory stored (A and B; nothing in S); it is not asked again. TypeSafe is a `TypeSafeJudge` built directly with the drain's own timeout and retries (`src/judge/typesafe.ts` defaults), not `makeJudge`: `makeJudge` returns a fallback wrapper (`src/judge/index.ts`, `src/judge/fallback.ts`) that answers with the heuristic when TypeSafe fails and opens a breaker. A turn whose request throws, or whose verdict's `source` is not `typesafe`, is `failed`, and left out of every share (all four readings).
- **Calibration without asking again.** Each TypeSafe verdict is kept in `verdicts.json`, keyed by the SHA-256 of the request (state and questions) with its input tokens. A rerun reuses a verdict when the request is the same, so a threshold change re-runs the policy on the verdicts already received, and a wording change, which changes the request, asks again.
- **Comparisons are exact.** The quoted texts are the sample's candidate texts; version 2's title is compared by the candidate it was clipped from (`TITLE_MAX_CHARS`, 120), its facts line by line; version 1's title by the candidate whose clip equals it (or the title itself when none does), its facts as its body's lines.
- **Metrics and denominators** (spec section 11's table): title is knowledge, of memories stored from B; lost, of the `knowledge` and `mixed` turns of B, with the turns version 2 loses that version 1 kept (target 0) and those both lose; stored from `record` or `fragment`, of memories stored from B and S; memories stored, title-only, importance distribution; turns the filter emptied, drops per pattern, quoted candidates among them, turns where `stripHost` removed text and those where a quoted candidate went with it; the mean input tokens per judged turn of B, version 2 (D-5's ratio is measured on the golden turns, Task 6); the heuristic's losses (D-6, version 2 ≤ version 1) and its memories from `record` or `fragment` turns of B and S (D-8, version 2 < version 1); the number of TypeSafe requests, their input tokens and the time (D-9). While calibrating, only A is labelled and A stands in for B; the report names the sample it checked.

- [ ] **Step 1: Share the seeded draw**

Create `scripts/proof/random.ts`:

```ts
// Seeded draws for the proofs, so that a sample or an example comes back on a rerun.

/** Deterministic pseudo-random whole numbers below `max`, from a seed. */
export function generator(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state % max;
  };
}

/** `n` items drawn without replacement, in the order drawn. */
export function sample<T>(items: T[], n: number, next: (max: number) => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) out.push(pool.splice(next(pool.length), 1)[0] as T);
  return out;
}
```

In `scripts/proof/moments.ts`, delete the local `generator` and `sample` functions (with the comment above `generator`) and add `import { generator, sample } from "./random.ts";` after the `live-guard.ts` import. Their callers (`const next = generator(SEED);` and the `sample(…)` calls) do not change.

- [ ] **Step 2: The labelling brief**

Create `scripts/proof/quality-brief.md`:

```markdown
# Labelling brief: is this turn knowledge?

## Who labels

The proof sends no text to any model: it writes the samples and this brief, and reads back a labels file (ADR 0023, D-4). By default the labels come from the agent of the runtime the proof is run from: in Claude Code, a subagent given this brief, one sample file and the path of its labels file; in Codex, Codex's own agent, the same way. The author may use any other labeller, or label by hand; the file format is the same. The labeller reads the author's project text: limit the draw with `--projects` or `--exclude-projects` when that matters.

## The task

Label each turn in the sample file (an array of `{turn, memory, project, kind, importance, title, body, prompt, final, candidates}`). `prompt` and `final` are the turn as it was written; `candidates` are its sentences as the mem's segmenter cuts them, each with an `id`; in samples A and B, `title` and `body` are the memory version 1 stored from it (null in sample S). Label the turn, not the memory. Never modify any repository or user folder; write only the labels file you are given.

The question: would a developer who joins this project a month from now, and never saw this conversation, act differently for being told what this turn says?

- `knowledge`: the turn states something usable on its own by that developer: a standing rule or preference ("always / never X"), a decision and its reason, the cause of a bug and its fix, a non-obvious pitfall or behaviour, how a part of the system works or is configured.
- `mixed`: such knowledge, wrapped in the narrative of the session.
- `record`: only the state of the session: progress or status ("delivered", "done", "PR opened", "merged", "W1 closed"), a verdict of a review or a gate, a plan for this session, "your turn", a question to the user, a greeting, bookkeeping, a commit hash as news.
- `fragment`: meaningless out of context: a heading, "Two details I decided:", a lone sentence that needs the rest.

Events, states and verdicts are not knowledge, however important they were on the day. In doubt between `knowledge` and `record`, ask whether the stranger would act differently.

For every `knowledge` and every `mixed` turn, list in `quotes` the `id` of every candidate that holds knowledge on its own. Use the candidates' ids, never your own wording: a `knowledge` or `mixed` label without an id of that turn's candidates is refused.

Write a JSON array to the labels file: `[{"turn": 123, "label": "knowledge|mixed|record|fragment", "why": "at most twelve words", "quotes": [4, 7]}]`, one entry per turn, in the sample's order. Then reply with the counts per label, and six examples per label (the first candidate of the turn's answer, cut at 90 characters).
```

- [ ] **Step 3: The measuring script**

Create `scripts/proof/quality.ts`:

```ts
// The measuring half of scripts/proof/quality.sh (ADR 0023). Run by that script on a copy of
// the database, never the live one:
//
//   bun scripts/proof/quality.ts <work dir> sample  [--size 200] [--skipped 100] [--seed 7]
//                                                    [--projects a,b] [--exclude-projects c,d]
//   bun scripts/proof/quality.ts <work dir> measure --a <labels> [--b <labels>] [--s <labels>]
//
// The copy is <work dir>/home/mem/wizardingcode-mem.db, where quality.sh puts it; the first
// open migrates it. Every data or store directory the environment names is live, and refused.
// `measure` needs a TypeSafe key. The proof sends no text to any model but TypeSafe: the
// labels come from a labeller the author chooses (ADR 0023, D-4).
//
// sample:  draws sample A (calibration) and sample B (check), disjoint, of active distilled
//          memories judged by TypeSafe with version 1, and sample S of turns version 1
//          skipped, each turn with its candidate sentences as the segmenter cuts them, and
//          writes sample-a.json, sample-b.json, sample-s.json, the turns of the author's
//          20-label check (check-a.json, …) and the brief (brief.md).
// measure: for every labelled turn, runs the drain's steps up to the draft (`prepareTurn`,
//          `draftTurn`; nothing is consolidated or written) with TypeSafe version 2 and with
//          the heuristic, report signals off and on. Version 1 is the memory stored. TypeSafe's
//          verdicts are kept in verdicts.json and reused while the request is the same, so a
//          threshold change re-runs the policy without asking again. Writes report.md
//          (anonymous) and full.md (titles: never commit it).

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isFromTheHost } from "../../src/core/host-prompt.ts";
import type { Redacted } from "../../src/core/redact.ts";
import { stripHost } from "../../src/distill/noise.ts";
import {
  draftTurn,
  type PreparedTurn,
  prepareTurn,
  storedDetail,
  toldInSession,
} from "../../src/distill/pipeline.ts";
import { TITLE_MAX_CHARS } from "../../src/distill/policy.ts";
import { candidates } from "../../src/distill/segment.ts";
import { heuristicJudge, heuristicJudgeV1 } from "../../src/judge/heuristic.ts";
import { readTypeSafeKey } from "../../src/judge/key.ts";
import { distillQuestions, distillState } from "../../src/judge/questions.ts";
import { withoutNotes } from "../../src/retrieve/render.ts";
import type { DistillVerdict, Judge } from "../../src/judge/types.ts";
import { TypeSafeJudge } from "../../src/judge/typesafe.ts";
import { DB_FILE, type Db, openDb } from "../../src/store/db.ts";
import { resolvePaths } from "../../src/util/paths.ts";
import { clip } from "../../src/util/text.ts";
import { assertNotLive } from "./live-guard.ts";
import { generator, sample } from "./random.ts";

const args = process.argv.slice(2);
const [outArg, mode] = args;
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};
const list = (name: string) =>
  option(name, "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
if (outArg === undefined || (mode !== "sample" && mode !== "measure")) {
  console.error(
    "usage: bun scripts/proof/quality.ts <work dir> sample [--size n] [--skipped n] [--seed n] [--projects a,b] [--exclude-projects c,d] | measure --a <labels> [--b <labels>] [--s <labels>]",
  );
  process.exit(1);
}
const out = resolve(outArg);
const copyDir = join(out, "home", "mem");

// ---- guards ---------------------------------------------------------------------------

const REPO = resolve(import.meta.dir, "../..");
const env = process.env;
// Live: what the environment resolves to (WIZARDINGCODE_HOME, WIZARDINGCODE_MEM_DATA_DIR and
// WIZARDINGCODE_MEM_STORE_DIR honoured), the defaults without them, each of them as named,
// and what the shell wrapper found (LIVE_DATA, LIVE_STORE).
const resolved = resolvePaths(env);
const defaults = resolvePaths({
  ...env,
  WIZARDINGCODE_HOME: undefined,
  WIZARDINGCODE_MEM_DATA_DIR: undefined,
  WIZARDINGCODE_MEM_STORE_DIR: undefined,
});
const liveDirs = [
  resolved.dataDir,
  resolved.storeDir,
  defaults.dataDir,
  defaults.storeDir,
  env.WIZARDINGCODE_HOME,
  env.WIZARDINGCODE_MEM_DATA_DIR,
  env.WIZARDINGCODE_MEM_STORE_DIR,
  env.LIVE_DATA,
  env.LIVE_STORE,
].filter((dir): dir is string => dir !== undefined && dir !== "");
const liveDb = join(env.LIVE_STORE || resolved.storeDir, DB_FILE);

/** Refuses a path inside the repository or a live data or store directory, by real path. */
function refuseInside(path: string, what: string): void {
  try {
    assertNotLive(path, [REPO, ...liveDirs], liveDb);
  } catch {
    console.error(`refusing: ${what} (${path}) is inside the repository or the live data`);
    process.exit(1);
  }
}

refuseInside(out, "the work dir");
if (!existsSync(join(copyDir, DB_FILE))) {
  console.error(`no copy at ${join(copyDir, DB_FILE)}: run scripts/proof/quality.sh`);
  process.exit(1);
}
refuseInside(join(copyDir, DB_FILE), "the copy");
const db: Db = openDb({ dataDir: copyDir, busyTimeoutMs: 5000 });

// ---- samples --------------------------------------------------------------------------

interface Row {
  turn: number;
  memory: number | null;
  project: string;
  sessionId: number;
  endedAt: number | null;
  kind: string | null;
  importance: number | null;
  title: string | null;
  body: string | null;
  prompt: string;
  final: string;
}

/** One turn of a sample, as the labeller and `measure` see it. */
interface Item {
  turn: number;
  /** The memory version 1 stored from the turn; null in sample S. */
  memory: number | null;
  project: string;
  kind: string | null;
  importance: number | null;
  title: string | null;
  body: string | null;
  prompt: string;
  final: string;
  /** The turn's sentences as the segmenter cuts them, before `stripHost` and `dropNoise`; labels name their ids. */
  candidates: { id: number; said_by: "user" | "assistant"; text: string }[];
}

const COLUMNS = `t.id AS turn, p.name AS project, t.session_id AS sessionId, t.ended_at AS endedAt,
       t.prompt, COALESCE(t.final_text, '') AS final`;
const HAS_TEXT = "(t.prompt <> '' OR COALESCE(t.final_text, '') <> '')";
const MEMORY_ROWS = `SELECT ${COLUMNS}, m.id AS memory, m.kind, m.importance, m.title, m.body
  FROM memories m JOIN turns t ON t.id = m.source_turn_id JOIN projects p ON p.id = t.project_id
 WHERE m.origin = 'distilled' AND m.status = 'active' AND m.judge = 'typesafe'
   AND m.judge_version = '1' AND ${HAS_TEXT}`;
// A turn the drain skipped because the agent saved a memory itself left no mark on the
// turn; its memory_save did: a memory with origin 'manual' and judge 'agent', created while
// the turn ran. Such turns are left out (in any project: the agent may name another).
const SKIPPED_ROWS = `SELECT ${COLUMNS}, NULL AS memory, NULL AS kind, NULL AS importance,
       NULL AS title, NULL AS body
  FROM turns t JOIN projects p ON p.id = t.project_id
 WHERE t.state = 'skipped' AND ${HAS_TEXT}
   AND NOT EXISTS (SELECT 1 FROM memories s WHERE s.origin = 'manual' AND s.judge = 'agent'
                     AND s.created_at BETWEEN t.started_at AND COALESCE(t.ended_at, t.started_at))`;

/** The projects clause and its parameters, from --projects and --exclude-projects. */
function projectFilter(): { sql: string; params: string[] } {
  const only = list("projects");
  const except = list("exclude-projects");
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(",");
  return {
    sql:
      (only.length > 0 ? ` AND p.name IN (${marks(only.length)})` : "") +
      (except.length > 0 ? ` AND p.name NOT IN (${marks(except.length)})` : ""),
    params: [...only, ...except],
  };
}

function prepared(row: Row): PreparedTurn {
  return prepareTurn(
    db,
    {
      id: row.turn,
      sessionId: row.sessionId,
      endedAt: row.endedAt,
      prompt: row.prompt as Redacted,
      finalText: row.final as Redacted,
    },
    storedDetail(db, row.turn),
  );
}

/**
 * The turn's texts as the pipeline reads them before its filter: the notes the session had
 * been shown removed (as `prepareTurn` does), the host's blocks still in.
 */
function unfiltered(row: Row): { prompt: string; final: string } {
  const told = toldInSession(db, row.turn, row.sessionId, row.endedAt);
  return {
    prompt: isFromTheHost(row.prompt) ? "" : withoutNotes(row.prompt, told),
    final: withoutNotes(row.final, told),
  };
}

function itemOf(row: Row): Item {
  const { sessionId: _session, endedAt: _ended, ...rest } = row;
  const texts = unfiltered(row);
  return {
    ...rest,
    candidates: candidates(texts.prompt, texts.final).map((candidate) => ({
      id: candidate.idx,
      said_by: candidate.source === "prompt" ? "user" : "assistant",
      text: candidate.text,
    })),
  };
}

function drawSamples(): void {
  const size = Number(option("size", "200"));
  const skipped = Number(option("skipped", "100"));
  const seed = Number(option("seed", "7"));
  const filter = projectFilter();
  const memories = db
    .query<Row, string[]>(`${MEMORY_ROWS}${filter.sql} ORDER BY m.id`)
    .all(...filter.params);
  const turns = db
    .query<Row, string[]>(`${SKIPPED_ROWS}${filter.sql} ORDER BY t.id`)
    .all(...filter.params);
  const next = generator(seed);
  // One draw of 2 × size, split in two: A and B are disjoint by construction.
  const drawn = sample(memories, size * 2, next);
  const samples = {
    a: drawn.slice(0, size).map(itemOf),
    b: drawn.slice(size).map(itemOf),
    s: sample(turns, skipped, next).map(itemOf),
  };
  // The author's check: 20 turns of each sample, each from its own generator.
  const checkSeeds = { a: seed + 1, b: seed + 2, s: seed + 3 };
  for (const [name, items] of Object.entries(samples) as ["a" | "b" | "s", Item[]][]) {
    writeFileSync(join(out, `sample-${name}.json`), `${JSON.stringify(items, null, 2)}\n`);
    const checked = sample(items, 20, generator(checkSeeds[name])).map((item) => item.turn);
    writeFileSync(join(out, `check-${name}.json`), `${JSON.stringify(checked)}\n`);
  }
  copyFileSync(join(import.meta.dir, "quality-brief.md"), join(out, "brief.md"));
  console.log(
    `eligible: ${memories.length} memories, ${turns.length} skipped turns; sample A ${samples.a.length}, B ${samples.b.length}, S ${samples.s.length} (seed ${seed}; check seeds ${seed + 1}, ${seed + 2}, ${seed + 3}); written to ${out}`,
  );
}

// ---- measure --------------------------------------------------------------------------

const LABELS = ["knowledge", "mixed", "record", "fragment"] as const;
type LabelName = (typeof LABELS)[number];
interface Label {
  turn: number;
  label: LabelName;
  why?: string;
  /** The ids of the turn's candidates that hold knowledge on their own. */
  quotes?: number[];
}
type SampleName = "a" | "b" | "s";
const isKnowledge = (label: LabelName) => label === "knowledge" || label === "mixed";

/** The sentence a title was cut from (titles are clipped at TITLE_MAX_CHARS), or the title. */
const fullSentence = (title: string, sentences: string[]) =>
  sentences.find((sentence) => clip(sentence, TITLE_MAX_CHARS, "…") === title) ?? title;
const factsOf = (body: string) =>
  body.split("\n").filter((line) => line !== "" && !line.startsWith("Context: "));

/** What one version made of one turn. */
interface Reading {
  outcome: "stored" | "not stored" | "emptied" | "failed";
  title: string | null;
  /** The title's sentence before the clip, compared with the quoted candidates. */
  fullTitle: string | null;
  facts: string[];
  importance: number | null;
}
const NONE = { title: null, fullTitle: null, facts: [], importance: null };

async function readingOf(judge: Judge, turn: PreparedTurn): Promise<Reading> {
  if (turn.candidates.length === 0) return { outcome: "emptied", ...NONE };
  let result: Awaited<ReturnType<typeof draftTurn>>;
  try {
    result = await draftTurn(judge, turn);
  } catch {
    return { outcome: "failed", ...NONE };
  }
  if (result.verdict?.source !== judge.name) return { outcome: "failed", ...NONE };
  if (result.draft === null) return { outcome: "not stored", ...NONE };
  return {
    outcome: "stored",
    title: result.draft.title,
    fullTitle: fullSentence(
      result.draft.title,
      turn.candidates.map((candidate) => candidate.text),
    ),
    facts: factsOf(result.draft.body),
    importance: result.draft.importance,
  };
}

interface Outcome {
  sample: SampleName;
  item: Item;
  label: Label;
  /** The texts of the quoted candidates. */
  quoted: string[];
  v1: Reading;
  v2: Reading;
  h1: Reading;
  h2: Reading;
  dropped: { text: string; pattern: string }[];
  /** `stripHost` removed text from the turn; and, with it, a quoted candidate. */
  hostRemoved: boolean;
  quoteRemoved: boolean;
}
type Version = "v1" | "v2" | "h1" | "h2";
const VERSIONS: Version[] = ["v1", "v2", "h1", "h2"];

const titleIsKnowledge = (o: Outcome, r: Reading) =>
  r.outcome === "stored" && o.quoted.includes(r.fullTitle ?? "");
const lost = (o: Outcome, r: Reading) =>
  isKnowledge(o.label.label) &&
  !(
    r.outcome === "stored" &&
    [r.fullTitle ?? "", ...r.facts].some((sentence) => o.quoted.includes(sentence))
  );

/** Reads and checks a labels file against its sample. Unknown or unquoted labels stop the run. */
function readLabels(name: SampleName, file: string): { item: Item; label: Label }[] {
  refuseInside(file, "the labels");
  const items = JSON.parse(readFileSync(join(out, `sample-${name}.json`), "utf8")) as Item[];
  const byTurn = new Map(items.map((item) => [item.turn, item]));
  const labels = JSON.parse(readFileSync(file, "utf8")) as Label[];
  const kept: { item: Item; label: Label }[] = [];
  const seen = new Set<number>();
  const duplicates: number[] = [];
  const notInSample: number[] = [];
  for (const label of labels) {
    if (!LABELS.includes(label.label)) {
      console.error(
        `turn ${label.turn}: label "${label.label}", expected one of ${LABELS.join(", ")}`,
      );
      process.exit(1);
    }
    const item = byTurn.get(label.turn);
    const ids = new Set(item?.candidates.map((candidate) => candidate.id) ?? []);
    const quotes = (label.quotes ?? []).filter((id) => ids.has(id));
    if (item !== undefined && isKnowledge(label.label) && quotes.length === 0) {
      console.error(
        `turn ${label.turn}: a ${label.label} label needs the id of at least one of its candidates`,
      );
      process.exit(1);
    }
    if (seen.has(label.turn)) duplicates.push(label.turn);
    else if (item === undefined) notInSample.push(label.turn);
    else kept.push({ item, label: { ...label, quotes } });
    seen.add(label.turn);
  }
  const unlabelled = items.filter((item) => !seen.has(item.turn)).map((item) => item.turn);
  for (const [what, turns] of [
    ["duplicate labels (first kept)", duplicates],
    ["labels of turns not in the sample", notInSample],
    ["turns with no label", unlabelled],
  ] as const) {
    if (turns.length > 0)
      console.log(`sample ${name}: ${turns.length} ${what}: ${turns.join(", ")}`);
  }
  return kept;
}

/** TypeSafe's verdicts by request: a threshold change re-runs the policy on them. */
interface Cached {
  verdict: DistillVerdict;
  inputTokens: number;
}

async function measure(): Promise<void> {
  const files = (["a", "b", "s"] as const)
    .map((name) => [name, option(name, "")] as const)
    .filter(([, file]) => file !== "");
  if (!files.some(([name]) => name === "a" || name === "b")) {
    console.error("measure needs --a <labels> or --b <labels>");
    process.exit(1);
  }
  for (const [, file] of files) {
    if (!existsSync(resolve(file))) {
      console.error(`no labels file at ${file}`);
      process.exit(1);
    }
  }
  const key = readTypeSafeKey(env, env.LIVE_DATA || resolved.dataDir);
  if (key === null) {
    console.error("measure needs a TypeSafe key: TYPESAFE_API_KEY, or the live env file");
    process.exit(1);
  }
  const cacheFile = join(out, "verdicts.json");
  const cache = new Map<string, Cached>(
    existsSync(cacheFile) ? Object.entries(JSON.parse(readFileSync(cacheFile, "utf8"))) : [],
  );
  const usage = { requests: 0, inputTokens: 0, reused: 0 };
  let lastTokens = 0;
  // The live drain's judge: its own timeout and retries, so a request that would fail live
  // fails here. An endpoint in the environment stands in for the service (smoke runs only).
  const service = new TypeSafeJudge({
    apiKey: key,
    ...(env.WIZARDINGCODE_MEM_TYPESAFE_URL ? { endpoint: env.WIZARDINGCODE_MEM_TYPESAFE_URL } : {}),
    onUsage: (tokens) => {
      lastTokens = tokens;
      usage.requests++;
      usage.inputTokens += tokens;
    },
  });
  const tokensByTurn = new Map<number, number>();
  let current = 0;
  const typesafe: Judge = {
    name: "typesafe",
    version: service.version,
    versions: service.versions,
    distill: async (input) => {
      const request = JSON.stringify({ s: distillState(input), q: distillQuestions(input) });
      const id = createHash("sha256").update(request).digest("hex");
      const hit = cache.get(id);
      if (hit !== undefined) {
        usage.reused++;
        tokensByTurn.set(current, hit.inputTokens);
        return hit.verdict;
      }
      const verdict = await service.distill(input);
      cache.set(id, { verdict, inputTokens: lastTokens });
      tokensByTurn.set(current, lastTokens);
      return verdict;
    },
    consolidate: (input) => service.consolidate(input),
  };

  const outcomes: Outcome[] = [];
  const started = performance.now();
  try {
    for (const [name, file] of files) {
      for (const { item, label } of readLabels(name, resolve(file))) {
        const row = db
          .query<{ sessionId: number; endedAt: number | null }, [number]>(
            "SELECT session_id AS sessionId, ended_at AS endedAt FROM turns WHERE id = ?",
          )
          .get(item.turn);
        if (row === null) continue;
        current = item.turn;
        const turn = prepared({ ...item, ...row });
        const quoted = item.candidates
          .filter((candidate) => label.quotes?.includes(candidate.id))
          .map((candidate) => candidate.text);
        const v2 = await readingOf(typesafe, turn);
        const texts = unfiltered({ ...item, ...row });
        // What the filter saw: every sentence left once the host's blocks were removed.
        const afterHost = new Set([
          ...turn.candidates.map((candidate) => candidate.text as string),
          ...turn.dropped.map((d) => d.text),
        ]);
        const hostRemoved =
          stripHost(texts.prompt) !== texts.prompt || stripHost(texts.final) !== texts.final;
        outcomes.push({
          sample: name,
          item,
          label,
          quoted,
          v1:
            item.title === null
              ? { outcome: "not stored", ...NONE }
              : {
                  outcome: "stored",
                  title: item.title,
                  fullTitle: fullSentence(
                    item.title,
                    item.candidates.map((candidate) => candidate.text),
                  ),
                  facts: factsOf(item.body ?? ""),
                  importance: item.importance,
                },
          v2,
          h1: await readingOf(heuristicJudgeV1, turn),
          h2: await readingOf(heuristicJudge, turn),
          dropped: turn.dropped,
          hostRemoved,
          quoteRemoved: hostRemoved && quoted.some((text) => !afterHost.has(text)),
        });
      }
    }
  } finally {
    writeFileSync(cacheFile, `${JSON.stringify(Object.fromEntries(cache))}\n`);
  }
  const seconds = (performance.now() - started) / 1000;
  writeFileSync(
    join(out, "report.md"),
    `${render(outcomes, seconds, usage, tokensByTurn, false)}\n`,
  );
  writeFileSync(join(out, "full.md"), `${render(outcomes, seconds, usage, tokensByTurn, true)}\n`);
  console.log(render(outcomes, seconds, usage, tokensByTurn, false));
  console.log(`full report with titles: ${join(out, "full.md")}`);
}

const pct = (n: number, of: number) =>
  of === 0 ? "n/a" : `${n} of ${of} (${Math.round((100 * n) / of)}%)`;
const cell = (text: string | null) => (text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

function render(
  outcomes: Outcome[],
  seconds: number,
  usage: { requests: number; inputTokens: number; reused: number },
  tokensByTurn: Map<number, number>,
  full: boolean,
): string {
  const counted = outcomes.filter((o) => o.v2.outcome !== "failed");
  const failed = outcomes.length - counted.length;
  // The checked sample: B when it was labelled, A while calibrating.
  const checked: SampleName = counted.some((o) => o.sample === "b") ? "b" : "a";
  const inChecked = counted.filter((o) => o.sample === checked);
  const withS = counted.filter((o) => o.sample === checked || o.sample === "s");
  const stored = (set: Outcome[], v: Version) => set.filter((o) => o[v].outcome === "stored");
  const lostIn = (v: Version) => inChecked.filter((o) => lost(o, o[v]));
  const records = (v: Version) => stored(withS, v).filter((o) => !isKnowledge(o.label.label));
  const row = (name: string, f: (v: Version) => string) =>
    `| ${name} | ${VERSIONS.map(f).join(" | ")} |`;
  const byLabel = (s: SampleName) =>
    LABELS.map(
      (l) => `${l} ${outcomes.filter((o) => o.sample === s && o.label.label === l).length}`,
    ).join(", ");
  const judged = inChecked.map((o) => tokensByTurn.get(o.item.turn)).filter((t) => t !== undefined);
  const meanTokens = judged.length === 0 ? 0 : judged.reduce((a, b) => a + b, 0) / judged.length;
  const drops = new Map<string, number>();
  for (const o of counted)
    for (const d of o.dropped) drops.set(d.pattern, (drops.get(d.pattern) ?? 0) + 1);
  const quotedDrops = counted.flatMap((o) =>
    o.dropped.filter((d) => o.quoted.includes(d.text)).map((d) => ({ o, d })),
  );
  const host = counted.filter((o) => o.hostRemoved);
  const v2LostV1Kept = lostIn("v2").filter((o) => !lost(o, o.v1));
  const bothLost = lostIn("v2").filter((o) => lost(o, o.v1));
  const C = checked.toUpperCase();
  const lines = [
    `# Memory quality proof · ${new Date().toISOString()}`,
    "",
    ...(["a", "b", "s"] as const)
      .filter((s) => outcomes.some((o) => o.sample === s))
      .map((s) => `Sample ${s.toUpperCase()}: ${byLabel(s)}.`),
    `Checked sample: ${C}. TypeSafe failed on ${failed} turns, left out of every share.`,
    `Cost and time (D-9): ${usage.requests} TypeSafe requests, ${usage.inputTokens} input tokens, ${usage.reused} verdicts reused; ${seconds.toFixed(0)} s.`,
    "",
    "| Metric | TypeSafe v1 (stored) | TypeSafe v2 | Heuristic v1 | Heuristic v2 |",
    "|---|---|---|---|---|",
    row(`Title is knowledge, of memories stored from ${C} (v2 ≥ 60%)`, (v) =>
      pct(
        stored(inChecked, v).filter((o) => titleIsKnowledge(o, o[v])).length,
        stored(inChecked, v).length,
      ),
    ),
    row(`Lost, of knowledge and mixed turns of ${C}`, (v) =>
      pct(lostIn(v).length, inChecked.filter((o) => isKnowledge(o.label.label)).length),
    ),
    row(`Stored from record or fragment, of memories stored from ${C} and S (v2 ≤ 15%)`, (v) =>
      pct(records(v).length, stored(withS, v).length),
    ),
    row("Memories stored", (v) => `${stored(counted, v).length}`),
    row("Title-only", (v) =>
      pct(
        stored(counted, v).filter((o) => o[v].facts.length === 0).length,
        stored(counted, v).length,
      ),
    ),
    row("Importance 1/2/3/4/5", (v) =>
      [1, 2, 3, 4, 5]
        .map((i) => stored(counted, v).filter((o) => o[v].importance === i).length)
        .join("/"),
    ),
    "",
    `TypeSafe v2 lost turns that v1 kept (target 0): ${v2LostV1Kept.length}; lost by both: ${bothLost.length}.`,
    `Heuristic, lost (D-6, v2 ≤ v1): v2 ${lostIn("h2").length}, v1 ${lostIn("h1").length}. Stored from record or fragment, ${C} and S (D-8, v2 < v1): v2 ${records("h2").length}, v1 ${records("h1").length}.`,
    `Mean input tokens per judged turn of ${C}, version 2: ${meanTokens.toFixed(0)} (the D-5 ratio is measured on the golden turns).`,
    `Turns the filter emptied: ${counted.filter((o) => o.v2.outcome === "emptied").length}. Sentences dropped per pattern: ${[...drops].map(([p, n]) => `${p} ${n}`).join(", ") || "none"}; quoted as knowledge: ${quotedDrops.length}.`,
    `Turns where stripHost removed text: ${host.length}; with a quoted candidate among the removed text: ${counted.filter((o) => o.quoteRemoved).length}.`,
  ];
  if (!full) return lines.join("\n");
  const shown = (o: Outcome, v: Version) =>
    `${o[v].outcome}${lost(o, o[v]) ? ", LOST" : ""}${titleIsKnowledge(o, o[v]) ? ", knowledge title" : ""}: ${cell(o[v].title)}`;
  return [
    ...lines,
    "",
    "## Every turn (full: never commit)",
    "",
    "| sample | turn | label | TypeSafe v1 | TypeSafe v2 | Heuristic v1 | Heuristic v2 |",
    "|---|---|---|---|---|---|---|",
    ...outcomes.map(
      (o) =>
        `| ${o.sample} | ${o.item.turn} | ${o.label.label} | ${VERSIONS.map((v) => shown(o, v)).join(" | ")} |`,
    ),
    "",
    "## Lost by v2, kept by v1",
    "",
    ...v2LostV1Kept.map(
      (o) => `- ${o.item.turn}: ${cell(o.v1.title)} · quoted: ${cell(o.quoted.join(" / "))}`,
    ),
    "",
    "## Stored by v2 from record or fragment turns",
    "",
    ...records("v2").map(
      (o) => `- ${o.sample} ${o.item.turn} (${o.label.label}): ${cell(o.v2.title)}`,
    ),
    "",
    "## Quoted candidates the filter dropped",
    "",
    ...quotedDrops.map(({ o, d }) => `- ${o.item.turn} (${d.pattern}): ${cell(d.text)}`),
    "",
    "## Turns where stripHost removed text",
    "",
    ...host.map(
      (o) =>
        `- ${o.item.turn} (${o.label.label})${o.quoteRemoved ? ": a quoted candidate is gone" : ""}`,
    ),
  ].join("\n");
}

try {
  if (mode === "sample") drawSamples();
  else await measure();
} finally {
  db.close();
}
```

- [ ] **Step 4: The shell wrapper**

Create `scripts/proof/quality.sh`, then `chmod +x scripts/proof/quality.sh`:

```bash
#!/usr/bin/env bash
# The memory quality proof (ADR 0023), on a copy of the real database.
#
#   scripts/proof/quality.sh <work dir> sample  [--size n] [--skipped n] [--seed n]
#                                               [--projects a,b] [--exclude-projects c,d]
#   scripts/proof/quality.sh <work dir> measure --a <labels> [--b <labels>] [--s <labels>]
#
# <work dir>  a directory outside the repository and outside the live data and store
#             directories; everything is written here.
#
# 1. On the first call for a work dir, copies the live database with sqlite3's read-only
#    .backup into <work dir>/home/mem, where quality.ts looks for it; the live store is only
#    read. Later calls reuse that copy, so that the samples, the labels and the measure refer
#    to the same memories. The live store is the one the caller's environment names
#    (WIZARDINGCODE_MEM_STORE_DIR, WIZARDINGCODE_MEM_DATA_DIR, WIZARDINGCODE_HOME), else the
#    default, else where its env file moved it.
# 2. Runs scripts/proof/quality.ts on the copy (see its header). `measure` needs a TypeSafe
#    key: TYPESAFE_API_KEY from the environment, or the one in the live data directory's env
#    file (only read). Nothing is sent to any other model: the labels come from a labeller the
#    author chooses (ADR 0023, D-4; see scripts/proof/quality-brief.md).
#
# <work dir>/report.md is anonymous. <work dir>/full.md, the samples and the labels hold the
# author's text: never commit them. Distillation, the viewer's auto-open, the legacy migration and
# the browser are off. The semantic model is not used: nothing is consolidated or written.

set -euo pipefail

usage() {
  echo "usage: scripts/proof/quality.sh <work dir> sample [--size n] [--skipped n] [--seed n] [--projects a,b] [--exclude-projects c,d] | measure --a <labels> [--b <labels>] [--s <labels>]" >&2
  exit 1
}
[ $# -ge 2 ] || usage
WORK=$1
MODE=$2
shift 2
case $MODE in sample | measure) ;; *) usage ;; esac

REPO=$(cd "$(dirname "$0")/../.." && pwd -P)
BUN="$REPO/node_modules/.bin/bun"

# The live store: a data or store directory named in the environment, else the default data
# directory under the brand home (WIZARDINGCODE_HOME honoured), or where its settings moved it.
LIVE_DATA=${LIVE_DATA:-${WIZARDINGCODE_MEM_DATA_DIR:-${WIZARDINGCODE_HOME:-$HOME/.wizardingcode}/mem}}
LIVE_STORE=${WIZARDINGCODE_MEM_STORE_DIR:-$LIVE_DATA}
if [ -z "${WIZARDINGCODE_MEM_STORE_DIR:-}" ] && [ -f "$LIVE_DATA/env" ]; then
  moved=$(sed -n 's/^WIZARDINGCODE_MEM_STORE_DIR=//p' "$LIVE_DATA/env" | tr -d '"' | tail -1)
  [ -n "$moved" ] && LIVE_STORE=$moved
fi
case $LIVE_STORE in /*) ;; *) echo "the live store must be an absolute path: $LIVE_STORE" >&2; exit 1 ;; esac
LIVE_DB="$LIVE_STORE/wizardingcode-mem.db"
[ -f "$LIVE_DB" ] || { echo "no database at $LIVE_DB" >&2; exit 1; }

# A directory's real path, or its spelling when it does not exist (never an empty string).
real() { if [ -d "$1" ]; then (cd "$1" && pwd -P); else printf '%s' "${1%/}"; fi; }

# Checked on the real path before anything is created.
[ -d "$(dirname "$WORK")" ] || { echo "no directory $(dirname "$WORK")" >&2; exit 1; }
WORK=$(real "$(dirname "$WORK")")/$(basename "$WORK")
for live in "$REPO" "$(real "$LIVE_DATA")" "$(real "$LIVE_STORE")" "${WIZARDINGCODE_HOME:+$(real "$WIZARDINGCODE_HOME")}"; do
  [ -n "$live" ] || continue
  case "$WORK/" in
    "$live/"*)
      echo "refusing: the work dir is inside the repository or the live data" >&2
      exit 1
      ;;
  esac
done
mkdir -p "$WORK"
HOME_DIR="$WORK/home"
DATA="$HOME_DIR/mem"
if [ ! -f "$DATA/wizardingcode-mem.db" ]; then
  mkdir -p "$DATA"
  sqlite3 -readonly "$LIVE_DB" ".backup '$DATA/wizardingcode-mem.db'"
  echo "copied the store to $DATA"
fi

# The environment the script runs in: no variable of the live install. quality.ts opens the
# copy at <work dir>/home/mem and treats any data directory the environment names as live.
# A key given in the environment is kept for `measure`.
KEY=${TYPESAFE_API_KEY:-}
for var in $(env | sed -n 's/^\(TYPESAFE[A-Z_]*\)=.*/\1/p; s/^\(WIZARDINGCODE[A-Z_]*\)=.*/\1/p'); do
  unset "$var"
done
export WIZARDINGCODE_MEM_DISTILL=off
export WIZARDINGCODE_MEM_UI_AUTO_OPEN=off
export WIZARDINGCODE_MEM_MIGRATE=off
export WIZARDINGCODE_MEM_UI_BROWSER=none
export LIVE_DATA LIVE_STORE
if [ "$MODE" = measure ] && [ -n "$KEY" ]; then
  export TYPESAFE_API_KEY="$KEY"
fi

"$BUN" "$REPO/scripts/proof/quality.ts" "$WORK" "$MODE" "$@"
```

- [ ] **Step 5: Typecheck, then smoke runs on throwaway stores, without the network**

Run `bun run typecheck` (expected: clean; it covers the move out of `moments.ts`) and `bash -n scripts/proof/quality.sh` (expected: clean). The smoke runs below stay on this machine: `measure` is pointed at `http://127.0.0.1:9/`, a closed port, through `WIZARDINGCODE_MEM_TYPESAFE_URL` (honoured by `quality.ts` for this purpose only; the shell unsets it for real runs), so the request fails at once and nothing reaches `api.typesafe.ai`. With `<scratch>` the session's scratchpad directory (never inside the repository):

```bash
S=<scratch>/q-smoke
mkdir -p $S/live
./node_modules/.bin/bun -e "(await import('./src/store/db.ts')).openDb({ dataDir: '$S/live', busyTimeoutMs: 1000 }).close()"
sqlite3 $S/live/wizardingcode-mem.db "INSERT INTO projects (key,name,created_at) VALUES ('path:/p','p',1);
  INSERT INTO sessions (agent,agent_session_id,project_id,cwd,started_at,last_seen_at) VALUES ('claude-code','s',1,'/p',1,1);
  INSERT INTO turns (session_id,project_id,seq,state,prompt,final_text,started_at,ended_at) VALUES
    (1,1,1,'done','why does the hook hang on windows','Status: looked into it. The cause was a pending timer in src/hooks/stop.ts that kept the process alive.',1,2),
    (1,1,2,'skipped','ok','The wave is closed and pushed to origin, the gate is next.',3,4),
    (1,1,3,'skipped','save that','I saved the rule about the pending timer with memory_save.',10,20);
  INSERT INTO memories (project_id,kind,title,body,terms,importance,origin,judge,judge_version,source_turn_id,created_at,updated_at) VALUES
    (1,'fix','Status: looked into it.','The cause was a pending timer in src/hooks/stop.ts that kept the process alive.','',4,'distilled','typesafe','1',1,1,1),
    (1,'convention','Never leave a timer pending.','','',3,'manual','agent','1',NULL,15,15);"
LIVE_DATA=$S/live scripts/proof/quality.sh $S/work sample --size 1 --skipped 5
echo '[{"turn":1,"label":"mixed","quotes":[2]},{"turn":1,"label":"record"},{"turn":99,"label":"record"}]' > $S/la.json
echo '[]' > $S/ls.json
echo '[{"turn":1,"label":"mixed","quotes":[]}]' > $S/bad.json
q() { env -u WIZARDINGCODE_HOME -u WIZARDINGCODE_MEM_DATA_DIR -u WIZARDINGCODE_MEM_STORE_DIR LIVE_DATA=$S/live \
  TYPESAFE_API_KEY=apikey_invalid WIZARDINGCODE_MEM_TYPESAFE_URL=http://127.0.0.1:9/ \
  ./node_modules/.bin/bun scripts/proof/quality.ts "$@"; }
q $S/work measure --a $S/la.json --s $S/ls.json
q $S/work measure --a $S/bad.json
LIVE_DATA=$S/live scripts/proof/quality.sh "$PWD/tmp-inside" sample
LIVE_DATA=$S/live scripts/proof/quality.sh $S/live/inside sample
```

Expected, in order: `copied the store to …/work/home/mem`, then `eligible: 1 memories, 1 skipped turns; sample A 1, B 0, S 1 (seed 7; check seeds 8, 9, 10)` (turn 3 is left out: a `memory_save` memory was created while it ran) and the files `sample-{a,b,s}.json` (turn 1's candidates: 0 the prompt, 1 `Status: looked into it.`, 2 the cause), `check-{a,b,s}.json`, `brief.md`; then `sample a: 1 duplicate labels (first kept): 1`, `sample a: 1 labels of turns not in the sample: 99`, `sample s: 1 turns with no label: 2` and a report with `TypeSafe failed on 1 turns, left out of every share` and `n/a` shares, in about a second; then `turn 1: a mixed label needs the id of at least one of its candidates` and exit 1; then two `refusing: the work dir is inside the repository or the live data` and exit 1, with no directory created.

- [ ] **Step 6: Format, commit**

```bash
bun run format
git add scripts/proof/random.ts scripts/proof/moments.ts scripts/proof/quality.sh scripts/proof/quality.ts scripts/proof/quality-brief.md
git commit -m "Memory quality proof: samples A, B and S with candidates, labels by candidate id, measure with TypeSafe verdicts only and cached"
```

---

### Task 8: Documents

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/adr/0023-memory-quality.md` (status `proposed`; its numbers and final status come from Task 9)

No README change: there is no new command.

- [ ] **Step 1: CLAUDE.md**

In `## Commands`, append to the line that starts with `` - `wizardingcode-mem rejudge [--limit n] [--concurrency n]` `` the sentence: `It asks the version 1 questions and stamps judge_version 1, whatever the distillation questions' version (ADR 0023).` Then add a bullet right after that line:

```markdown
- Distillation quality (ADR 0023): `src/distill/noise.ts` removes the host's own blocks from a turn (`stripHost`) and drops the sentences that are never knowledge, by named pattern (`host-frame`, anchored to the host's fixed lines; `status-label`; `template-label`), before either judge, and takes the dropped sentences out of the texts the judge reads and the `Context:` line quotes; a turn left with no sentence is skipped without a request. The notes a session was shown are removed from a turn only when shown before it ended, and never the turn's own memory. The judges are version 2: one `knowledge_<i>` question per sentence against a named `reader`, contrastive kinds; the title must be a knowledge sentence (`KNOWLEDGE_THRESHOLD`) and the `Context:` line needs `CONTEXT_MIN_WORDS` in the prompt. The heuristic judge penalises report sentences (hashes, "PR #", status verbs, verdicts, test counts); `heuristicJudgeV1` keeps its version 1 for the proof. Proof: `scripts/proof/quality.sh <work dir> sample|measure`, on a read-only copy at `<work dir>/home/mem`; it sends nothing to a model but TypeSafe, labels name candidate ids (`scripts/proof/quality-brief.md`), and the samples, the labels, `verdicts.json` and `full.md` never enter the repository.
```

- [ ] **Step 2: ADR 0023, proposed**

Create `docs/adr/0023-memory-quality.md`; the empty cells and the status are filled in Task 9 from `report.md`:

```markdown
# ADR 0023 — Memory quality: knowledge, not records of a session

Date: 2026-11-06 · Status: proposed; accepted or not on the proof's numbers (see [The proof](#the-proof)). Design: `docs/superpowers/specs/2026-10-14-memory-quality-design.md`; plan: `docs/superpowers/plans/2026-10-15-memory-quality.md`.

## Context

A random sample of 200 memories the mem had distilled on the author's store (2026-10-13), labelled by hand, held 9% knowledge, 29% knowledge wrapped in the narrative of a session, 58.5% records of a session and 3.5% fragments. Of the 3,733 active distilled memories TypeSafe had judged (2026-11-06), 79% were at importance 4: "durable" was asked as "stays true after the conversation", and "PR #2941 merged" stays true; the title question asked for the sentence that works best as a title, not for the one that holds the knowledge. The host's own framing text (subagent hand-backs, `<summary>` elements) was reaching the judge.

## Decisions

- **One test for knowledge.** Knowledge is what would change what a stranger does in the project a month from now. Events, states and verdicts are not knowledge.
- **The mem chooses, it never generates.** For a mixed turn the judge picks the sentence that holds the knowledge; narrative sentences are not kept. No model writes text.
- **A sentence-level noise filter before either judge** (`src/distill/noise.ts`): the host's blocks; the host's fixed frame lines, anchored at the start of a sentence; status labels; leaked template labels. Named, so the proof reports each drop. A turn with no sentence left is skipped without a request.
- **Only patterns with no knowledge match (D-3).** Verdict words and bracketed protocol tags were dropped from the filter: some of what they matched in the sample was knowledge (whole-memory precision 0.80 and 0.88). They reach the judge, whose version 2 criteria name verdicts and statuses as records.
- **Version 2 questions**: a `reader` named once in the state, `knowledge_<i>` per sentence with contrastive criteria, kinds that say what they are not, importance rated on the knowledge and not on the work reported. Version 2 of the heuristic penalises report sentences.
- **The title must be knowledge** (`KNOWLEDGE_THRESHOLD`), and the `Context:` line needs five prompt words.
- **The notes a session was shown are bounded** by the turn's end, and never include the memory made from the same turn, so a turn distilled late keeps its own sentences.
- **The import rejudge keeps version 1 (D-2)**: one constant gives its wording and its `judge_version = '1'`.
- **The existing base is not cleaned here (D-1)**: that is a separate item, designed with these numbers in hand.
- **The proof's labeller is the author's choice (D-4)**; the proof sends nothing to a model but TypeSafe.
- **A token ceiling (D-5)** and **no regression without a key (D-6)**: measured below.
- **Nothing else moves**: retrieval, hooks, the brief and the pinned snapshots are byte for byte as before.

## The proof

`scripts/proof/quality.sh` on a read-only copy of the author's store. Version 1 is the memory version 1 stored; TypeSafe version 2 was asked once per turn, with the drain's timeout and retries; only its own verdicts count, and turns it did not answer are left out of every share. Labeller: …. Cost and time (D-9): … requests, … input tokens, … s for the measure on B; … for the calibration on A; labelling: … .

### Samples and labels

| Sample | Turns | knowledge | mixed | record | fragment | Author's check: disagreements in 20 |
|---|---|---|---|---|---|---|
| A (calibration) | | | | | | |
| B (check) | | | | | | |
| S (skipped by version 1) | | | | | | |

### Before and after

| Metric | Denominator | TypeSafe v1 | TypeSafe v2 | Target | Heuristic v1 | Heuristic v2 |
|---|---|---|---|---|---|---|
| Title is knowledge | memories stored from B | | | v2 ≥ 60% | | |
| Lost | knowledge and mixed turns of B | | | v2 loses none v1 kept | | v2 ≤ v1 (D-6) |
| Stored from record or fragment | memories stored from B and S | | | v2 ≤ 15% | | v2 < v1 (D-8) |
| Memories stored; title-only; importance 1–5 | — | | | reported | | |
| Mean input tokens per judged turn | the golden turns, as recorded | | | v2 ≤ 2 × v1 (D-5) | — | — |
| Mean input tokens per judged turn, version 2 | judged turns of B | — | | reported | — | — |
| Turns TypeSafe failed | — | | | reported | — | — |

Thresholds chosen on A: `SAVE_THRESHOLD` …, `KNOWLEDGE_THRESHOLD` …; levers used: …. Each lost turn, by title, and why: …. Memories stored from `record` turns whose new title is knowledge: ….

### The filter

Turns emptied: …. Sentences dropped per pattern: …; quoted candidates among them: …. Turns where `stripHost` removed text: …; with a quoted candidate among the removed text: ….

### The golden set

| Judge | Precision | Recall | Kind |
|---|---|---|---|
| heuristic v2 | | | |
| typesafe v2 | | | |

## What the proof leaves open

- The labels are the chosen labeller's, checked by the author on 20 per sample.
- A memory stored from a turn labelled `record` counts as noise even when its new title is knowledge the labeller missed; the full report lists them.
- Whether a chosen sentence alone is often too short to be understood (the title-only share).
- The cleanup of the existing base (D-1), and whether the imported memories ever move to version 2 (D-2).
- Renaming `DistillVerdict.durable` to `knowledge`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/adr/0023-memory-quality.md
git commit -m "Documents: the noise filter, judge version 2 and the quality proof; ADR 0023 proposed"
```

---

### Task 9: Run the proof, finish the record, gates

**Criterion:** AC-11 (the report is its evidence).

**Files:**
- Modify: `docs/adr/0023-memory-quality.md` (status and numbers)
- Modify, only if the calibration moves them: `src/distill/policy.ts` and `tests/unit/draft.test.ts`; `src/judge/questions.ts`, `tests/golden/typesafe-answers.json`; `src/distill/noise.ts` and `tests/unit/noise.test.ts`

This task needs the author's store (read only), a TypeSafe key and a labeller. Nothing from the work directory is committed: only the ADR and, if the calibration moved one, a threshold, a criterion's wording or a pattern.

- [ ] **Step 1: Draw the samples**

```bash
scripts/proof/quality.sh <scratch>/quality sample [--projects …] [--exclude-projects …]
```

Ask the author first which projects to draw from or leave out (D-4: the labeller reads the drawn text). Expected: `copied the store to …`, then `eligible: … memories, … skipped turns; sample A 200, B 200, S 100 (seed 7; check seeds 8, 9, 10)` (3,733 active distilled memories judged by TypeSafe on 2026-11-06; the eligible count is lower by those whose turn no longer has its text).

- [ ] **Step 2: Label the three samples, and the author's check**

The labeller is the author's choice; by default the agent of the runtime running the proof (D-4, and `brief.md`). From Claude Code: one general-purpose subagent per sample, given `<scratch>/quality/brief.md`, the sample file and `<scratch>/quality/labels-<a|b|s>.json` as its output; it must not touch any repository or user folder.

Then, for each sample, show the author the 20 turns listed in `check-<sample>.json` (drawn with the proof's seeded generator, one per sample: seeds 8, 9 and 10 with the default seed) with their labels and quoted candidates, and record the author's verdict on each. With more than 3 disagreements in 20, correct the brief where it misled the labeller and label that sample again from scratch; with 3 or fewer, correct the disagreeing labels in the file. Note the disagreement counts for the ADR.

- [ ] **Step 3: Measure on A**

```bash
scripts/proof/quality.sh <scratch>/quality measure --a <scratch>/quality/labels-a.json --s <scratch>/quality/labels-s.json
```

Read `report.md` and `full.md`. While B is not given, A stands in for B in the report (the checked sample is named in it). If a quoted candidate was dropped by the filter, that pattern is removed (spec section 6), with the case added to `tests/unit/noise.test.ts` as a pass case, before any threshold moves. Every verdict is kept in `<scratch>/quality/verdicts.json`.

- [ ] **Step 4: Calibrate on A**

When a target is missed on A, one lever at a time, in this order, each in steps of 0.05 and at most three steps (spec section 11):

1. Records over 15%, or the title share under 60%: raise `KNOWLEDGE_THRESHOLD`.
2. Turns lost: lower `KNOWLEDGE_THRESHOLD`, then `SAVE_THRESHOLD`.
3. Still missed: one change to the wording of the criterion that misled the judge (`questions.ts`), with the golden answers recorded again as in Task 6, Step 7.

After each step, run Step 3's command again. A threshold step asks TypeSafe nothing: the requests are the same, so `measure` reuses the verdicts in `verdicts.json` and only re-runs the policy (the report's line "… verdicts reused" shows it). A wording change changes the requests of every turn, so sample A is asked again (about 300 requests with S). A threshold change updates `tests/unit/draft.test.ts` where one of its values sits between the old and the new threshold, and goes through `bun run test` before the next measure. If A still misses a target after the levers, stop and hand `report.md` and `full.md` to the author: the proof does not go on to B.

- [ ] **Step 5: Measure on B, once**

```bash
scripts/proof/quality.sh <scratch>/quality measure --a <scratch>/quality/labels-a.json --b <scratch>/quality/labels-b.json --s <scratch>/quality/labels-s.json
```

B's numbers go in the ADR as they come out; B is never used to tune. If a target is missed on B, the change is not merged: stop and give the author the report; the author decides (recalibrate on a fresh sample, change the questions and measure again, or accept a named loss).

- [ ] **Step 6: Fill the ADR and commit**

Copy into `docs/adr/0023-memory-quality.md` the labeller, the label counts and check results, the tables of `report.md`, the golden-set numbers printed by `tests/golden/judges.test.ts` and the D-5 line of Task 6, Step 7, the thresholds chosen and the levers used, the drops per pattern, every lost turn by title with its reason, and the cost and time (D-9): the requests, input tokens and seconds each `measure` printed (calibration on A and the run on B), and the labelling time as the author or the runtime reports it. Set the status from the result: `accepted` when every target is met on B, otherwise leave it `proposed` and write which target was missed. Never commit `full.md`, the samples or the labels.

```bash
bun run test
git add docs/adr/0023-memory-quality.md
git commit -m "ADR 0023: the memory quality proof's numbers"
```

(Add the files Step 3 or Step 4 changed, with their tests.)

- [ ] **Step 7: Gates**

```bash
bun run check
crew gate run <id>
```

Expected: the build, test, lint and typecheck gates pass. `crew gate run` also plans the judgement gates and writes the reviewers' inputs under `.crew/work/<id>/review/`.

- [ ] **Step 8: The judgement gates**

Run the judgement gates the engine planned (code-quality, test-quality, security, risk, architecture, data) as the crew skill's `references/gate.md` describes: each reviewer subagent (`wizardingcode-developer-crew:review-<gate>`) on the inputs under `.crew/work/<id>/review/`, then `wizardingcode-developer-crew:judge` on their findings. Write the ruling file in the format `references/gate.md` gives, and record it:

```bash
crew judgement <id> record --ruling <file>
```

The engine validates the file and exits 0 once the item is proven. A gate that could not run is recorded with `crew judgement <id> record <gate> --not-run --reason "<why>"`, never passed by default. Report what the crew says: proven, or not proven and why.
