# Memory quality: knowledge, not records of a session — design

Date: 2026-10-14, revised 2026-11-06. The author approved the design on 2026-10-14 and took decisions D-1 to D-7 on 2026-11-06, after two rounds of review. Follows the semantic search proof ([ADR 0017](../../adr/0017-semantic-search.md)) and the large-project work ([ADR 0021](../../adr/0021-common-words-in-large-projects.md), [ADR 0022](../../adr/0022-prompt-hook-cold-path.md)), which found that what the mem keeps is a bigger problem than how it finds it.

## 0. Terms

- **the mem**: this product, wizardingcode-mem. It turns each finished turn of a coding session (the user's prompt and the assistant's final answer) into at most one stored memory, and tells later sessions the relevant ones.
- **distilling**: that step, in `src/distill/pipeline.ts`. The turn's text is split into candidate sentences (`candidates()`, `src/distill/segment.ts`, which drops sentences under 20 characters or 3 words), one request goes to a **judge**, and code in `src/distill/policy.ts` turns the judge's numbers into a draft memory or nothing. A draft is then **consolidated**: compared with similar stored memories, it is inserted, merged into one of them as a repeat, or replaces one it contradicts.
- **the judge**: TypeSafe ([ADR 0005](../../adr/0005-m2-typesafe.md)), an external service that answers typed questions about a JSON state, or, without a key, the local heuristic judge (`src/judge/heuristic.ts`). When TypeSafe fails, the drain falls back to the heuristic. A TypeSafe question has a primitive: `noul` (a probability that a statement is true, 0 to 1), `choice` (one option among named ones), `score` (one of five ordered levels, answered 0 to 4). Questions refer to the state by path (`candidates[3].text`).
- **the host**: the coding agent the mem is installed in (Claude Code, Codex…). Its own framing text (notifications, a subagent's hand-back) can appear inside the assistant's answer.
- **the drain**: the background step that distils queued turns, one at a time, under a lease in the `meta` table. A turn it distils ends `done` (a memory or a merge) or `skipped` (nothing stored).
- **`compact`**: the command that prunes old records; it deletes finished turns with no memory after 90 days (`RETENTION_DAYS`, `src/store/compact.ts`).
- **`rejudge`**: the command that re-judges memories imported from claude-mem (another memory tool whose store the mem imports).
- **matched**: a pattern matched a sentence. **whole-memory precision**: of the memories a pattern matched in the 2026-10-13 sample, the share labelled `record` or `fragment`.

## 1. Why

On 2026-10-13 a random sample of 200 active memories distilled by the mem itself, on the author's store, was labelled by hand with one question: would a stranger joining the project next month act differently for knowing this? The result:

| Label | Count | Share |
|---|---|---|
| `knowledge`: usable on its own by a future session | 18 | 9.0% |
| `mixed`: real knowledge wrapped in the narrative of a session | 58 | 29.0% |
| `record`: the state of a session (delivered, merged, verdict, plan, "your turn") | 117 | 58.5% |
| `fragment`: meaningless out of context | 7 | 3.5% |

Three findings shape this design:

1. **The kind of a memory barely helps.** Decisions and conventions are mostly records (verdicts of gates, "bottom line" status reports, the user's own prompts). Only gotchas carry much knowledge (8 of 22).
2. **The questions do not separate knowledge from a record.** On 2026-11-06 the author's store holds 3,941 active distilled memories: 3,733 judged by TypeSafe, 208 by the heuristic. Of the 3,733, 2,937 (79%) are at importance 4. "Durable" is asked as "stays true after the conversation ends", and "PR #2941 merged into dev" stays true. "Worth saving" lists "a lasting change to how the code works", and a report of a session reads as a change. The title question asks for "the sentence that works best as a title", not for the sentence that holds the knowledge, so the rule ends up in the body under a title like "Bottom line: …".
3. **A few signals that cost no request matched no knowledge in the sample** (`Status:` lines, leaked templates, the host's framing), and the hard cases are the mixed ones: the knowledge is there, in one sentence, next to the narrative.

On 2026-10-14 (read-only count): 2,513 active distilled memories in 59 projects; 411 with a title and nothing else (or only a `Context:` line); 912 whose `Context:` line is a short acknowledgement such as "aprovo" ("I approve") or "força W4" ("go ahead with W4"); 38 containing the host's framing text. The 67,301 active memories imported from claude-mem are out of scope (D-2).

The labels of that sample were lost with the session's scratch directory; the report (counts, examples, signals) survived. The proof (section 11) labels again and measures before and after on the same samples.

## 2. Goals and non-goals

Goals, for memories distilled from now on, measured by the proof on labelled samples:

- A memory's title is a sentence that holds knowledge, not the narrative around it.
- A turn that is only a record of the session stores nothing.
- On the samples, version 2 loses no knowledge that version 1 kept.

Non-goals: cleaning the memories already stored (D-1); the imported memories (D-2); retrieval, the brief (what the mem injects at session start) and the prompt notes; generating text.

## 3. Decisions

### Taken by the author on 2026-11-06

- **D-1: the cleanup of the existing base is a separate item.** Re-distilling stored memories in place needs its own design (undo of every side effect, hand-edited memories, consolidation inside a batch, the drain lease, ranking signals carried over). This change ships the live pipeline; the cleanup is designed next, with version 2's measured numbers in hand.
- **D-2: the import rejudge keeps the version 1 questions.** The imported memories are another tool's summaries, and version 2's criteria are measured only on distilled turns. `rejudge` keeps asking `worth`, `kind` and `importance` in their version 1 wording and stamps `judge_version = '1'`, until a measurement on imported memories says otherwise (open question).
- **D-3: only patterns with no knowledge match in the noise filter.** The `protocol-tag` (whole-memory precision 0.88) and `verdict` (0.80) patterns are removed: some of what they matched was knowledge. Those sentences reach the judge, whose version 2 criteria name verdicts and statuses as records.
- **D-4: the labeller is configurable, and defaults to the runtime the proof is run from.** The proof itself sends no text to any model. It writes the samples and the brief, and reads back a labels file. By default the labels come from the agent of the runtime running the proof (a Claude Code subagent when run from Claude Code, Codex's agent from Codex). The author can produce the labels file with any labeller, and can limit the draw to some projects or exclude some.
- **D-5: a token ceiling.** Version 2's mean input tokens per judged turn is at most twice version 1's, measured on the same turns. Above it, the change is not merged and the criteria are shortened.
- **D-6: no regression for keyless installations.** On sample B, the heuristic version 2 loses no more `knowledge` or `mixed` turns than the heuristic version 1.
- **D-7: the review runs a third round** after the fixes of round 2.
- **D-8: the heuristic's report penalties stay, with a target.** On samples B and S, the heuristic version 2 stores fewer memories from `record` or `fragment` turns than the heuristic version 1, as well as losing no more knowledge (D-6).
- **D-9: cost and duration are measured, not estimated.** The proof records its tokens and its time; the ADR reports them.
- **D-10, D-11: the review stops after round 3** (no progress: 31 Blockers and Majors against 29). The findings of round 3 are fixed in this revision and the author accepts the document without a fourth round.

### Principles

- **One test for knowledge.** Knowledge is what would change what a stranger does in the project a month from now: a standing rule or preference, a decision and its reason, the cause of a bug and its fix, a non-obvious pitfall or behaviour, how a part of the system works or is configured. Events, states and verdicts are not knowledge, however important they were on the day. The four labels of section 1 apply it.
- **The mem chooses, it never generates.** No model writes text (the founding rule). For a mixed turn, the judge picks the sentence that holds the knowledge; the narrative sentences are not kept.
- **A filter before the judge, sentence by sentence, never on the whole turn.**
- **Stricter questions, same shape.** One request per turn, the same primitives, criteria that name what is *not* knowledge. This is version 2 of both judges; memories record `judge_version`, so the separate cleanup can find what version 1 kept.

## 4. Alternatives considered

| Alternative | Why not |
|---|---|
| Rewrite mixed memories with a generative model | Breaks the founding rule; a rewrite can state what the turn never said. Reconsidered only if the proof shows titles are often too short to be understood (section 16). |
| A stricter threshold only, same questions | The questions do not separate knowledge from records (finding 2): a record scores as high as a rule, so no threshold separates them. |
| The filter only, same questions | 58.5% of the sample were records, and the three filter patterns matched 6 sample memories plus the 38 with host framing. |
| Down-rank records at retrieval, keep storing them | Records still fill the store, the viewer and the vectors; retrieval has byte-for-byte snapshots ([ADR 0022](../../adr/0022-prompt-hook-cold-path.md)) this design does not move. |
| Thresholds per kind | Finding 1: the kind does not separate knowledge from records. |
| Filter whole turns | A mixed turn holds the knowledge in one sentence; dropping the turn loses it. |

## 5. The pipeline (`src/distill/pipeline.ts`)

For each turn, in order:

1. Remove the sentences of notes the session had been shown (`withoutNotes`, below).
2. Remove the host's blocks from the prompt and the answer (`stripHost`, section 6).
3. Split both into candidates (`candidates()`).
4. Drop never-knowledge sentences (`dropNoise`, section 6). With no candidate left, the turn is `skipped` with no request.
5. Ask the judge version 2 once (section 7). The `user_prompt` and `assistant_final_message` it receives are the texts of steps 1 and 2 with the dropped sentences of step 4 removed, so neither the host's frame nor a noise sentence reaches it; the `Context:` line is built from the same prompt.
6. Build a draft or nothing (section 8).
7. Consolidate the draft as today.

### The notes the session had been shown

`withoutNotes` (`src/retrieve/render.ts`) removes from the turn the sentences of memories the session was shown, so the mem does not store again what it injected. Two bounds are added to the injections it reads (`toldInSession`, `src/distill/pipeline.ts`):

- only injections made at or before the turn's `ended_at`; when `ended_at` is null, no time bound;
- never a memory made from this same turn (`source_turn_id`). A turn's `ended_at` can move later (a late turn-end re-ends it, `src/store/turns.ts`), so the time bound alone does not stop a memory made from the turn's first ending, and shown before its late ending, from removing the turn's own sentences.

### The `Context:` line

`buildDraft` appends `Context: <prompt>` when the title came from the answer, and only when the prompt has at least 5 words (`CONTEXT_MIN_WORDS`, section 8). "Context: aprovo" gives the reader nothing.

## 6. The noise filter (`src/distill/noise.ts`)

Pure: no database, no model. Built (commits `cb944a4`, `626ed2c`); D-3 removes two of its patterns and this revision anchors `host-frame`. Each pattern has a name so that the proof can report what it dropped.

### `stripHost(text)`: the host's blocks, before segmentation

Applied to the prompt and to the final answer. Each block is removed whole:

| Block | Removed |
|---|---|
| `<agent-message …>` | to its close, including the subagent's report inside it |
| `<task-notification>`, `<system-reminder>` | to its close |
| `<summary>` | to its close on the same line, or to the end of the line |
| `<details>`, `</details>` | the tags only; what is between them stays |

A block tag that never closes is removed to the end of the text only when it opens a line outside a code span or fence: a host block cut short. A tag named in prose or in backticks ("the hook strips `<system-reminder>` before…") is text and stays, with everything after it (AC-13).

Assumption, measured by the proof: an assistant that receives a subagent's report restates in its own sentences what matters, and those stay. The proof reports every turn where `stripHost` removed text, and whether a quoted knowledge sentence was inside it. An assistant that writes its own `<summary>` element loses that line.

The prompt already loses host notifications that open it (`isFromTheHost`, `src/core/host-prompt.ts`); `stripHost` also catches a block in the middle of a prompt.

### `dropNoise(candidates)`: sentences that are never knowledge

Applied to the candidates after segmentation. Returns the kept candidates, re-indexed from 0 so that the judge's `candidates[i]` paths stay dense, and the dropped ones with the pattern's name.

| Name | The sentence | Evidence |
|---|---|---|
| `host-frame` | starts with one of the host's fixed frame lines ("[Subagent hand-back]", "The report follows", "It is model output, NOT a message from the user", "This tool result is internal metadata", "agentId:", "output_file:", "Async agent launched successfully", and the other lines listed in the code) | The host's fixed text. Anchored at the start of the sentence, so a sentence that quotes one of these phrases while discussing the host passes. |
| `status-label` | starts with `Status:`, `Estado:` or `State:`, case-sensitive | 4 matches in the sample, all records. |
| `template-label` | starts with `Title:`, `Body:`, `Título:` or `Corpo:` followed by a space | 2 matches in the sample, both leaked templates. |

The samples behind `status-label` and `template-label` are small. The proof measures each pattern at the sentence level on its new labels; a pattern that drops a quoted knowledge sentence is removed. Signals that matched knowledge in the sample stay out: "Bottom line:", "Registado:" ("Recorded:"), numbered titles, a title that addresses the user, "não era X, é Y" ("it was not X, it is Y", which marks a cause and its fix), verdict words and bracketed protocol tags (D-3).

## 7. The questions, version 2 (`src/judge/questions.ts`)

Same request per turn, same primitives, same answer handling. The state gains one field, `reader`, so every question can name the same person:

```yaml
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

Instructions: "Which candidate, read by `reader` on its own, best states the knowledge of this turn: the rule, the decision and its reason, the cause and its fix, or the fact?" The `none` option: "No candidate states knowledge on its own." A `none` answer does not veto the turn: the policy then takes the candidate with the highest `knowledge` (section 8).

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

A turn whose `kind` is `none` stores nothing, as today.

### `importance` (score)

Instructions: "How costly would it be for `reader` not to know this? Rate the knowledge in the sentences, not the amount of work the message reports." The judge answers 0 to 4; the stored importance is that answer plus one (`round(score) + 1`, as today):

| Stored | Criterion |
|---|---|
| 1 | Nothing: they would do the same without it. |
| 2 | Minutes: a detail they would find quickly in the code or the docs. |
| 3 | An investigation: a cause, a behaviour or a location they would not find by reading the code around it. |
| 4 | A mistake: a rule of the project, an approach already rejected, or a correction the author gave. |
| 5 | Damage: data loss, a security problem, or breaking a hard rule of the project. |

### Versions

`TypeSafeJudge.version` and `heuristicJudge.version` become `"2"`. `DistillVerdict` keeps the field name `durable` for the per-candidate probabilities, now read from the `knowledge_<i>` answers; renaming it is left to a later change so the pipeline's types stay as they are. The consolidation and `personal` questions (whether a rule is the author's own, ADR 0018) are untouched.

The import rejudge (D-2) asks for the version 1 wording through one new optional field on the judge's input, `DistillInput.wording` (`1` or `2`, default `2`). The version 1 builder in `questions.ts` keeps only `worth`, `kind` and `importance`, the questions `rejudge` asks (it sends no candidates). Version 1's tokens per turn are already recorded for the golden turns (`tests/golden/typesafe-answers.json`), so the proof does not ask version 1 again (D-5, section 11). `rejudge` stamps the version from the same constant it sends as the wording, so the stamp and the questions cannot drift apart. The heuristic judge ignores the field; `rejudge` already requires TypeSafe.

## 8. The policy (`src/distill/policy.ts`)

Starting values, chosen on sample A and checked on sample B (section 11):

- `SAVE_THRESHOLD = 0.5` on `worth`, as today.
- `KNOWLEDGE_THRESHOLD = 0.5` replaces `DURABLE_THRESHOLD`: a sentence is knowledge when its `knowledge` reaches it.
- **The title must be knowledge.** The title is the judge's choice when that candidate's `knowledge` reaches the threshold; otherwise the candidate with the highest `knowledge` that reaches it (the lowest index on a tie); if none does, the turn stores nothing, even when `worth` passed. Today a `worth` pass with one durable sentence is enough, which is how a status line became a memory with nothing under it.
- The body: the five strongest knowledge sentences (`MAX_FACTS = 5`), in the order written, without the title; then the `Context:` line when it applies.
- `CONTEXT_MIN_WORDS = 5`.

Everything that turns a probability into an action stays in this file, in code, tested.

## 9. The heuristic judge, version 2 (`src/judge/heuristic.ts`)

For installations without a key, and for the drain when TypeSafe fails. The noise filter runs before either judge. On top of it:

- **Report penalties.** A sentence of the answer that carries a report signal (a commit hash, a pull request reference, a status verb in English or Portuguese, a verdict word, a test count) has a lower knowledge probability.
- **A worth discount.** An answer whose sentences mostly carry report signals has a lower `worth`.
- The amounts, the lists and the share are constants in the code, tested. With both turned off the heuristic answers as version 1 does, so the proof can compare the two (D-6).
- Everything else as today: the judge stays tuned to keep too little rather than too much.

Known limit: "Decisão aplicada (commit 5808e41)" ("Decision applied (commit 5808e41)") was knowledge, and the commit hash lowers it. D-6 bounds the damage on the samples.

The golden set (`tests/golden/turns.json`) gains at least 8 turns written from the sample's shapes, anonymised, in both languages: a gate verdict, a "bottom line" status report with a rule inside it (the rule must be the title), a wave closed with a commit hash, a "your turn" hand-off, a subagent's hand-back quoted in the answer, a short-acknowledgement prompt with a real fix in the answer (kept), a plan for the session, a leaked `Title:` template. The golden input goes through `stripHost` and `dropNoise`, as live turns do. The floors of `tests/golden/judges.test.ts` (precision and recall 0.85, kind 0.75) hold for both judges; TypeSafe's answers are recorded again with `bun scripts/record-typesafe.ts`. The golden floors are the checkpoint before the paid proof.

## 10. Critical journeys

- **A turn that is only a status report.** Given the prompt "ok" and the answer "Status: the wave is closed and pushed to origin. Next I will open the pull request for review.", when the drain distils it, then `dropNoise` drops the first sentence, the judge rates the second below `KNOWLEDGE_THRESHOLD`, and no memory is stored.
- **A turn the filter empties.** Given an answer made only of a quoted hand-back, when the drain distils it, then no request is made and the turn is `skipped`.
- **A mixed turn.** Given the answer "Bottom line: the wave is closed and the gate is next. The e2e never fires the real POST: sending is paid, everything is intercepted.", when the judge chooses the first sentence as title but rates its `knowledge` below the threshold and the second's above, then the second sentence is the title.
- **A `none` title.** Given a turn whose judge answers `none` for the title and rates one sentence above the threshold, when the policy runs, then that sentence is the title.
- **A short acknowledgement with a fix.** Given the prompt "aprovo" and an answer whose first sentence states a cause and its fix, when the judge rates that sentence above the threshold and `worth` passes, then the memory is stored with that sentence as title and no `Context:` line.
- **A note shown later in the same session.** Given a turn whose memory was injected after the turn ended, when the turn is distilled again, then its sentences are judged as they were written.
- **The import rejudge.** Given imported memories, when `rejudge` runs, then the version 1 questions are asked and `judge_version` stays `'1'`.

## 11. The proof (`scripts/proof/quality.sh`, `scripts/proof/quality.ts`)

### Where it runs

On a read-only copy of the author's store (`sqlite3 -readonly … ".backup"` into a fresh data directory), with a TypeSafe key from the environment, never on the live database. The guard is the existing proofs' (`assertNotLive`, `scripts/proof/live-guard.ts`): it compares real paths, including a store moved out of the data directory (`WIZARDINGCODE_MEM_STORE_DIR`) and a brand home moved by `WIZARDINGCODE_HOME`, and treats `WIZARDINGCODE_HOME`, `WIZARDINGCODE_MEM_DATA_DIR` and `WIZARDINGCODE_MEM_STORE_DIR` in the environment as live. `quality.sh` and `quality.ts` refuse a work directory, a labels file or a copy inside the repository or inside the live data and store directories. The proof writes an anonymous `report.md` for the ADR and `full.md` with titles for the author.

### What runs

`quality.ts` has two modes:

- `sample` draws the samples and writes them with the labelling brief (`scripts/proof/quality-brief.md`).
- `measure` reads the labels and runs, in process, the same steps as the drain up to the draft (`prepareTurn`, `draftTurn`, section 5 steps 1 to 6). It does not consolidate and writes no memory. A draft is a "stored" memory for the metrics.

Version 1 is the memory version 1 stored for the turn (its title and body), or nothing for a turn of sample S; version 1 is not asked again. Version 2 is one TypeSafe request per turn, with the live drain's timeout and retries, so a request that would fail live fails in the proof. Only TypeSafe verdicts are counted; a turn where TypeSafe did not answer is reported as failed and left out of the shares. The heuristic is run with its report signals on (version 2) and off (version 1).

### Samples and labels

- **Sample A** (calibration) and **sample B** (check): 200 active distilled memories each, `judge = 'typesafe'` and `judge_version = '1'`, drawn at random with a fixed seed, disjoint, with their source turns.
- **Sample S** (skipped turns): 100 turns version 1 skipped whose text is still there, drawn the same way, without the turns the drain skipped because the agent saved a memory itself (`memory_save` in that turn). It shows what version 2 stores from turns version 1 did not.
- `--projects` and `--exclude-projects` limit the draw (D-4).
- Each turn is labelled `knowledge`, `mixed`, `record` or `fragment` (D-4 for who labels). The brief gives the labeller the turn's candidate sentences as the segmenter cuts them (before the filter), each with an id. For `knowledge` and `mixed`, the labeller names the ids of every candidate that holds knowledge on its own, so a quote and a title compare as the same segmenter output; `measure` refuses a `knowledge` or `mixed` label with no non-empty quote, and an unknown label.
- The author checks 20 labels of each sample, drawn with the proof's seeded generator. With more than 3 disagreements in 20, the brief is corrected and that sample labelled again.
- The labels never enter the repository.

### Metrics

Both versions are measured on the same turns, with the same labels.

| Metric | Denominator | Target |
|---|---|---|
| Title is knowledge: the title's full sentence (before the 120-character clip) is one of the quoted candidates | memories stored from sample B | version 2 ≥ 60% |
| Lost: a `knowledge` or `mixed` turn whose memory holds none of its quoted sentences, or with no memory | `knowledge` and `mixed` turns of B | version 2 loses no turn version 1 kept; turns both lose are reported |
| Stored from a `record` or `fragment` turn | memories stored from B and S | version 2 ≤ 15% |
| Memories stored, title-only memories, importance distribution | — | reported |
| Turns the filter emptied; drops per pattern; turns where `stripHost` removed text, and quoted sentences among the removed text | — | reported |
| Mean input tokens per judged turn | the golden turns, version 1 as recorded and version 2 as recorded again | version 2 ≤ 2 × version 1 (D-5); the mean on B reported |
| Lost, for the heuristic | `knowledge` and `mixed` turns of B | version 2 ≤ version 1 (D-6) |
| Stored from a `record` or `fragment` turn, for the heuristic | memories the heuristic stores from B and S | version 2 < version 1 (D-8) |

A version 2 that stores less is held by the "lost" target: it cannot meet the shares by dropping knowledge. A memory stored from a `record` turn counts as noise even when its new title is knowledge the labeller missed; the report lists them.

### Calibration and the merge

On sample A, when a target is missed, one lever at a time, in this order, each in steps of 0.05 and at most three steps:

1. Records over 15%: raise `KNOWLEDGE_THRESHOLD`; title share under 60%: the same.
2. Turns lost: lower `KNOWLEDGE_THRESHOLD`, then `SAVE_THRESHOLD`.
3. Still missed: one change to the wording of the criterion that misled the judge, recorded again.

If sample A still misses a target, the proof stops and the author reads the report. The numbers for the ADR come from sample B. If a target is missed on B, the change is not merged; the author decides: recalibrate on a fresh sample, change the questions and measure again, or accept a named loss.

### Cost

TypeSafe: one request per turn of A, B and S (about 500); calibration changes only thresholds and re-runs the policy on the verdicts already received, except a wording change, which asks sample A again. Labelling: about 500 turns by the chosen labeller. Cost and time are measured by the proof and reported in the ADR (D-9).

## 12. Risks and limits

| Risk | What answers it |
|---|---|
| Version 2 drops knowledge in daily use that the samples did not show | The "lost" target before the merge. A skipped turn keeps its text in `turns` until `compact` deletes it after 90 days; the separate cleanup item (D-1) can distil such turns again only within that window. No switch back to version 1 at runtime; rolling back is a release. |
| A filter pattern drops knowledge | Only the host's text and patterns with no knowledge match in the sample; the proof reports drops per pattern and a pattern that drops a quoted sentence is removed. |
| `stripHost` removes a report the assistant did not restate, or an assistant's own `<summary>` line | Reported per turn by the proof, with any quoted sentence inside. |
| The heuristic penalises knowledge that carries a commit hash | D-6. |
| The labeller disagrees with the author | 20 labels per sample checked; more than 3 disagreements relabel the sample. |
| The labeller sees the author's project text | D-4: the proof sends nothing itself; the author chooses the labeller and the projects drawn. |
| Version 2 costs more tokens per turn | D-5. |
| A turn the filter emptied and a turn the judge rejected both end `skipped`, with nothing saying which | Known; the proof reports the filter's share. |

## 13. Non-functional requirements

- Privacy: section 11 ("Where it runs") and D-4.
- Performance: one request per turn, as today; tokens bounded by D-5. `tests/golden/retrieval.test.ts`, the hook snapshots and the perf budgets stay byte for byte.
- Rollback: a release. Memories written by version 2 stay valid rows; `judge_version` says which questions produced them. No migration.

## 14. Tests

- `tests/unit/noise.test.ts`: every pattern on fixtures in both languages; the sentences that must pass ("Bottom line: o `opencode` só está instalado sob o Node v22…", "Decisão aplicada (commit 5808e41)…", "Registado: …", "4. Sem idempotência: duplo envio.", "Não era bug de código, era a regra…", "only APPROVED campaigns are sent", "[arka:gate:4] …", "Verdict: REJECTED …", a sentence that quotes "NOT a message from the user" mid-sentence); `stripHost` on a real hand-back frame; an unclosed tag that opens a line removes to the end, one named in prose or in backticks removes nothing; re-indexing.
- `tests/unit/draft.test.ts` and `tests/integration/distill.test.ts`: the journeys of section 10 that run through the drain; the `Context:` rule at 4 and 5 words; the judge's title index refers to the kept list; the texts the judge receives and the `Context:` line hold no dropped sentence; a note from another turn shown after this turn ended does not remove this turn's sentences.
- `tests/unit/questions.test.ts`: the version 2 questions reference only state paths that exist; the candidate questions are dense; `distillVerdict` maps `knowledge_<i>` and the `none` title; `wording: 1` gives the version 1 `worth`, `kind` and `importance` and nothing else.
- `tests/unit/heuristic-judge.test.ts`: the report penalties and the worth discount; with them off, the version 1 answers.
- `tests/integration/rejudge.test.ts`: the import rejudge asks the version 1 questions and stamps `judge_version = '1'`.
- `tests/golden/*`: the new turns through the filter, the floors, the recording.

## 15. Documents

- ADR 0023, "Memory quality: knowledge, not records", proposed with the change and accepted with the proof's numbers: thresholds chosen, drops per pattern, tokens, the heuristic's comparison.
- `CLAUDE.md`: the noise filter, judge version 2, the proof script.

## 16. Open questions

- Whether a chosen sentence alone is often too short to be understood; the title-only share and the author's reading of `full.md` answer it.
- The design of the cleanup of the existing base (D-1), and whether the imported memories ever move to version 2 (D-2).
- The final values of `SAVE_THRESHOLD` and `KNOWLEDGE_THRESHOLD`, set by the proof.
- Renaming `DistillVerdict.durable` to `knowledge`.
