# risk findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-risk
read: spec, plan, 5 files

## Findings
- F-1 · advisory · src/sharing/policy.ts:316 · The new throw in `levelRefusal` cannot be reached today: the loader builds every `levels` entry through `effectiveLevel` (policy.ts:178), which never returns `local` with `allowed`, and `levelOf` gives `level-local` when there is no row. If a later change broke that rule, though, nothing would catch the error between `decide` and `wouldLeave` and the caller. `status`'s `sharingStatus` (src/status/report.ts:245-251, called unguarded at line 335) would then fail the whole `status` command, not only its sharing line, and `share status` and `GET /api/sharing` would fail too. The failure is loud and names the project and the destination, so it would be seen in the first hour and it is not a defect. Parts 5 and 6 should still decide, before they call `decide` on a sync path, whether one broken row stops the whole run or only that item (the ADR could say so).

## Outside the change
- none (the restored store's journal mode in probes/restore-journal-mode.md was already made its own item by the first round's judge)

## Not answerable
- none

Rubric questions answered from the spec and the diff:
- First hour: no hook reads the policy. Every default is `local`, so an upgraded store behaves as before. A loader failure closes the policy and is logged (policy.ts:280-283). The loader's latency is measured in probes/loader-latency.md.
- Rollback: the `sharing` migration has no down path, and the spec gives the reason at spec.md:360. 0.6.0 opens `user_version` 7, ignores the `sharing_*` tables and the new `module_migrations` row, and `renderEnvFile` keeps the two keys.
- Irreversible writes: none in this round. A restore resetting levels is intended, and the CLI and viewer report it (spec.md:350).
- Third parties: nothing opens the network in this part. Every finding falls in this item's paths; none falls in the sibling item's (2026-11-09-001) paths.

Files read (absolute):
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/policy.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/levels.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/status/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/criteria-round-five.md

The diff and plan.md were not opened: the round's change (one throw, two doc comments) was read in the source instead.
