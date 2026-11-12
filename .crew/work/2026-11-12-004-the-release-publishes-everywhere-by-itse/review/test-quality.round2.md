# test-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-test-quality
read: 10 test files, 21 criteria

## Findings
- F-1 · defect · .crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md:265 · AC-75 (observed): the reason ("no test can fail first") is false for the citation half. The repository already holds documents to their pointers with a test that can fail (tests/unit/team-runbook.test.ts:108, "the documents that point at it do"). One more line there, `expect(runbook).toContain("docs/runbooks/release.md")`, would have failed before the edit. Only "latest moves last and may be held" is prose that a person has to read.
- F-2 · defect · .crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md:267 · AC-77 (observed): the reason is false for the naming part. The same pattern (team-runbook.test.ts:110 already asserts `CLAUDE.md` contains the team runbook's path) could have failed first on `CLAUDE.md` lacking `distribute.yml`, `scripts/release/`, `docs/runbooks/release.md`, `0029-release-distribution` and `install --force`. All of these are literal names, so checking for them needs no reading.
- F-3 · advisory · tests/integration/release-commands.test.ts:97 · AC-65 ("a v99.0.0 on a branch commit … changes no decision"): no test puts a version tag on a commit outside main. The `git` stand-in only answers the exact argv `tag --merged origin/main --list v*`. Reverting the filter would be caught, but only because the test is tied to that exact argv (Q5), not by what a caller sees. The unit test at tests/unit/release-lib.test.ts:438 uses `v99`, which is not a version tag, rather than `v99.0.0`. A real-git case like tests/integration/release-push.test.ts would prove it.
- F-4 · advisory · tests/integration/release-push.test.ts:228 · AC-72: the claim that the token never goes to `ls-remote` is checked by a loop over `holds("ls-remote")`. Nothing asserts that list is non-empty, so the check passes without checking anything if the read of the judged tag stops using `ls-remote`. The neighbouring loop for clone and push (line 224) does have that guard.

## Outside the change
- none

## Not answerable
- Mutation (Q7) · no mutation report was named in the prompt.
