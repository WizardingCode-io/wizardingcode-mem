# qa lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:112 · The recovery rule is stated for all four operations, "a person's write, an accept, a reject and an adopt alike", but it is wrong for `adopt` and would destroy the person's work.
  - The rule restores every staged path from HEAD with `git checkout --` and removes any file that did not exist at HEAD.
  - The paths `adopt` stages (spec.md:161) are hand-edited entry files, hand-added entry files and hand-deleted entries. A failed adopt commit would therefore revert the person's edits to HEAD and delete the files they just added. Nothing else holds those edits, since they were never committed.
  - AC-14 (spec.md:251) and plan.md:32 ("the same for `rejectProposal` and for `adopt` over a hand edit") would pin that behaviour in a test.
  - Required change: take `adopt` out of the restore rule. After a failed commit, `adopt` must leave the working tree as the person had it, apart from the version and `updated` rewrite, or restore the original bytes it read. The index must stay unchanged and the error must be `git`.
  - Update AC-14 at spec.md:251 to say that after a failed adopt the person's hand-edited content is still on disk.
  - Update plan.md:32 to assert it: the hand-edited file's text and an added file are still present and the row is unchanged. The current wording asserts the opposite.

## Notes
- Round-1 returns are resolved.
  - R-1 (AC-13): tasks 17a and 17b exist at plan.md:39-40, with the mode, symlink and logged-`git`-failure cases. The Verification section names `tests/unit/knowledge-safety.test.ts` at plan.md:55.
  - R-2 (slug rules): they are stated at spec.md:78 and match the plan.md:7 cases (`entry`, `con-entry`, the cut at 80 on a hyphen).
  - R-3 (failure path): it is stated at spec.md:112 and spec.md:124, in AC-14 and in the plan.md:31-32 cases. The `adopt` exception above is the only defect in it.
- AC-14 to AC-17 each have plan cases.
  - AC-14 is in plan.md:32.
  - AC-15 is in plan.md:19 (config refusals and the `fsmonitor` marker) and plan.md:32 (`../x`, `a/b` and redaction).
  - AC-16 is in plan.md:12 (the two-column `module_migrations`) and plan.md:34 (orphans, `file:` and `dup:` rows, exit 0).
  - AC-17 is in plan.md:26.
- Spec.md:204 now says an orphan folder indexes nothing. Plan.md:34 matches it with "no row for either".
- AC-11 and AC-12 are unchanged and still adequate. The `crew tdd before` and `crew tdd after` steps are at plan.md:49, and the observed ADR task is at plan.md:50.
- One minor point, not a return. The `lstat` refusal of a symlinked write target is tested in plan.md:39 with code `invalid`, but spec.md:123 and spec.md:273 do not name the code. Add it when you edit AC-13.
