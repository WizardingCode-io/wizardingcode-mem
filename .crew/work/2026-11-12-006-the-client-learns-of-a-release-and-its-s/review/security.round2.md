

## Clarifications
- # security findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
  reviewer: review-security
  read: 9 files, risk areas: infra, public-api
  
  ## Findings
  - F-1 · advisory · src/update/report.ts:55 · Round 1's defect is closed. `stagedFacts` now asks `mayRunStaged` before `stagedVersion`, and that is the same predicate `decide` uses (src/update/reconcile.ts:32). So `status`, `doctor` and `update` no longer run the staged file as root, or from a `bin` folder owned by another user, whether through `sudo -E`, a root shell, or a `WIZARDINGCODE_HOME` pointing at another user's data directory. In that case the version is left unread and line 2 says why (src/update/report.ts:119). Windows is allowed by design: there are no user ids to compare.
  - F-2 · advisory · src/update/check.ts:740 · Unchanged from round 1 and still sound. The URL is fixed and redirects are not followed. Only a `Location` equal to the release-tag prefix followed by a plain `a.b.c` version is kept. `readState` re-checks every field before any text reaches a terminal.
  - F-3 · advisory · src/cli/commands/status.ts:44 · Public-api change for scripted callers, as in round 1; findings.md now records it as deferred. `status --json` gains `update`, which includes `stagedPath` and now `refused`. On a store error, stdout carries `{version, update, error}` with exit 1, where before it was empty.
  
  ## Outside the change
  - src/install/binary.ts:52 · `stageBinary` still runs the staged file's `--version` with no root or owner check, so `sudo -E wizardingcode-mem install` keeps the exposure F-1 closed for the other commands. It is earlier debt, now recorded as deferred in docs/real-use/findings.md (advisory).
  
  ## Not answerable
  - none
