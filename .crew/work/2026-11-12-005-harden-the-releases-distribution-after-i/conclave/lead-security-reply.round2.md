# security lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- R-1 is closed: `spec.md:25` now points the non-goal at AC-14, `spec.md:74` (Design 4) names the open row (the token's git not isolated from global and system configuration, `GIT_CONFIG_GLOBAL`; no time limit on `push.ts`'s git calls), and `spec.md:95` (AC-14) holds it by a test in `tests/unit/release-docs.test.ts` (`spec.md:100`). `conclave.md:22-23` no longer claims a record that does not exist.
- R-2 is closed: `spec.md:57` says the overwrite covers the calls that carry the token (clone, push, `pull --rebase`), only with a token set, and that every other call, the `ls-remote` of this repository included, runs with the environment as inherited. That matches `scripts/release/push.ts:38, 82-89, 99-100, 108, 124, 140, 147`. `conclave.md:9` says the same.
- The redaction is complete as specified: the wrapper sits on `options.runner ?? run` and passes the environment through (`spec.md:48`), `redact` replaces by literal string (`spec.md:46`), and AC-9 (`spec.md:89`) names the five failure sentences and the dry-run lines, with the complement (byte for byte without the value, nothing replaced with no token).
- The mask is right as specified: `process.stdout.write`, never `summary()`, before `need("VERSION")` (`spec.md:49`); AC-10 (`spec.md:90`) holds the first line, the single occurrence on standard output and its absence from standard error and the summary file; AC-16 (`spec.md:97`) holds the three cases where no line is printed.
- `spec.md:59` is exact about what deleting `PUSH_REMOTE` and `PUSH_ORIGIN` buys: no named knob, not a boundary, and whoever controls the step's environment already holds the raw token.
- Advisory for the build: AC-14's text (`spec.md:95`) does not name the advisory that calls without the header still inherit `MARKETPLACE_TOKEN`; Design 4 (`spec.md:74`) does. The row should carry it, and the test in `tests/unit/release-docs.test.ts` may as well hold the variable's name there.
- Advisory for the build: AC-9's test should use a token whose encoding contains `+` or `/`, so the literal replacement of `spec.md:46` is exercised and not only stated.
- Still seen only in a real run, and stated at `spec.md:106`: that the runner honours `::add-mask::` and does not echo it under step debug. The redaction does not depend on either.
- I could not read `crew criteria` output or the decision register; the criteria were validated as printed in `spec.md:87-100`.
