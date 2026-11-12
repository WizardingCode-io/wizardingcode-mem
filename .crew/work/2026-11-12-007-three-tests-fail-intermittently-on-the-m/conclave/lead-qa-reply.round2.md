# qa lead's validation of 2026-11-12-007-three-tests-fail-intermittently-on-the-m: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/spec.md:12 · The rule for the maintenance call's errors contradicts the code for the store, and no criterion covers the case it names. The line says a `KnowledgeError` is swallowed and "only an error that is not a `KnowledgeError` (a lease lost in `host.renew`) goes on to the caller". Read from the code, not run:
  - In the store, a lost lease in `host.renew` is a `KnowledgeError` with code `locked` (src/modules/knowledge/repo.ts:1396-1397). Two tests pin it through `codeOf`, which reads `KnowledgeError.code`: tests/unit/knowledge-repo.test.ts:764 and :820.
  - Only the mirror's is another class: `MirrorLeaseLostError` (src/team/mirror.ts:99, thrown at :394-396).
  - So the sentence gives two opposite readings for a store write whose lease is lost at the maintenance call. By the class rule it is swallowed and the write returns. By the parenthesis it propagates, and then `commitChange` (repo.ts:1129, with `commitPaths` at :1152 inside its undo frame) undoes a commit that landed. That is the defect spec.md:14 says this design removes.

  What must change:
  - spec.md:12 states the outcome per host, in the classes the code has. For the store, a `locked` raised by the maintenance call's renewal must not reach `commitChange`'s undo. For the mirror, `MirrorLeaseLostError` goes on and aborts the run.
  - AC-8 (spec.md:35), or a criterion beside it, covers the case: a store write whose lease is lost at the maintenance call leaves the entry written and committed and the tree equal to HEAD; a mirror run whose lease is lost there stops as it does today. Both are provable with seams that exist: `store.renew` replaced in a test (tests/unit/knowledge-index.test.ts:303-327) and the clock-driven theft at tests/integration/team-mirror.test.ts:579-597.

## Notes
- My earlier R-1 is answered. AC-6 and AC-7 (spec.md:33-34) assert a positive: the runner's own `git maintenance run --auto --quiet` after each commit, with a trace lacking it failing. The seam is named (`traceTo` on the stub, `gitEnv` not widened, spec.md:20). spec.md:40 gives the reason no version skip is needed: the command is the runner's own, on every git from 2.32.
- The red is observable for AC-6 and AC-7: today no call carries the three settings (src/modules/knowledge/repo.ts:415-433), and the trace of a commit shows `--detach` (probes/runner-removal.md:39-41).
- "`commitPaths`, the one function that commits" holds: the only `"commit"` argument under `src/modules/knowledge`, `src/team` and `src/sync` is repo.ts:938. The count does not: I find seven call sites, not eight (repo.ts:761 and :1152, store.ts:1099, mirror.ts:159, :245, :278, :289); the eighth occurrence is the definition at repo.ts:929. Correct the number at spec.md:12, or name the eighth.
- AC-8's failing half is provable today: the stub's `fail: "maintenance"` works because its subcommand lookup skips `-c` values (tests/helpers/stub-git.ts:52-65). Its timeout half is not: `sleepMs` sleeps on every call (stub-git.ts:38), so the commit would time out first. The plan needs a stall on one subcommand in the stub, with a host timeout wide enough that the other calls do not flake under load.
- AC-11 survives the extra git call per commit. The renewal count at tests/integration/team-mirror.test.ts:573 is computed from the recorded calls (`1 + gitCalls + run.commits + 1`), so one more call with one more renewal keeps it equal. The stubs at team-mirror.test.ts:336, :650 and :696 and tests/unit/knowledge-repo.test.ts:553 fail the commit itself, so no maintenance call follows.
- Outside AC-11's three files, the plan should run the tests that count renewals or steal a lease at a numbered clock read: tests/unit/knowledge-index.test.ts:303-349 and the "fourth read" at team-mirror.test.ts:584. The second still aborts, but possibly at another call.
- AC-9 is observable: `git config --get maintenance.auto` through `realGit`, red today (stub-git.ts:85-102 passes no `-c`).
- AC-10 is checkable by a test on strings: the three setting names and the maintenance command in `CLAUDE.md` and docs/adr/0024-knowledge-module.md, with the known limit's words kept at ADR line 193.
- Nothing in the criteria shows that the runner's call compacts when work is due with `maintenance.auto=false` on the same call. spec.md:22 reports a hand measurement (245 loose objects repacked) but does not say whether it was made with the three settings. A preference, not a return: a test with a low `gc.auto` through `extraConfig` would prove D-1's "git keeps compacting".
- Advisory, on record: O-1 (a killed maintenance leaves `maintenance.lock` and its children running; spec.md:44) and O-2 (the three failures end only on the runner; spec.md:51, runs cited by number in the delivery).

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/conclave.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/conclave/lead-security.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/errors.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/helpers/stub-git.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/helpers/knowledge.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-repo.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-index.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/team-mirror.test.ts
