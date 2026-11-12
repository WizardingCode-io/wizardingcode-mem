# code-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-code-quality
read: 41 files (through the diff; src/cli/commands/install.ts and the tests' callers of the new exports beyond it), about 50 hunks

## Findings
- F-1 · advisory · scripts/install.sh:95 · Two units now read "the version a staged binary answers", and they apply different rules (question 6). `version_of` takes the first line of `--version` and ignores the exit code (`|| true`). `stagedVersion` in src/install/binary.ts:17-18 needs exit code 0 and the whole trimmed output to be a version. So a binary that prints a second line, or exits non-zero after printing a version, is kept by the curl script but replaced by `install`. Give both writers the same rule.
- F-2 · advisory · scripts/release/push.ts:219 · `PUSH_REMOTE` and `PUSH_ORIGIN` are test-only overrides read by the production command, and they are switched off by checking `GITHUB_ACTIONS` (questions 5 and 9). It works today, but the guard on where the token's writer may go now depends on an environment flag. The test could reach `commitAndPush` directly with `remote` and `origin`, as release-push.test.ts already does for the runner.

## Outside the change
- .github/workflows/release.yml:253 · `actions/checkout@v7` and the other actions in this file still use moving tags, and their checkouts keep credentials under the workflow's `contents: write`. The diff only added `fetch-depth` next to this. This is already deferred in docs/real-use/findings.md.
- src/store/meta.ts:158 · Orders versions with `Bun.semver.order` directly, not through `src/util/version.ts`. Already deferred.

## Not answerable
- none

Also checked:
- The byte-for-byte copies of `older()` (shell ×5, JS ×3) are what AC-58 asks for and are held by tests/unit/version-order.test.ts, so they are not counted as duplication.
- Every new export in scripts/release/lib.ts and push.ts has an importer (the command files or tests/unit/release-lib.test.ts / tests/integration/release-push.test.ts). The `runner` option of `commitAndPush` is passed by release-push.test.ts.
- Not repeated here, because the author already deferred them in docs/real-use/findings.md (2026-11-12, release distribution):
  - `passingFacts`' coupling to the refusal order
  - `resolveBinary` also staging
  - the inline `bun -e` npm check
  - `node-version: 24`
  - the hand-typed summary lines in release-docs.test.ts
