# security findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: review-security
read: 6 files, risk areas: infra, public-api

## Findings
- F-1 · defect · src/update/report.ts:30 · `stagedFacts` runs `<data dir>/bin/wizardingcode-mem --version` for every `status`, `doctor` and `update`, from any copy (compiled or not), with none of the guards `decide` (src/update/reconcile.ts:885) applies: not "effective user is root", not "`<data dir>/bin` belongs to another user". So a process with only the user's rights can plant a file at `<data dir>/bin/wizardingcode-mem`. It then runs as root when the person runs `sudo -E wizardingcode-mem doctor`, `status` or `update`, or runs them from a root shell whose `WIZARDINGCODE_HOME`/`WIZARDINGCODE_MEM_DATA_DIR` points at the user's data directory. That breaks infra's "what runs under which identity". It also contradicts the spec's own limit at spec.md:141 ("…by the user who owns `<data dir>/bin` runs the staged file's `--version`"). Fix: apply the same root/owner refusal before `stagedVersion` in `stagedFacts`, and report the staged version as unread when refused.
- F-2 · advisory · src/update/check.ts:740 · Request and answer handling look sound. The URL is fixed from the `REPOSITORY` constant and redirects are not followed. The only header is a User-Agent with no version. Only a `Location` equal to the prefix plus a five-digit-capped `a.b.c` is kept. `readState` (src/update/state.ts:1166) re-checks every field against `isPlainVersion`/`REASON` before any text reaches a terminal. Nothing to fix; recorded so the judge knows the boundary question was answered for the network and the state file.
- F-3 · advisory · src/cli/commands/status.ts:349 · Public-api change for scripted callers. `status --json` gains an `update` object, which includes `stagedPath`, an absolute home path. On a store error it now writes a JSON object `{version, update, error}` to stdout with exit 1, where before stdout was empty. The text output also gains one or two leading `update:` lines. The change is additive and documented in ADR 0030 and the README, but no versioned JSON contract says it. A consumer that took "stdout non-empty" to mean success would now misread a failure.

## Outside the change
- src/install/binary.ts:52 · `stageBinary` already ran the staged file's `--version` with no root or owner check, so `sudo -E wizardingcode-mem install` had the same exposure as F-1 before this diff (debt, advisory).

## Not answerable
- none
