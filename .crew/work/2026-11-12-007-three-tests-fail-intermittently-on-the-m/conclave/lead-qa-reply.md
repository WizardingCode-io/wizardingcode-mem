# qa lead's validation of 2026-11-12-007-three-tests-fail-intermittently-on-the-m: spec
verdict: validated
## Returns
none
## Notes
- My second R-1 is answered. spec.md:13-14 now sorts what the maintenance call throws by the classes the code has:
  - A `KnowledgeError` is not the commit's, and that includes the store's lost lease, raised as `locked` before git starts (src/modules/knowledge/repo.ts:1396-1397; pinned by tests/unit/knowledge-repo.test.ts:764 and :820).
  - Any other error goes on, and the mirror's `MirrorLeaseLostError` is one (src/team/mirror.ts:99, :394-396). `inRepo` already lets it through unwrapped (mirror.ts:231).
- AC-12 (spec.md:38) covers both hosts and is provable with seams that exist: `store.renew` replaced in a test (tests/unit/knowledge-index.test.ts:303-327) and the clock-driven theft at tests/integration/team-mirror.test.ts:579-597.
- The call sites are now seven and named (spec.md:12), matching the tree: repo.ts:761 and :1152, store.ts:1099, mirror.ts:159, :245, :278, :289. The single `"commit"` argument is at repo.ts:938.
- AC-13 (spec.md:39) takes my preference and is observable: with `gc.auto=1` passed by the host through `extraConfig` (repo.ts:473) and two loose objects in the folder git samples, the loose objects are in a pack when `commitPaths` returns. spec.md:24 now says the hand measurement was made with the three settings and `gc.auto=1`. Red today: no maintenance call follows a commit (repo.ts:929-943).
- AC-6 and AC-7 (spec.md:35-36) hold as validated before: a positive in git's own trace, through the stub's `traceTo`, with `gitEnv` not widened (spec.md:22) and no version skip (spec.md:44).
- AC-8 (spec.md:37): the failing half is provable with the stub's `fail: "maintenance"` (tests/helpers/stub-git.ts:52-65). The timeout half needs a stall on one subcommand, since `sleepMs` stalls every call (stub-git.ts:38). The coordinator says this goes to the build; the plan must carry it as a task of the stub.
- AC-9 and AC-10 (spec.md:40-41) are checkable by a test: `git config --get maintenance.auto` through `realGit`, and strings in `CLAUDE.md` and docs/adr/0024-knowledge-module.md, with the known limit's words kept at ADR line 193.
- AC-11 (spec.md:42) survives the extra call per commit: the renewal count at tests/integration/team-mirror.test.ts:573 is computed from the recorded calls. For the plan: tests/unit/knowledge-index.test.ts:303-349 and the "fourth read" at team-mirror.test.ts:584 count renewals and should be run early.
- One thing AC-12 does not show for the mirror: a lease lost at the maintenance call stops the run after a commit that landed and before the run records the revision. The spec holds this as "as at any other git call", and the same state exists today when the lease is lost at the next call after a commit. I accept it as a criterion; the delivery should show that the next run does not commit that revision twice.
- Advisory, on record: O-1 (a killed maintenance leaves `maintenance.lock` and its children running; spec.md:48, out of scope at spec.md:62) and O-2 (the three failures end only on the runner; spec.md:55, runs cited by number in the delivery).

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
