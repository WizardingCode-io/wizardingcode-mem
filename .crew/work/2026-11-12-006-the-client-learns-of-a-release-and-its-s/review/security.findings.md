

## Clarifications
- # security findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-security
  read: 12 files, risk areas: infra, public-api
  
  ## Findings
  - F-1 · advisory · src/update/staged.ts:58 · The move keeps the guard intact. `stagedFacts` still asks `mayRunStaged` before `stagedVersion`, and `who` defaults to `whoAmI()`, which is the real platform and effective uid. Every production caller relies on that default: `updateReport` (src/update/report.ts:142), the `status` default `build`, and `update` and `doctor` through `updateReport`. No CLI argument or environment variable can supply `who` or `build`, because `main` calls `run(rest)`. So root, or a caller whose `bin` folder belongs to another user, still never runs the staged file. `decide` reads the same predicate through `whoAmI()` (src/update/reconcile.ts:74).
  - F-2 · advisory · src/update/reconcile.ts:94 · The guard variable is now read and deleted before anything looks at the machine. A failing look therefore no longer leaves `WIZARDINGCODE_MEM_HANDED` for child processes to inherit. That closes the small gap in round 2's order; nothing else in the hand-over changed.
  - F-3 · advisory · src/cli/commands/status.ts:44 · Public-api change for scripted callers, unchanged from rounds 1 and 2 and recorded as deferred in docs/real-use/findings.md. `status --json` gains `update`, including `stagedPath` and `refused`. On a store error, stdout carries `{version, update, error}` with exit 1.
  
  ## Outside the change
  - src/install/binary.ts:52 · `stageBinary` still runs the staged file's `--version` with no root or owner check, so `sudo -E wizardingcode-mem install` keeps the exposure the change closed for the other commands. This is existing debt the diff did not introduce; it is recorded as deferred in docs/real-use/findings.md (advisory).
  
  ## Not answerable
  - none
