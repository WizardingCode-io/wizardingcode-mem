# qa lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: delivery
verdict: validated
## Returns
none
## Notes
- **Criteria.** All 19 criteria have the record they need in `.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/report.md:26-46`.
  - 17 behaviour criteria have red then green records. Where a criterion was recorded more than once, the latest run decides.
  - AC-11 is a preserve criterion, passing before and after (24 to 24, `report.md:38`).
  - AC-12 is an observed criterion, and its reason is stated: it is a document, so no red run can exist (`report.md:39`).
  - AC-14 shows "own record: missing", but it is superseded by AC-18 (`report.md:41`), and AC-18 has its own red and green (`report.md:45`). Nothing open depends on AC-14.
- **My spec returns are closed in the tests.**
  - R-1 asked for AC-13. Mode 0700 is asserted at `tests/unit/knowledge-repo.test.ts:158` and `:253`.
  - R-3 asked that a failed write leave the row and head unchanged. AC-18 holds this, using the failing-commit store at `tests/unit/knowledge-store.test.ts:151-157`.
  - The round-2 gap I left as a note was a hand-deleted file in a failed adopt. It is now asserted at `tests/unit/knowledge-index.test.ts:883-911`: after the failed commit the status shows ` D entries/deleted-entry.md`, the file is still absent, the bytes of the edited and added files are unchanged, the rows are unchanged and no intent record is left. The same test then shows the adopt going through.
- **AC-19 spot checks.**
  - The store move refused while a knowledge lease is held is tested at `tests/unit/knowledge-repo.test.ts:798-804`.
  - A filter section in the repository's config is refused at `tests/unit/knowledge-repo.test.ts:377-414`.
  - The CLI's exit code 1 is asserted at `tests/integration/knowledge-cli.test.ts:447`, `:502`, `:529` and `:539`.
- **Test-quality gate, round nine.**
  - The verdict is proven with 17 advisories and no defects (`review/ruling.round9.json`, the test-quality ruling).
  - Round eight's two upheld defects are closed:
    - `src/modules/knowledge/resolve.ts:268` and `src/doctor/checks.ts:587` each have a mutant killed (`probes/round-nine-mutations.md:8-12`).
    - The negative assertions also check that the expected change happened, not only that the bad one did not, e.g. git status showing ` D knowledge.json` (`review/test-quality.round9.md:25-33`).
  - This round adds four rules (the rebuild refusal and the taxonomy read through a link). The mutants that undo them are all killed (`probes/round-nine-mutations.md:13-21`).
- **Advisories I accept as open debt.** None of them is a missing proof for a criterion.
  - The rebuild refusal's message hints are not asserted, and nothing drives it through the CLI's stderr (`tests/unit/knowledge-index.test.ts:618`).
  - Clipping is checked on the thrown message, not on the log line (`tests/unit/knowledge-repo.test.ts:547`). This is AC-13's third clause, held one step short of the log.
  - Only the version probe is timed out (`tests/unit/knowledge-store.test.ts:440`).
  - Mutation coverage is shown only for the lines rounds eight and nine touched (`review/test-quality.round9.md:55`).
- **Code-quality gate, round nine.** The verdict is proven with 15 advisories, all carried or naming outside the change. None is a defect (`review/ruling.round9.json`, the code-quality ruling).
- **Gates.** Test, build and typecheck pass on the current commit (`report.md:52-57`). Nothing is merged, so "the merged tree" is this checkout's single tree. Re-check after the merge.
- **Lint gate.** It records a pass on 0 files (`report.md:56`, filed as debt at `biome.json:1`). The real lint proof is the session's biome run over the folders by name (346 files, no errors). That run is the session's word, not an engine log. I do not return on it, because the gate itself is outside this change.
- **Not proven, stated as such.** The permission cases return early as root or on Windows, and no such run was recorded (`tests/unit/knowledge-index.test.ts:567/656`, `tests/unit/doctor-knowledge.test.ts:298/368`). On those platforms nothing holds the unreadable-folder rules.
- **Flaky test.** The p95 test in `tests/perf/large-project.test.ts` was already flaky before this item and is not part of it.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/report.md, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/test-quality.round9.md, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/ruling.round9.json, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/round-nine-mutations.md, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-index.test.ts, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-repo.test.ts
