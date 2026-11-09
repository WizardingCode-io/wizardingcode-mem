# qa lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/plan.md:31-35 · AC-13 has no test in any plan task. Its three claims are mode 0700 on the knowledge folders, a symlinked entry file listed with a problem and never read or written, and a refused git call logged under a `knowledge.*` scope with the repository path and clipped stderr. The only mention of `O_NOFOLLOW` is in the implementation text of task 15, and 0700 and `logError` appear in no test case. A QA criterion must be named by a test or a run. Add cases with a red run to tasks 7, 13 or 16. Folder `stat` mode is 0700 after `ensureRepo`. A symlinked `entries/x.md` shows `problem` in `rebuildRepo`, and `writeEntry` onto it is refused after `lstat`. A stub git that fails makes `logError` receive the scope, the path and a message of at most 300 characters. Also list AC-13 in the Verification section.
- R-2 · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:78 · The slug fallbacks are asserted only by the plan (plan.md:7). A title that slugifies to nothing gives `entry`, and `con` gives `con-entry`. The spec says only that the slug is "derived from the title". It does not say what a title yielding an empty or reserved slug becomes, or how a 100-letter slug is cut. Plan.md:7 expects a cut at 80 on a hyphen. State these rules in the spec so AC-1's "slugify and the slug rule behave as specified" can be checked against the spec and not against the test author's choice.
- R-3 · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:239 · AC-4 says "a git failure after the rename leaves the file as it was", but it does not say whether the index row and the repository's head also stay unchanged. Spec.md:122 and plan.md:31 imply that both are unchanged. Add "and the row and head are unchanged" to AC-4 so the test has one fixed assertion. Also say whether a new entry's file is removed in that case (spec.md:122 says it is).

## Notes
- Phases A to F are sound for AC-1 to AC-10 and use red and green runs on named files and cases.
  - AC-1, AC-3 and AC-4 to AC-7 map to task pairs 1-2, 3-4, 13-15 and 16-17.
  - AC-8 and AC-9 are in tasks 5 and 7, including the PATH-less git, the live and dead lease owners, and the timeout via a stub.
  - AC-10 is in task 18.
- AC-2's isolation claim (global hooksPath, gpgsign, a parent git repository) has an executable test at plan.md:19. Plan.md:3 sets a throwaway `HOME` for tests that need git.
- AC-3's cases cover the archived rows 1 to 5, a recorded version 7, `openExisting` and concurrent opens (plan.md:12). The `user_version` 7 claim is observable.
- AC-11 is preserved with `crew tdd before` and `crew tdd after` on both snapshot files (plan.md:44). Journey 8 is covered.
- AC-12 is observed, with the reason "a document, no red run" (plan.md:45). The spec names its contents explicitly, so a stranger can check it.
- D-1 to D-11 are all reflected in the spec, each with a rejected alternative. No decision contradicts ADR 0019 (module-owned migrations are its ruling F2) or ADR 0020. Spec.md:194 and spec.md:231 record why migration 6 starts above the withdrawn module's versions 1 to 5.
