# code-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-code-quality
read: 5 files, 267 hunks in the diff (I read the round-five change, src/sharing/policy.ts, src/sharing/levels.ts and src/sharing/report.ts, in full. I checked the other hunks only for whether round three's open findings are still there.)

## Findings
- F-1 · advisory · src/sharing/policy.ts:315 · `levelRefusal` now throws when a row reads `local` with reason `allowed`. No production path makes that pair: `effectiveLevel` never returns it and `withLevel` deletes a local row. Only the test "a local row that claims allowed is a broken rule" (tests/unit/sharing-policy.test.ts:687) builds it, by hand through `policyWith`. So this is a guard for a case the code cannot reach (question 9). It is not a defect, because it makes the broken rule visible instead of hiding it. The type could carry the rule instead (a level row whose reason is `allowed` only when its level is above `local`). That would remove the arm, and the throw from `decide`, which its doc calls pure and whose callers (`wouldLeave` in report.ts:459, `share explain` in share.ts:288) do not expect it to throw.
- F-2 · advisory · src/sharing/policy.ts:338 · `item.scope === "shared" ? "shared" : "workspace"` repeats `rootOf` in src/sharing/report.ts:159, which is the same rule ("the workspace's areas govern the workspace and every project"). The rule is written twice (question 2, a one-line duplicate).
- F-3 · advisory · src/settings/settings.ts:201 · Still open from round three (F-4). Nothing reads the `fileList` and `ignored` fields of `EffectiveShareList`, and `fileListsOf` (src/sharing/store.ts:414) parses the env file's lists a second time (questions 2 and 8).
- F-4 · advisory · src/sharing/store.ts:25 · Still open from round three (F-5). Only tests import the re-export of `GENERATION_KEY` and `newGeneration`, and `REBIND` (store.ts:96) is exported but used only inside its own file (question 8).
- F-5 · advisory · src/sharing/levels.ts:117 · Still open from round three (F-6). `policyWith`, which its own doc says is "for tests", is exported from a production module and only tests import it (question 8).
- F-6 · advisory · src/cli/commands/share.ts:153 · Still open from round three (F-7). The two sharing key names are declared again here (`LIST_KEYS`), in src/status/report.ts:228 (`SHARING_LISTS`), in src/sharing/patch.ts and in ui/src/components/settings/Sharing.vue, while settings.ts already exports `SHARING_KEYS` (question 2, boilerplate).
- F-7 · advisory · src/ui/api.ts (`listProjects`) · Still open from round three (F-8). It runs the same `remote:%` alias query with the same `isHostLedAlias` filter as `entryAliases` in src/sharing/report.ts (question 2).
- F-8 · advisory · src/backup/backup.ts:176 · Still open from round three (F-10). `options.dataDir ?? resolvePaths().dataDir` is a fallback that only older tests use; both production callers pass `dataDir` (question 9).

The fourth round's fix itself checks out. `levelRefusal` passes on every reason other than `allowed` exactly as `effectiveLevel` named it, and the test at sharing-policy.test.ts:676 covers `level-local`, `disabled` and `unbound-alias`. The `DESTINATIONS` doc comment now sits directly above its declaration (levels.ts:9-14). The orphan comment is gone from report.ts (the "Previews" section, lines 100-102, has no stray comment). The `LEVEL_PROBLEMS` comment at policy.ts:108 matches `levelsOf`, which skips rows stored at `local`. None of round three's findings that the fix addressed (F-1, F-2, F-3) recur.

## Outside the change
- src/modules/knowledge/, src/judge/, src/mcp/, src/engine/compose.ts, src/engine/module.ts, src/engine/modules.ts, the knowledge parts of src/status/report.ts and src/doctor/checks.ts, and the knowledge text of CLAUDE.md, README.md, ADR 0019 and ADR 0024 · These belong to the sibling item 2026-11-09-001 and are not reviewed here.

## Not answerable
- Question 11, for docs/adr/0025-sharing-policy.md · The ADR is a new file, so the base has no earlier text to check the rewrite against. I did not re-read its prose this round.
- Question 7 · I was not given review/inputs.json (the gate's `dependencies` list), and I did not examine any package.json hunk.

All paths are under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/. The diff is .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/review/diff.patch, and round three's findings are in review/code-quality.round3.md in the same folder.
