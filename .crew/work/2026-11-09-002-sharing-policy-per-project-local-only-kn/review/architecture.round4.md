# architecture findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-architecture
read: the rubric; the round-five criteria (AC-25 in particular); files.txt (145 files); in the worktree /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab: the diff's hunks for src/core/git.ts, src/core/project.ts, src/engine/module-schemas.ts, src/engine/module.ts, src/engine/modules.ts, src/store/db.ts and src/store/meta.ts; the current src/sharing/policy.ts (the predicate, lines 297-411), src/sharing/levels.ts (whole file) and src/sharing/report.ts (the `leaving` section); docs/adr/0025-sharing-policy.md (the predicate's contract and the "throws" passages); the spec (searched); CLAUDE.md's engine, knowledge and sharing paragraphs; and the callers of `decide` and `wouldLeave` (src/status/report.ts, src/cli/commands/share.ts, src/ui/api.ts)

## Findings
- F-1 · advisory · src/sharing/policy.ts:315 · `levelRefusal` now throws out of `decide` on a level row that reads `local` with reason `allowed`, as AC-25 requires. That is right for a pair `effectiveLevel` (levels.ts:45-63) never makes, and since `loadPolicy` builds every row through that rule, no current caller (status, `share`, `/api/sharing`) can hit it. But ADR 0025's predicate contract (docs/adr/0025-sharing-policy.md:70-76) still says `decide` always returns a ruling, and step 4 still reads "its level's reason, or `level-local`", which was the old mapping. Part 6 will build on that text, so add one sentence to the ADR: `decide` throws, naming the project and the destination, on a hand-built policy whose row reads `local` with reason `allowed`, and it never rewrites the reason to `level-local`.

## Outside the change
none

## Not answerable
none

Notes for the judge:
- Since round four (b54a579), the change stays inside the sharing layer. The throw lives in the predicate, beside the rule it guards. The `DESTINATIONS` doc comment is back above its declaration (levels.ts:9-14). The orphan comment is gone from report.ts, and `leaving` there (report.ts:451-461) reads cleanly. No boundary, table, pinned key list, route shape or integration changed.
- Nothing in the round-five delta falls in the sibling item's paths (2026-11-09-001: src/modules/knowledge/, src/judge/, src/mcp/, src/engine/compose.ts, module.ts and modules.ts, and the rest). The module.ts and modules.ts hunks I read in the diff belong to that sibling item.
- The base this item builds on is unchanged and still matches CLAUDE.md and ADRs 0019, 0020 and 0025. The sharing namespace sits in src/engine/module-schemas.ts, which imports only migration lists. `user_version` stays at 7, and `module_migrations` versions the sharing namespace apart. `src/core/project.ts` gains `remoteAliasOf` without writing anything. No hook reads the policy.
