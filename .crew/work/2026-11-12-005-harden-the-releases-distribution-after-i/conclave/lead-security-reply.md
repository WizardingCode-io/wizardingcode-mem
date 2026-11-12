# security lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- Dropping the `::add-mask::` line is acceptable, and the design is safer without it. The script no longer prints the whole encoded credential on purpose, and the `GITHUB_ACTIONS` gate, the ordering rule and the emulator leak go with it (`spec.md:84`).
- The alignment argument holds: `x-access-token:` is 15 bytes, a multiple of 3, so the header's base64 is the 20 characters of the prefix followed by the token's own base64, padding included. A runner that masks the base64 of the secret masks that tail; the 20 characters left carry no secret.
- I could not read `actions/runner`'s `ValueEncoders.cs` from here; that the runner registers those three forms rests on the coordinator's reading of 2026-11-12, as `spec.md:108` says. Nothing in the guarantee depends on it.
- The redaction still closes what it should. The summary file is covered because every sentence `command()` appends comes from text the wrapped runner already redacted (`spec.md:50`; `scripts/release/lib.ts:66-73`). Off a runner it is the only protection and it does not depend on the environment.
- AC-9 (`spec.md:94`) holds the five failure sentences and the dry-run lines at `commitAndPush`; AC-19 (`spec.md:98`) holds standard output, standard error and the summary file at the command, on a failure and on a dry run.
- The stated limit is exact (`spec.md:52`): exact match only, the raw token is not redacted by the script, and another form of the credential needs its own redaction. AC-22 (`spec.md:101`) carries that rule into ADR 0029 and `CLAUDE.md`.
- My earlier returns stay closed: `spec.md:58` states what `gitEnv`'s overwrite covers as the code does it, and AC-21 (`spec.md:100`) still makes `docs/real-use/findings.md` name `GIT_CONFIG_GLOBAL`, the missing time limit on `push.ts`'s git calls and the inherited `MARKETPLACE_TOKEN` as open.
- Advisory for the build: AC-21 no longer tests that those three points sit in a row whose status is `deferred` (`conclave.md:55`). Design 4 (`spec.md:78`) still asks for a `deferred` row, so the build should write it that way.
- Advisory for the build: the ADR sentence AC-22 asks for should say the runner's masking was read in its source on 2026-11-12 and is not tested here, as `spec.md:108` does, so it is not later taken for a guarantee.
- Advisory for the build: AC-19's stub git should print the header with a token whose encoding contains `+` or `/`, so the literal replacement of `spec.md:49` is exercised.
- Advisory on the record: `conclave.md:7` still says the value is "registered with the runner's mask (AC-10)", `conclave.md:22-23` cite AC-18 (now AC-21), and `conclave.md:28-30` warn about a mask line that no longer exists. `conclave.md:53-55` corrects the ids but not those sentences; a stranger reading the top of the file is misled until the last section.
- First real release: the author should check the summary of a failed or dry run for the `***` (`spec.md:111`); that is the one place where the script's redaction, and not the runner, is known to be the protection.
