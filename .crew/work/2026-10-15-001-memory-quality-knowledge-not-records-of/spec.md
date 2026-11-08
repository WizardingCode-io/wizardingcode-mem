# Memory quality: knowledge, not records of a session

Full design: docs/superpowers/specs/2026-10-14-memory-quality-design.md (approved by the author on 2026-10-14, revised 2026-11-06 after spec review round 1). Implementation plan: docs/superpowers/plans/2026-10-15-memory-quality.md.

## Problem

The mem distils every turn with questions that do not separate knowledge from a record of the session. In a hand-labelled sample of 200 distilled memories (2026-10-13), 58.5% were records (delivered, merged, verdicts, plans), 29% held knowledge wrapped in narrative under a narrative title, and 9% were usable on their own by a future session. On 2026-11-06, 79% of the distilled memories TypeSafe judged sit at importance 4.

## Design

1. A pure noise filter (`src/distill/noise.ts`, built) before either judge: `stripHost` removes the host's blocks; `dropNoise` drops `host-frame`, `status-label` and `template-label` sentences, re-indexing and naming each drop. `protocol-tag` and `verdict` are removed (D-3). A turn with nothing left is skipped without a request.
2. `withoutNotes` reads only injections made at or before the turn's end.
3. Questions version 2: `reader` in the state, `knowledge_<i>` per candidate, contrastive criteria. Both judges report version "2". The import rejudge keeps the version 1 wording and stamps '1' (D-2).
4. Policy: `KNOWLEDGE_THRESHOLD = 0.5`; the title must be knowledge; `CONTEXT_MIN_WORDS = 5`.
5. Heuristic version 2: report penalties and a worth discount.
6. A proof on a read-only copy: two labelled samples of 200, version 1 and version 2 measured on the same labels, TypeSafe verdicts only.

The cleanup of the existing base (`rejudge distilled`, migration 8) is a separate item (D-1).

## Acceptance criteria

- AC-1: Host framing text and the sentences named in the noise filter never reach the judge; each drop is named.
- AC-2: A turn whose candidates the filter empties is skipped without a judge request.
- AC-3: A memory is stored only when its title sentence is knowledge (KNOWLEDGE_THRESHOLD); the Context line needs 5 prompt words.
- AC-4: Judge version 2: knowledge_<i> questions, reader in the state, contrastive criteria; golden floors hold for both judges with re-recorded answers.
- AC-5: Heuristic version 2 penalises report sentences and discounts a mostly-report answer.
- AC-9: The noise filter has no protocol-tag or verdict pattern: such sentences reach the judge.
- AC-10 (preserve): The import rejudge keeps the version 1 questions and stamps judge_version 1.
- AC-11: The proof script measures the metrics of the spec on a read-only copy, with TypeSafe verdicts only and injections bounded to the turn's end. (Supersedes AC-8.)

## Risks and rollback

See section 7 of the full design. Rollback of the code is a release; memories written by version 2 stay valid rows (`judge_version` records which questions produced them). No migration in this item.

## Out of scope

The cleanup of stored memories (D-1), the imported memories (D-2), retrieval, generated text.
