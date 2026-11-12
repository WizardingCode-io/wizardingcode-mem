# architecture findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: review-architecture
read: the rubric; the base: CLAUDE.md (its "Where things are" and Releasing line), docs/adr/0029-release-distribution.md (Decision, Alternatives, Limits) and the runbook paragraph in the diff; the spec (Design 1-4, Alternatives, AC-6 to AC-22); review/diff.patch and review/files.txt (10 files); scripts/release/push.ts in full; the timeout-minutes lines in .github/workflows/release.yml and distribute.yml

## Findings
none

The change follows the base and the Design at each point:
- Layers and boundaries (Q1, Q5): `encodedCredential` and `redact` are in `scripts/release/push.ts`, the only file that builds a form of the token derived from it, as Design 1 says. `gitEnv` now builds its header from `encodedCredential` (push.ts:56), so the header and the redaction name the same value, and its output does not change. The redaction wraps the runner once inside `commitAndPush` (push.ts:94-98). Every git call there goes through `exec`, including `ls-remote`, the `must`/`git` helpers, `pull --rebase`, `rebase --abort` and both pushes, so every failure sentence and every dry-run line is built from redacted text. `lib.ts` stays the home of the shared `run`/`Runner`, as CLAUDE.md declares. Nothing is moved into or out of `lib.ts`.
- Contracts (Q3): `PushOptions`, `Outcome` and the summary lines do not change. The only additions to the module's surface are the exports `editTap`, `editMarketplace`, `encodedCredential` and `redact`. Design 2 names the first two, and the tests use the other two. No consumer outside the tests is affected.
- Integrations (Q4): the command now passes `REMOTES[target]` and `https://github.com/<GITHUB_REPOSITORY>.git` only (push.ts:237-238), and the `PUSH_REMOTE`/`PUSH_ORIGIN`/`onRunner` reads are gone. This matches Design 2 and the new ADR 0029 Limits line. No new external call is added, and git is still reached only through the project's runner.
- Workflow shape: `timeout-minutes: 5` is on `release.yml`'s `distribute` job only (Alternatives rejects the other jobs), and the job's shape is held in `tests/unit/deploy-files.test.ts`, as the Releasing line says.
- Documents (Q5): the ADR's token paragraph and its new Limits line, the Releasing line of CLAUDE.md, the runbook paragraph under "Repeating a target" and the findings rows all match Design 3 and 4. The findings row's "the job's 15 minutes" matches distribute.yml's `timeout-minutes: 15`. Nothing outside the Design is built. The test moves (writes through `commitAndPush` in release-push.test.ts, stub-git wiring in release-commands.test.ts) are where Design 2 places them.

## Outside the change
none

## Not answerable
- Q2 (data model) · this change touches no data model, schema or stored format, as the prompt and the spec ("No stored data or format moves") say.
