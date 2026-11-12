# Conclave: the gap round

Checklists read: `sync` (the workflow writes to three third parties: npm, the tap, the marketplace) and `auth` (a token and an OIDC permission that grant writes).

## Assumed by good practice

- For each target exactly one side is the truth: this repository's tag and its release. The tap's formula and the plugin's entry in the marketplace follow it; a value the workflow wrote and reads back is not new information ("already at X" is success). The one exception is stated: a marketplace entry at a higher version, set by a person, is left alone and reported (AC-24).
- Runs are idempotent, and the first full run is limited and manual: `dry_run: true` writes nothing (the spec's Risks; the runbook, AC-32).
- A line per record changed: each commit in the other repositories is `wizardingcode-mem <version>`, and each target writes its outcome to the run's summary.
- The token is never in a URL or a log: it is an environment secret passed through `env:`, used by `git` through a credential helper header and by `fetch` in `token.ts`; no script echoes it (AC-37 holds the absence of input interpolation; the security review reads the scripts).
- The permission check lives in one place, the environment `release` with its `main`-only rule, and is not only in a script: `plan`'s refusal of another ref is the second, earlier check (AC-36, AC-37).
- The default is deny: top-level `permissions: {}`, each job naming what it needs (AC-37).
- An expiring credential is announced before it expires (AC-28, AC-31).

## Decisions only the user can make

- D-1, the workflow's shape: answered on 2026-11-12, the separate `distribute.yml` under the environment `release`.
- D-2, where the contract rule lives and what it tests: answered on 2026-11-12, in this piece, corrected, with a dispatch input that releases the hold.
- Who holds the new permission: the author alone creates the environment, the token and the two trusted publishers (carried from D-3, D-4 and D-9 of `2026-11-11-004`). Nothing is granted to anyone else by default.
- What the first full run covers: the first release that carries this item, after a dry run. npm is not metered. Versions before it are never published (the spec's Non-Goals), which follows from the forward-only goal and needed no new answer.

No decision is open.

## Proposals

- A weekly scheduled check of the token, beyond the warning on a release run D-9 asked for. Taken into the spec (AC-31): a warning that only fires on a release run is silent in a quiet month.
- `install --force` as the person's way back. Taken (AC-20, AC-21, AC-22).
- A `doctor` line that names the staged binary's version beside the running one. Not taken here: piece 2 owns what a person sees about versions.

## Warnings

- The expiry header `github-authentication-token-expiration` is documented only in a 2021 changelog that predates fine-grained tokens; whether a fine-grained token returns it is not settled by the documentation (read on 2026-11-12). The design answers it: no header is "expiry unknown" and a pass, said in the summary; the runbook tells the author to note the token's expiry date when creating it. Filed as an advisory objection.
- What the environment's branch rule does to a job from another branch (fails or skips) is not stated in the documentation; either way the job does not run, and `plan` fails first. Advisory.
- `npm view` for a version that does not exist was tried on 2026-11-12 with npm 11.19.0: exit 1 with `E404`; for an existing version, the version and exit 0. The npm decision (AC-27) reads both shapes the spec names.

## The leads' validation, round 1

All four leads returned the spec on 2026-11-12 (19 returns; `conclave/lead-*.md`). What changed in `spec.md`:

- A tag whose commit is not on `main` is refused, and `npm publish` runs with `--ignore-scripts` (security R-1, architects R-1): AC-36, J-8.
- The door's preconditions are stated, and `plan` and `token.yml`'s `door` read the environment's rule through the API, so no workflow creates the environment without its rule (security R-2, architects R-2, devops R-1): AC-36, AC-31, the runbook's order in AC-32.
- How the token reaches git, checkouts without persisted credentials, actions pinned by commit, no `${{` in any `run:` (security R-3, R-4, R-5): AC-33, AC-38.
- The first release's order makes the dry run come first (devops R-2): "The first release", AC-32.
- `plan` writes the lines of skipped and held targets, and every summary text has one source (devops R-3, qa R-5): AC-35.
- The weekly check's pass before the setup is the `door` job, not a second behaviour of `token.ts` (devops R-4, qa R-6): AC-31.
- Runners and tools named (devops R-5): AC-37.
- The missing cases: a tag that does not exist, a release that is missing or a draft (qa R-1); the unreadable previous read and `release_hold` (qa R-2); the version mismatch, `--dry-run` (qa R-3); the writer to another repository as `scripts/release/push.ts` with its criterion (qa R-4): AC-36, AC-26, AC-27, AC-38.
- The citation corrected to `tests/integration/plugin-script.test.ts:103-114` (qa R-7).
- From the notes: the highest-tag rule split so a fix release stays distributable after a later pre-release tag; `OLDER_JS` without `export`; the non-version output case in AC-20; the parser compared with the exported constants; "expiry unknown" as a warning.

## The leads' validation, round 2

QA, architects and devops validated on 2026-11-12. Security returned once more (`conclave/lead-security-reply.md`, R-1): a tag can be moved after `plan` judged it, so the `npm` job must check out the commit `plan` judged, not the tag by name. Changed in `spec.md`: `plan` gives the output `sha`; `npm` checks out that commit; `push.ts` refuses, before any write, when the tag no longer names it (AC-36, AC-37, AC-38). The engine renumbered the three changed criteria: AC-25 is AC-36, AC-30 is AC-37, AC-34 is AC-38.
