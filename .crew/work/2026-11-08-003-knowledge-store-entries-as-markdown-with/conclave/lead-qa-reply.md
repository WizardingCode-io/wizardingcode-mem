# qa lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: spec
verdict: validated
## Returns
none
## Notes
- R-1 from round 2 is resolved.
  - `.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:112` now separates the two cases. A person's write, an accept and a reject restore their staged paths from HEAD. An `adopt` only runs `git reset -- <paths>` and writes back the original bytes it read before rewriting `version`, `updated` and `author`.
  - The adopt section at `spec.md:161` repeats this ("the person's work is never restored from HEAD") and says the bytes are kept before the rewrite.
- AC-18 (`spec.md:252`) replaces AC-14 and states both behaviours so a test can check them. AC-14 at `spec.md:251` is marked superseded, so the old, wrong adopt text no longer binds anything.
- Plan task 14 (`plan.md:32`) asserts the adopt case.
  - It uses a stub `git` that fails `commit`.
  - `adopt` over a hand-edited file and a hand-added file throws code `git`.
  - `git status --porcelain` shows ` M` and `??`, so both paths are unstaged.
  - Both files' bytes equal what the person wrote, with no raised version and no stamped `updated`.
  - The rows are unchanged.
  - The accept and reject cases and the entry-id cases are kept, and AC-15 is unchanged.
- AC-13 (`spec.md:250`) now names code `invalid` for a write onto a symlink. This matches the case in `plan.md:39`.
- A minor gap, not a return: the plan's adopt failure case covers an edit and an addition but not a hand-deleted entry. Spec.md:161 runs `git rm` for deletes, so a failed commit must leave the file deleted and unstaged. The reset rule covers it, and the case is cheap to add.
