# ADR 0023 — Memory quality: knowledge, not records of a session

Date: 2026-11-08 · Status: accepted, with two targets missed on sample B and accepted by the author (D-12; see [The proof](#the-proof)). Design: `docs/superpowers/specs/2026-10-14-memory-quality-design.md`; plan: `docs/superpowers/plans/2026-10-15-memory-quality.md`.

## Context

A random sample of 200 memories the mem had distilled on the author's store (2026-10-13), labelled by hand, held 9% knowledge, 29% knowledge wrapped in the narrative of a session, 58.5% records of a session and 3.5% fragments. Of the 3,733 active distilled memories TypeSafe had judged (2026-11-06), 79% were at importance 4: "durable" was asked as "stays true after the conversation", and "PR #2941 merged" stays true; the title question asked for the sentence that works best as a title, not for the one that holds the knowledge. The host's own framing text (subagent hand-backs, `<summary>` elements) was reaching the judge.

## Decisions

- **One test for knowledge.** Knowledge is what would change what a stranger does in the project a month from now. Events, states and verdicts are not knowledge.
- **The mem chooses, it never generates.** For a mixed turn the judge picks the sentence that holds the knowledge; narrative sentences are not kept. No model writes text.
- **A sentence-level noise filter before either judge** (`src/distill/noise.ts`): the host's blocks; the host's fixed frame lines, anchored at the start of a sentence; status labels; leaked template labels. Named, so the proof reports each drop. A turn with no sentence left is skipped without a request.
- **Only patterns with no knowledge match (D-3).** Verdict words and bracketed protocol tags were dropped from the filter: some of what they matched in the sample was knowledge (whole-memory precision 0.80 and 0.88). They reach the judge, whose version 2 criteria name verdicts and statuses as records.
- **Version 2 questions**: a `reader` named once in the state, `knowledge_<i>` per sentence with contrastive criteria, kinds that say what they are not, importance rated on the knowledge and not on the work reported. Version 2 of the heuristic penalises report sentences.
- **The kind question classifies a turn by its most useful knowledge sentence** (calibration on A): `none` means that no sentence is knowledge, not that the turn is mostly a report.
- **The title must be knowledge** (`KNOWLEDGE_THRESHOLD`, 0.45 after calibration), and the `Context:` line needs five prompt words.
- **The notes a session was shown are bounded** by the turn's end, and never include the memory made from the same turn, so a turn distilled late keeps its own sentences.
- **The import rejudge keeps version 1 (D-2)**: one constant gives its wording and its `judge_version = '1'`.
- **The existing base is not cleaned here (D-1)**: that is a separate item, designed with these numbers in hand.
- **The proof's labeller is the author's choice (D-4)**; the proof sends nothing to a model but TypeSafe.
- **A token ceiling (D-5)** and **no regression without a key (D-6)**: measured below.
- **Two targets missed on B are accepted, with the losses named (D-12).**
- **Nothing else moves**: retrieval, hooks, the brief and the pinned snapshots are byte for byte as before.

## The proof

`scripts/proof/quality.sh` on a read-only copy of the author's store (2026-11-08: 3,780 eligible memories, 4,389 skipped turns; seed 7; every project). Version 1 is the memory version 1 stored; TypeSafe version 2 was asked once per turn, with the drain's timeout and retries; only its own verdicts count, and turns it did not answer are left out of every share (none failed).

Labeller: Claude Code subagents given `scripts/proof/quality-brief.md`, one per 25 turns of A and B and one per 50 of S (D-4). The 20-turn checks were made by the agent, on the author's instruction.

Cost and time (D-9):

- The measure on B: 200 requests, 1,201,613 input tokens, 35 s.
- The calibration on A: two runs of 294 requests (1,551,126 and 1,557,006 input tokens, 50 s each), and threshold steps that reused the verdicts.
- The golden answers, recorded twice: 40 requests each (about $0.003).
- Labelling: five rounds of 8 or 2 subagents, about two minutes each.

The first labelling of A (brief at `8c67677`) gave 156 of 200 turns `mixed`: the labellers quoted what a change did, the state of the session and the user's request for the task. The brief now says those are never knowledge (`c4363e0`), and A and S were labelled again from scratch; B was labelled once, with that brief.

### Samples and labels

| Sample | Turns | knowledge | mixed | record | fragment | 20-turn check: disagreements |
|---|---|---|---|---|---|---|
| A (calibration) | 200 | 0 | 140 | 59 | 1 | 0 |
| B (check) | 200 | 3 | 122 | 75 | 0 | 1, corrected (a question to the user, labelled `mixed`) |
| S (skipped by version 1) | 100 | 0 | 10 | 84 | 6 | 0 |

### Calibration on A

With the version 2 questions as written first, TypeSafe answered `kind = none` for 120 of the 294 turns of A and S, while judging one of their sentences knowledge (0.5 or more) in 97 of them. The question asked what a turn *mainly* contains, and a report of a session that holds one useful sentence is mainly a record. Version 2 lost 66 turns of A that version 1 kept. The levers, each measured:

1. The thresholds could not move that cause (lowering `KNOWLEDGE_THRESHOLD` or `SAVE_THRESHOLD` would recover at most 2 and 14 turns), so the one wording change came first: `kind` now asks which kind of the turn's knowledge is the most useful, and `none` means no sentence is knowledge. Lost: 66 → 12. The golden answers were recorded again.
2. `KNOWLEDGE_THRESHOLD` 0.50 → 0.45: lost 12 → 9, records 13% → 15%. At 0.40 the heuristic breaks D-6 (70 lost against 69) and records reach 16%.
3. `SAVE_THRESHOLD` 0.45, 0.40 and 0.35: lost 9 → 8, records 16%. Kept at 0.50.

On A after calibration: title is knowledge 66% (100 of 151), records 15% (23 of 156), lost 13 of 140 for version 2 as for version 1; 9 of version 2's are turns version 1 kept.

### Before and after, on B

| Metric | Denominator | TypeSafe v1 | TypeSafe v2 | Target | Heuristic v1 | Heuristic v2 |
|---|---|---|---|---|---|---|
| Title is knowledge | memories stored from B | 20% (39 of 200) | 61% (90 of 147) | v2 ≥ 60%: met | 26% (30 of 114) | 29% (33 of 112) |
| Lost | knowledge and mixed turns of B | 6% (7 of 125) | 10% (13 of 125) | v2 loses none v1 kept: **missed** (11) | 46% (57 of 125) | 44% (55 of 125); D-6 met |
| Stored from record or fragment | memories stored from B and S | 38% (75 of 200) | 24% (37 of 152) | v2 ≤ 15%: **missed** | 34% (45 of 132) | 33% (43 of 130); D-8 met |
| Memories stored; title-only | A and B | 400; 21% | 303; 19% | reported | 232; 16% | 228; 17% |
| Importance 1/2/3/4/5 | A and B | 0/0/72/314/14 | 0/3/243/53/4 | reported | 0/120/102/10/0 | 0/117/101/10/0 |
| Mean input tokens per judged turn | the 32 golden turns both recordings hold | 1,222 | 1,578 (ratio 1.29) | v2 ≤ 2 × v1 (D-5): met | — | — |
| Mean input tokens per judged turn, version 2 | judged turns of B | — | 6,008 | reported | — | — |
| Turns TypeSafe failed | — | — | 0 | reported | — | — |

Thresholds: `SAVE_THRESHOLD` 0.50, `KNOWLEDGE_THRESHOLD` 0.45. A real turn of the author's store is about four times a golden turn: D-5 holds on the golden set, and a judged turn costs about 6,000 input tokens (about $0.0003).

**The missed targets (D-12, the author's decision): accepted, with the losses named.** For six more lost knowledge turns in 125, version 2:

- cuts the share of memories made from records by a third (38% → 24%);
- triples the titles that hold the knowledge (20% → 61%);
- makes importance discriminate (82% → 19% at 4 or 5).

About a third of the 37 memories counted as records hold a fact the labeller of B marked `record`: 2609 (a stale route cache keeps serving three mounts without auth), 2475, 4067, 8590, 7140 and 1625. B's labels were not corrected after the measure, since B is never used to tune.

The eleven turns of B that version 2 lost and version 1 kept, by what they hold:

- 7270: a dependency advisory that keeps a gate red.
- 2262: a song's working method.
- 7335: a rollback breaks the links already sent.
- 8789: the golden answers must be recorded again.
- 3742: the dev server's hot reload.
- 2070: a merged tree green, and a fixed test.
- 2581: nothing pushed, by a rule.
- 8534: a route raised to full mid-item.
- 4384: Codex used only for review.
- 8438: no dark mode; deploy later.
- 3995: connectors read-only because a SQL guard rejects writes.

Most are a fact inside a report of a session; 2581, 8438 and 4384 hold a rule or a preference of the author.

### The filter

Turns emptied: 6. Sentences dropped per pattern: `status-label` 8; quoted candidates among them: 0. Turns where `stripHost` removed text: 1; with a quoted candidate among the removed text: 0.

### The golden set

| Judge | Precision | Recall | Kind |
|---|---|---|---|
| heuristic v2 | 100% | 100% | 83% |
| typesafe v2 | 85% | 94% | 88% |

TypeSafe keeps `en-none-obvious-from-code`, `en-none-general-knowledge` and `pt-none-your-turn`, and misses `en-change-json-flag`.

## What the proof leaves open

- The labels are the subagents', and the 20-turn checks were the agent's, not the author's own reading; the labeller of B was stricter than that of A (37% `record` against 30%).
- A memory stored from a turn labelled `record` counts as noise even when its new title is knowledge the labeller missed; the full report lists them.
- Whether a chosen sentence alone is often too short to be understood (the title-only share, 19%).
- The heuristic, the judge without a key, is barely better than version 1 (D-6 and D-8 met by one or two turns).
- The cleanup of the existing base (D-1), and whether the imported memories ever move to version 2 (D-2).
- Renaming `DistillVerdict.durable` to `knowledge`.
