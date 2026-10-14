# Memory quality: knowledge, not records of a session — design

Date: 2026-10-14. Status: approved in conversation by the author on 2026-10-14; this document is for review before the plan. Follows the semantic search proof (ADR 0017) and the large-project work (ADR 0021, 0022), which found that what the mem keeps is a bigger problem than how it finds it.

## Why

On 2026-10-13 a random sample of 200 active memories distilled by the mem itself, on the author's store, was labelled by hand with one question: would a stranger joining the project next month act differently for knowing this? The result:

| Label | Count | Share |
|---|---|---|
| Knowledge: usable on its own by a future session | 18 | 9% |
| Mixed: real knowledge wrapped in the narrative of a session | 58 | 29% |
| Record: the state of a session (delivered, merged, verdict, plan, "your turn") | 117 | 58% |
| Fragment: meaningless out of context | 7 | 4% |

Three findings shape this design:

1. **The kind of a memory barely helps.** Decisions and conventions are mostly records (verdicts of gates, "bottom line" status reports, the user's own prompts). Only gotchas carry much knowledge (8 of 22).
2. **TypeSafe approved nearly everything, nearly all at importance 4.** The questions it is asked do not separate knowledge from a record. "Durable" is asked as "stays true after the conversation ends", and "PR #2941 merged into dev" stays true. "Worth saving" lists "a lasting change to how the code works", and a report of a session reads as a change. The title question asks for "the sentence that works best as a title", not for the sentence that holds the knowledge, so the rule ends up in the body under a title like "Bottom line: …".
3. **Cheap signals with 97–100% precision exist** for throwing away, and the hard cases are the mixed ones: the knowledge is there, in one sentence, next to the narrative.

The author's store today (read-only count on 2026-10-14): 2,513 active distilled memories in 59 projects, 1,803 of them from the history import and 710 from live turns; 411 have a title and nothing else (or only a `Context:` line); 912 carry a `Context:` line that is a short acknowledgement ("aprovo", "força W4"); 38 contain the host's own framing text ("[Subagent hand-back]", `<summary>Agent … finished</summary>`). The 67,301 active memories imported from claude-mem are a different population (that tool's generated summaries) and are out of scope here.

The labels of that sample were lost with the session's scratch directory; the report (counts, examples, signals) survived. The proof below labels again.

## Decisions

- **Four labels, one test.** Knowledge is what would change what a stranger does in the project a month from now: a standing rule or preference, a decision and its reason, the cause of a bug and its fix, a non-obvious pitfall or behaviour, how a part of the system works or is configured. Events, states and verdicts are not knowledge, however important they were on the day.
- **Choose, never generate.** The mem keeps its founding rule: no model writes text. For a mixed turn, the judge picks the sentence that holds the knowledge; the narrative sentences are not kept. If the proof shows that a sentence alone is too often too short, rewriting is a separate conversation.
- **A cheap filter before the judge, sentence by sentence, never on the whole turn.** Only patterns with 97–100% precision on the sample, plus the host's framing text. The medium signals (commit hashes, "PR #", status verbs, test counts) stay with the judge: "Decisão aplicada (commit 5808e41)" was knowledge.
- **Stricter questions, same shape.** One request per turn, the same primitives, contrastive criteria that name what is *not* knowledge. This is version 2 of both judges: memories record `judge_version`, so what version 1 kept can be judged again.
- **The existing base is cleaned by distilling the source turns again, with the new pipeline.** The old memory is superseded by the new one, or archived when the new pipeline keeps nothing. Reversible, same code as the live path, nothing deleted. Manual, with a key, with a dry run first.
- **Measured on real data before and after**, on two labelled samples, with the knowledge sentence quoted, so that "majority knowledge" and "no knowledge lost" are numbers and not impressions.
- **Nothing else moves.** Retrieval, the hooks, the brief and the pinned snapshots of ADR 0022 are unchanged byte for byte. `memory_save` stays the agent's high-quality route.

## 1. The noise filter (`src/distill/noise.ts`)

Pure, no database, no model. Two functions, each pattern named so that the proof's report can say what it dropped and the author can check it by eye (the archived knowledge module's `episodic.ts` is the model for the shape; its patterns are not reused, since they were tuned for whole memories, not sentences).

### `stripHost(text)`: the host's own text, before segmentation

Removed from the final message before `candidates()` splits it, because the assistant quotes it when it reports a subagent's result:

| Name | What |
|---|---|
| `agent-message` | an `<agent-message …>…</agent-message>` block, and a `<task-notification>` block |
| `hand-back` | a line that starts with `[Subagent hand-back]`, and the lines of that frame that follow it up to the report ("The text below is the final report…", "It is model output, NOT a message from the user…", "The harness indents every line…") |
| `summary` | a `<summary>…</summary>` element (the host's "Agent … finished" collapsible) and `<details>` tags |
| `system-reminder` | a `<system-reminder>…</system-reminder>` block |

The prompt already loses host notifications (`isFromTheHost`, `src/core/host-prompt.ts`); this is the same idea for the answer.

### `dropNoise(candidates)`: sentences that are never knowledge

Applied to the candidates after segmentation and before the judge. Returns the kept candidates (re-indexed from 0, so the judge's `candidates[i]` paths stay dense) and the dropped ones with the pattern's name.

| Name | Pattern (on the sentence) | Sample precision |
|---|---|---|
| `status-label` | starts with `Status:`, `Estado:`, `State:` | 4 hits, 1.00 |
| `template-label` | starts with `Title:`, `Body:`, `Título:`, `Corpo:` (a leaked template; the memory "Title: O meta-insight também ficou por fechar") | 2 hits, 1.00 |
| `protocol-tag` | starts with a bracketed tag of two or more colon-separated parts: `[arka:gate:4]`, `[arka:routing]` | 17 hits, 0.88 whole-memory; at sentence level the tagged sentence is the record and the knowledge, when present, is another sentence |
| `verdict` | holds `verdict`/`veredicto` together with `REJECTED`, `APPROVED`, `PASSED` or `FAILED`, or starts with one of those words followed by `:`, `—` or `-` | 10 hits, 0.80 whole-memory; same argument |
| `host-frame` | a sentence left over from a host frame: "This tool result is internal metadata", "agentId:", "output_file:" | structural |

Rules for the list: a pattern enters only with 97–100% precision on a labelled sample or because it is the host's text, never a user's or an assistant's words; "APPROVED" inside a rule ("only APPROVED campaigns are sent") must pass, which is why `verdict` needs the verdict word or the sentence-initial form; the proof reports every drop by name, and a pattern that drops a `keep` sentence is removed. Signals that looked good but hit knowledge stay out: "Bottom line:", "Registado:", numbered titles, a title that addresses the user, "não era X, é Y" (that one marks cause and fix).

### When nothing is left

If no candidate survives, the turn is `skipped` without a request to TypeSafe. That is the only turn-level effect of the filter.

### The `Context:` line

`buildDraft` appends `Context: <prompt>` when the title came from the answer. It stays, but only when the prompt has at least 5 words. "Context: aprovo" and "Context: força W4" give the reader nothing.

## 2. The questions, version 2 (`src/judge/questions.ts`)

Same request per turn, same primitives, same answer handling. The state gains one field, `reader`, so every question can name the same person without repeating it:

```
reader: "a developer who joins this repository a month from now and never saw this conversation"
```

Everything else in the state is as today (`user_prompt`, `assistant_final_message`, `files_changed`, `commands`, `had_errors`, `candidates[]`).

### `worth` (noul)

Instructions: "Does `user_prompt` or `assistant_final_message` state something that `reader` would work differently for knowing?"

- true: "A standing rule or preference of the project or its author; a decision and the reason for it; the cause of a bug and what fixed it; a non-obvious pitfall, limitation or surprising behaviour; how a part of the system works or is configured."
- false: "What was done, delivered, committed, merged, opened, closed, approved or rejected in this session; the state of a task, a review, a gate or a plan; a question, an offer or small talk; a restatement of the request; detail obvious from reading the code."

### `knowledge_<i>` (noul, one per candidate; replaces `durable_<i>`)

Instructions: "Would `reader` work differently for reading `candidates[i].text` on its own, with nothing else from this conversation?"

- true: "On its own it states a standing rule or preference, a decision with its reason, a cause and its fix, a pitfall or surprising behaviour, or how something works or is configured."
- false: "It reports what was done, delivered, committed, merged, opened, closed, approved or rejected; the state of a task, review, gate or plan; it is a question, an offer or an instruction to the person in the conversation; it is a heading, or it needs the rest of the conversation to be understood."

### `title` (choice among the candidates, plus `none`)

Instructions: "Which candidate, read by `reader` on its own, best states the knowledge of this turn: the rule, the decision and its reason, the cause and its fix, or the fact?" The `none` option: "No candidate states knowledge on its own."

### `kind` (choice)

Instructions: "What kind of knowledge does this turn mainly contain, for `reader`?" Each criterion says what it is and what it is not:

| Option | Criterion |
|---|---|
| decision | A choice between alternatives and the reason for it. Not a verdict of a review, a gate or a test run, and not the approval of a plan. |
| fix | A bug or error, its cause, and what resolved it. Not that a fix was delivered, committed or merged. |
| gotcha | A non-obvious pitfall, limitation or surprising behaviour of the code, a tool or a service. |
| convention | A standing rule or preference for how work is done in this project, from the author or the team. Not a step or a plan for this session. |
| change | What is now true of the code's behaviour, structure or interfaces, stated as the new state. Not that something was done, committed, merged, closed or delivered. |
| discovery | A fact learned about how the existing system works or is configured. |
| none | A record of what happened in the session, a status, a plan, a question, small talk, or nothing lasting. |

### `importance` (score, 5 levels)

Instructions: "How costly would it be for `reader` not to know this? Rate the knowledge in the sentences, not the amount of work the message reports."

1. Nothing: they would do the same without it.
2. Minutes: a detail they would find quickly in the code or the docs.
3. An investigation: a cause, a behaviour or a location that takes real time to find.
4. A mistake: a rule of the project, an approach already rejected, or a correction the author gave.
5. Damage: data loss, a security problem, or breaking a hard rule of the project.

`importance = round(score) + 1`, as today.

### Versions

`TypeSafeJudge.version` becomes `"2"`, `heuristicJudge.version` becomes `"2"`. `distillVerdict` keeps the field name `durable` in `DistillVerdict` for the per-candidate probabilities, read from the `knowledge_<i>` answers, so that the pipeline's types do not change. The consolidation and `personal` questions are untouched. The rejudge of imported memories (`rejudge` with no subcommand) asks the same `worth`, `kind` and `importance` as before, now in their version 2 wording; it only ever touches rows still marked `judge = 'claude-mem'`.

## 3. The policy (`src/distill/policy.ts`)

Starting values, to be calibrated on sample A and checked on sample B (section 6):

- `SAVE_THRESHOLD = 0.5` on `worth`, as today.
- `KNOWLEDGE_THRESHOLD = 0.5` replaces `DURABLE_THRESHOLD`: a sentence becomes one of the memory's facts when its `knowledge` reaches it.
- **The title must be knowledge.** The title is the judge's choice when that candidate's `knowledge` reaches the threshold; otherwise the candidate with the highest `knowledge`; if none reaches the threshold, the turn is skipped even when `worth` passed. Today a `worth` pass with one durable sentence is enough, which is how a status line became a memory with nothing under it.
- Facts: the knowledge sentences, at most `MAX_FACTS = 5`, in the order written, as today.
- `CONTEXT_MIN_WORDS = 5` for the `Context:` line.

Everything that turns a probability into an action stays in this file, in code, tested.

## 4. The heuristic judge, version 2 (`src/judge/heuristic.ts`)

The noise filter runs in the pipeline, before either judge, so the heuristic benefits from it as TypeSafe does. On top of that, for installations without a key:

- **Durability penalties** on the medium signals, in a sentence of the answer: a commit hash (7–40 hex characters with a digit and a letter), a pull request reference (`PR #n`, `MR !n`, `/pull/n`), a status verb (delivered, merged, committed, closed, done, shipped, pushed; entregue, fechado, feito, concluído, commitado, integrado, fundido, gravado, selado, lançado, despachado), a verdict word, a test count (`11/11`, "tests pass", "testes passam"). Starting value: `−0.25` per sentence that has at least one of them, floor 0.05.
- **A worth discount** when the answer is mostly a report: when at least 60% of its candidate sentences carry one of those signals, `worth −= 0.2`.
- Everything else as today. The judge stays "tuned to keep too little rather than too much".

The golden set (`tests/golden/turns.json`) gains at least 8 turns written from the sample's shapes, anonymised, in both languages: a gate verdict, a "bottom line" status report with a rule inside it (mixed: the rule must be the title), a wave closed with a commit hash, a "your turn" hand-off, a subagent's hand-back quoted in the answer, a short-acknowledgement prompt with a real fix in the answer (keep), a plan for the session, a leaked `Title:` template. The floors of `tests/golden/judges.test.ts` (precision and recall 0.85, kind 0.75) hold for both judges; TypeSafe's answers are recorded again with `bun scripts/record-typesafe.ts` (about 40 turns, cents).

## 5. Cleaning the existing base: `rejudge distilled`

```
wizardingcode-mem rejudge distilled [--dry-run] [--limit <n>] [--concurrency <n>]
wizardingcode-mem rejudge distilled --undo
```

Needs a TypeSafe key, like `rejudge` today; without one it says so and does nothing. Only one run at a time (the drain lease is taken for the run, so live distillation waits; the run is bounded by `--limit` and resumable).

### What it does, per memory

For each active memory with `origin = 'distilled'`, `judge_version = '1'`, a `source_turn_id` whose turn still has its text, and no `user_memories` row (the author's rules are never touched; the consolidation guard already protects them), oldest first:

1. Build the turn's input exactly as the live path does (`withoutNotes`, `stripHost`, `candidates`, `dropNoise`) and ask the judge version 2. The turn's detail (files, commands, errors) is the one stored on the `turns` row when it was first distilled, never the transcript, which may be gone.
2. **Nothing kept** (no title with knowledge, or `worth` below the threshold): the old memory becomes `archived`.
3. **Kept**: a draft, consolidated as today (`findNeighbours` already excludes the memory's own turn). `insert` writes a new memory of the same turn with `source_ordinal = 1` (`NewMemory` gains `sourceOrdinal`, default 0; the `UNIQUE (source_turn_id, source_ordinal)` constraint was made for this), dated as the old one (`created_at` of the old memory, so recency does not change), with its vector when the model is loaded; the old memory is marked `superseded` by it (`supersede`). A `duplicate` action reinforces the target and archives the old memory.
4. **Judge failed** (TypeSafe did not answer, fallback verdict): the memory is left as it is and counted; five failures in a row stop the run, as in `rejudge`.

A memory whose turn is gone (`source_turn_id` null, or its text emptied by `compact`) is judged on its own text, as `rejudge` does for imports: `worth` only, archive or keep, never rewritten.

### Reversibility: `memory_reviews` (migration 8)

| Column | Meaning |
|---|---|
| `memory_id` | primary key, `memories(id) ON DELETE CASCADE`: the old memory |
| `run_id` | the run that decided it |
| `outcome` | `'superseded'`, `'archived'` or `'kept'` |
| `replacement_id` | the new memory, for `superseded`; null otherwise |
| `reason` | short text for the report: the verdict's numbers, or the noise pattern that emptied the turn |
| `at` | epoch ms |

`--undo` reverses the last run: a superseded memory becomes active again and its replacement archived; an archived one becomes active; the rows are then deleted. The viewer's "Back in use" on one memory keeps working as today. The table also makes the run resumable without a cursor: a memory with a row is done.

Migration 8 ships in the same release as migration 7 (0.6.0 is not out), so it costs no extra compatibility.

### The dry run

`--dry-run` makes every request but writes nothing to `memories`; it prints the counts (would supersede, would archive, kept, failed, skipped by the filter, tokens, estimated cost) and writes a full report to `<data dir>/logs/rejudge-distilled-<date>.md` with, per memory, the old title, the outcome, the new title when there is one, and the reason. The report is the author's; the command says where it is. With 2,513 memories at about 2,000 input tokens each the whole run is around 5 M tokens, about $0.21 at the published price.

### Not in this change

The imported memories (`rejudge --imported` with the version 2 questions) are a separate decision once the distilled numbers are in. No viewer card: the cleanup is a one-time pass with a dry run, and new memories are clean from the version 2 judge on. No background pass: archiving a user's memories without being asked is not what the drain does.

## 6. The proof (`scripts/proof/quality.sh`, `scripts/proof/quality.ts`)

Runs on a read-only copy of the author's store (`sqlite3 -readonly … ".backup"` into a fresh data directory under the work directory), with a TypeSafe key from the environment, never on the live database. Writes an anonymous `report.md` and a `full.md` with titles, for the author's eyes only; the labels file is refused inside the repository, as in the knowledge proof.

### Samples and labels

- **Sample A** (calibration) and **sample B** (check): 200 active distilled memories each, drawn at random with a fixed seed from the copy, disjoint, with their source turns.
- Each memory is labelled with the four labels by a labelling agent using the brief kept at `scripts/proof/quality-brief.md` (the brief of 2026-10-13, with one addition: for `keep` and `mixed`, quote the sentence that holds the knowledge, verbatim). The author spot-checks 20 of each sample. The labels live in the work directory, never committed.
- The proof then runs the version 2 pipeline on the 400 source turns, in process (`distillTurn` on the copy, judge version 2, the model loaded if present), and compares.

### Metrics, before and after

| Metric | Before (sample of 2026-10-13) | Target |
|---|---|---|
| Share of stored memories whose title is knowledge (a `keep` memory's text, or the quoted sentence of a `mixed` one) | 9% | ≥ 60% |
| `keep` memories lost (no memory stored for their turn, or stored without the quoted sentence) | none (they were stored; the sample is drawn from what was stored) | 0; each loss named in the report |
| Stored memories from turns labelled `record` or `fragment` | 62% | ≤ 15% |
| Title-only memories (no fact under the title) | 16% | reported |
| Turns skipped by the noise filter without a request | 0 | reported, with the pattern names and any `keep` among them |
| Input tokens per judged turn | ≈ 1,200–1,450 (ADR 0005) | reported; the contrastive criteria will cost more |

Thresholds (`SAVE_THRESHOLD`, `KNOWLEDGE_THRESHOLD`) are chosen on sample A and the numbers reported on sample B; both appear in the ADR. A memory stored from a turn labelled `record` is counted as noise even when the new title is in fact knowledge the old pipeline had missed: the report lists them, so the bias is visible and conservative.

### The cleanup, rehearsed

On the same copy, `rejudge distilled --dry-run` over everything, then the real run, then `--undo`, and the counts of `memories` by status before and after the undo must match. The ADR records the dry run's counts and the time it took.

### What stays byte for byte

`tests/golden/retrieval.test.ts`, the hook snapshots and the perf budgets are unchanged: this design does not touch retrieval.

## 7. Tests

- `tests/unit/noise.test.ts`: every pattern of section 1 on fixtures in both languages, and the known false positives that must pass ("Bottom line: o `opencode` só está instalado sob o Node v22…", "Decisão aplicada (commit 5808e41)…", "Registado: …", "4. Sem idempotência: duplo envio.", "Tu corres o servidor à parte…", "Não era bug de código, era a regra…", "only APPROVED campaigns are sent"); `stripHost` on a real hand-back frame; re-indexing of the kept candidates.
- `tests/unit/questions.test.ts`: the version 2 questions reference only state paths that exist, the candidate questions are dense, and `distillVerdict` maps `knowledge_<i>` answers and the `none` title.
- `tests/unit/policy.test.ts` (or in the pipeline tests): the title must be knowledge; the `Context:` rule at 4 and 5 words.
- `tests/golden/*`: the new turns, the floors, the recording.
- `tests/integration/rejudge-distilled.test.ts`: on a fixture store with a replaying judge: supersede with `source_ordinal = 1` and the old memory's date, archive, duplicate, a user rule untouched, a turn without text judged on the memory's text, the dry run writing nothing, `--undo` restoring the counts, resumability.
- `tests/integration/db.test.ts`: migration 8.

## 8. Documents

- ADR 0023, "Memory quality: knowledge, not records", with the proof's numbers, the thresholds chosen, and the patterns' drop counts.
- `CLAUDE.md`: the noise filter, judge version 2, `rejudge distilled`, and the proof script, in the style of the other entries.
- README: one line under the commands.

## Out of scope

- Rewriting memories with a generative model (the alternative set aside above).
- The imported memories, the viewer, and any background cleanup.
- Retrieval: the brief, the prompt notes and their budgets.
- The history import's own choices (what it enqueues); it goes through the same pipeline and benefits the same way.
