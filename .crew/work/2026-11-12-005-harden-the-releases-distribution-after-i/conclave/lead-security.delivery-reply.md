# security lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: delivery
verdict: validated
## Returns
none
## Notes
- What was built is what I validated; I read the code and the documents, and ran nothing myself (the gates and the red-then-green records are the report's, `report.md:34-53`).
- **Redaction.** The wrapper sits on `options.runner ?? run` and passes the call's options through untouched (`scripts/release/push.ts:94-98`). `redact` is a literal `replaceAll`, unchanged with a null token (`push.ts:38-40`). The header and the redaction share `encodedCredential` (`push.ts:30-32, 56`).
- **Every site is behind the wrapper.** The tag read (`push.ts:101-110`), `must` (`push.ts:120-125`), the push, the rebase and the second push (`push.ts:143, 159, 166`) and the dry-run lines (`push.ts:136, 138`) all go through `exec`.
- **No mask line.** `::add-mask::` appears nowhere under `scripts/` or `.github/`; its only mention in code is the document test at `tests/unit/release-docs.test.ts:166`.
- **No destination from the environment.** The command passes `REMOTES[target]` and `https://github.com/<GITHUB_REPOSITORY>.git` (`push.ts:237-238`). `PUSH_REMOTE` and `PUSH_ORIGIN` are read nowhere in `scripts/`; they remain only as the test's decoys (`tests/integration/release-commands.test.ts:458`).
- **`gitEnv` is unchanged in behaviour** (`push.ts:46-58`), as the spec required.
- **Open points are recorded as deferred.** `docs/real-use/findings.md:74` names `GIT_CONFIG_GLOBAL` and a home `.gitconfig`, the missing time limit on `push.ts`'s git calls, the inherited `MARKETPLACE_TOKEN`, and that the runner's masking reaching the step summary is not established. Rows 70 and 71 cite item `2026-11-12-005` and are no longer `deferred`; rows 72 and 73 stay deferred.
- **The ADR says what I asked.** `docs/adr/0029-release-distribution.md:15` states the exact-match limit and that the runner's masking was read in `ValueEncoders.cs` on 2026-11-12 and is "not tested here". `docs/adr/0029-release-distribution.md:66` says removing the variables is not a boundary and that the token's git is not isolated.
- **My test advisory was taken.** The command test uses the token `a>?` (`release-commands.test.ts:469`) and `release-push.test.ts:433-439` picks a token whose encoding exercises the literal replacement; the five failure sites are parametrised at `release-push.test.ts:299-306`.
- **The security gate is proven with advisories only** (`report.md:61, 72-75`; `review/security.findings.md:6-11`). All four are either the stated exact-match limit or the debt recorded at `findings.md:74`; none is added by the diff.
- **Advisory, not blocking:** the rewritten `findings.md:70` no longer says that the earlier claim ("Actions masks the raw secret only") was wrong (code-quality's finding, `report.md:69`). The ADR carries the correction, so the record is not left false.
- **Advisory, not blocking:** AC-22's test checks only for the bare `::add-mask::` token in the ADR (`report.md:70`), so the sentence "read on 2026-11-12; not tested here" is held by review and not by a test. Keep it if the paragraph is edited.
- **First real release:** read the summary of a dry or failed run for `***`; the step summary is the one place where the script's redaction, not the runner, is known to be the protection.
