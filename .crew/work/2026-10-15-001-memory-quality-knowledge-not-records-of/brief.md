# Brief

## Request

Memory quality: knowledge, not records of a session (spec docs/superpowers/specs/2026-10-14-memory-quality-design.md)

## Goal

The mem keeps knowledge (rules, decisions with their reason, causes and fixes, pitfalls, how things work) instead of records of a session (delivered, merged, verdicts, plans, "your turn"), both for new turns and for the memories it already stored.

## Context

A labelled sample of 200 distilled memories on the author's store (2026-10-13) was 9% knowledge, 29% mixed, 58% records, 4% fragments. The judges' version 1 questions let records through ("PR merged" stays true), and the title question picks the sentence that reads best, not the one that holds the knowledge. Cheap sentence patterns with 97–100% precision exist for the host's framing text, status labels, protocol tags and verdicts.

## Constraints

- Clean room: never open or copy claude-mem.
- No model generates text: judges classify and select; thresholds and rules in code.
- Nothing is deleted: memories become `archived` or `superseded`.
- Hooks, retrieval, brief and pinned snapshots untouched byte for byte.
- Migration 8 is a new file; migration 7 is not edited.
- The author's live data is never written by tests or the proof.
- Recording TypeSafe answers costs real money; never hand-written.

## Acceptance

- AC-1 Host framing text and the sentences named in the noise filter never reach the judge; each drop is named.
- AC-2 A turn whose candidates the filter empties is skipped without a judge request.
- AC-3 A memory is stored only when its title sentence is knowledge (KNOWLEDGE_THRESHOLD); the Context line needs 5 prompt words.
- AC-4 Judge version 2: knowledge_<i> questions, reader in the state, contrastive criteria; golden floors hold for both judges with re-recorded answers.
- AC-5 Heuristic version 2 penalises report sentences and discounts a mostly-report answer.
- AC-6 Migration 8 adds memory_reviews; NewMemory accepts sourceOrdinal.
- AC-7 rejudge distilled supersedes, archives or keeps each version-1 distilled memory from its source turn, resumes, dry-runs without writing, and --undo restores the counts.
- AC-8 The proof script measures the metrics of spec section 6 on a read-only copy and rehearses the cleanup with undo.

## Assumptions

Confirmed by the author in conversation (design "concordo" on 2026-10-14; spec and plan "força segue aprovado" on 2026-10-15):

- The four labels (keep, mixed, episodic, fragment) and the one test (would a stranger joining next month act differently) stand.
- For a mixed turn the judge chooses the knowledge sentence; nothing is generated or rewritten.
- The filter drops only the 97–100% patterns and the host's blocks; medium signals stay with the judge.
- The cleanup of the existing base is manual, with a key, dry run first, reversible with `--undo`; imported memories, the viewer and any background pass are out of scope.
- The real cleanup of the author's live store is the author's decision after the ADR; the plan only rehearses it on a read-only copy.
