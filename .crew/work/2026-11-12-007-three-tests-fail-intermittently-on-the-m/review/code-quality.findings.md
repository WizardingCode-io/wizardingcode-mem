

## Clarifications
- # code-quality findings for 2026-11-12-007-three-tests-fail-intermittently-on-the-m
  reviewer: review-code-quality
  read: 6 files, 12 hunks
  
  ## Findings
  - F-1 · advisory · tests/unit/knowledge-maintenance.test.ts:505 · Question 11: the new comment says geometric repacking is the default from git 2.54. That claim has no source, and it disagrees with the spec, which measured `gc.auto=1` alone repacking on git 2.54.0 (spec.md:27). The version should be the one actually seen (2.56 on CI), or the claim marked `[source?]`.
  
  ## Outside the change
  - tests/integration/team-mirror.test.ts:522 · This older test parses the stub's `recordArgsTo` file inline here and again at line 570. `recordedCalls` in tests/helpers/stub-git.ts already does the same, and this diff did not write those lines.
  
  ## Not answerable
  none
