# code-quality findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: review-code-quality
read: 10 files, 22 hunks

## Findings
- F-1 · advisory · tests/unit/release-docs.test.ts:10 · `parseYaml` is copied word for word from `tests/unit/deploy-files.test.ts:10`, where one shared test helper would do. This is question 2, but only for boilerplate, so it is advisory.
- F-2 · advisory · tests/integration/release-push.test.ts:397 · The fake checksums file (`REQUIRED_ASSETS` minus `checksums.txt`, mapped to `repeat(64)` digests) duplicates the new `checksums()` helper at `tests/integration/release-commands.test.ts:412` (question 2, test fixture logic written twice).
- F-3 · advisory · tests/integration/release-commands.test.ts:381 · `gitStub`'s option `quote?: "clone"` can only ever be the one value `"clone"`, so it is really a boolean in a literal type. The name does not say that it makes the clone fail (questions 3 and 5).
- F-4 · advisory · docs/real-use/findings.md:56 · The rewritten security row drops two statements from the old row: "Actions masks the raw secret only" and "No path prints it today; a git trace or a debug re-run would". The ADR now says the opposite of the first, citing `ValueEncoders.cs`, but the row does not say that the earlier claim was corrected (question 11). It is advisory because the row is closed and the ADR carries the source.

## Outside the change
none

## Not answerable
none
