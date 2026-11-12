# qa lead's validation of 2026-11-12-007-three-tests-fail-intermittently-on-the-m: spec
verdict: validated
## Returns
none
## Notes
- A build defect to fix before the delivery (not a defect of the spec, so not a return here; I will return it at the delivery if it is still there). In /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/CLAUDE.md line 18, the new sentence was inserted in the middle of the code span `.git/config`. The text now reads "the repository's own `. No git process outlives the call that started it: … the tests' `realGit` passes `maintenance.auto=false`.git/config` (a file) as its hooks path". The original sentence about the hooks path is broken in two. The document test does not catch it: tests/unit/knowledge-maintenance.test.ts:220-225 only looks for the three setting names and the command as strings. Move the sentence after "…and no template." and consider a check that "`.git/config` (a file) as its hooks path" is still intact.
- The changed rule is coherent with the code. spec.md:12-15 says nothing the maintenance call throws changes what the caller does next. `maintain` (src/modules/knowledge/repo.ts:962-980) returns on a `KnowledgeError` (logged by `runGit`, or the store's `locked` raised before git starts) and logs anything else under the host's scope (repo.ts:978). `commitPaths` calls it after the commit with the commit's identity and committer (repo.ts:950, :971-975), as spec.md:12 says.
- The reason for the change is on record in the spec (spec.md:17): letting `MirrorLeaseLostError` through parted a landed commit from the record of its revision, and the next run failed on an empty commit every time. This is the case my last note asked the delivery to show.
- AC-12 (spec.md:41) is observable clause by clause, and a test names each. I read the tests; I did not run them.
  - Store: tests/unit/knowledge-maintenance.test.ts:125-151. The write returns `written`, the entry is committed, the tree is clean, and the last recorded git call is still the commit.
  - Mirror: tests/integration/team-mirror-maintenance.test.ts:97-141. No call is recorded after the theft (:131-132), the landed revision is counted (:127), the run reports a lease error (:128), and the next run commits one revision with no error and a clean tree (:136-140).
- The other criteria each have a named test in tests/unit/knowledge-maintenance.test.ts:
  - AC-6 at :59-84: commit and maintenance strictly alternating in git's trace, which fails on an empty trace; no `--detach`.
  - AC-8 at :88-123: the stub's `fail: "maintenance"` and a stall on one subcommand (`stallOn`, 6 s against a 2 s timeout).
  - AC-13 at :183-205: three loose objects in `objects/17`, `gc.auto=1` from the host, a pack present and the folder empty after `commitPaths`.
  - AC-9 at :208-212.
  - AC-10 at :214-238.
  - AC-7 is in tests/integration/team-mirror-maintenance.test.ts:66-95.
- The error of another kind is covered at tests/unit/knowledge-maintenance.test.ts:153-170: a `RangeError` at the maintenance call's renewal, the commit kept, the log line under `knowledge.test`.
- Not covered by a criterion or a test: spec.md:14's "a run with no git call left ends". A lease lost at the last maintenance call of a mirror run lets the run finish and write its record without the lease. The same was true before the change, since the lease is only checked at git calls (src/team/mirror.ts:394-396), so I do not return it. The delivery report should list it as left.
- The timeout test costs about 2 s of wall time and leaves the stub's sleeping child behind for up to 6 s (knowledge-maintenance.test.ts:107-123). That is acceptable, but under the load that already fails the perf tests on the runner, a 2 s host timeout applies to every git call of that write, not only the maintenance. If that test flakes on `check (macos-latest)`, widen the timeout rather than retry.
- Advisory, on record: O-1 (spec.md:51, out of scope at :65) and O-2 (spec.md:58, the runner's runs cited by number in the delivery).

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/team/mirror.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-maintenance.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/team-mirror-maintenance.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/CLAUDE.md
