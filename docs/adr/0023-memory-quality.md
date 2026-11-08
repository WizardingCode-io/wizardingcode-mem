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
| Mean input tokens per judged turn | the 32 golden turns both recordings hold | 1,222 | 1,578 (ratio 1.29) | v2 ≤ 2 × v1 (D-5) | — | — |
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
