# code-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-code-quality
read: 17 files, 41 hunks

## Findings
- F-1 · defect · src/sharing/policy.ts:313 · In `levelRefusal`, the `reason === "allowed" ? "level-local"` arm can never run. That code runs only when the level is `local`, and nothing in production produces `local` with `allowed`: `effectiveLevel` returns `allowed` only for a level above local, `withLevel` deletes a local row, and no test builds that pair either. This fails question 4 (a branch no caller reaches). Return `reason` directly.
- F-2 · advisory · src/sharing/report.ts:102 · A leftover doc comment ("The change counter an epoch was made from…") has no declaration under it, because `counterOfEpoch` moved to levels.ts. Question 10: a stale comment.
- F-3 · advisory · src/sharing/levels.ts:6 · The doc comment that explains `DESTINATIONS` sits above the `REMOTE_ALIAS` doc comment and constant, so it is attached to the wrong declaration and `DESTINATIONS` at line 14 has none. Questions 6 and 10.
- F-4 · advisory · src/settings/settings.ts:201 · Nothing reads the `fileList` and `ignored` fields of `EffectiveShareList`, and `effectiveSharing` is used only inside its own file. Meanwhile `fileListsOf` (src/sharing/store.ts:414) parses the env file's lists again, so `readPolicy` reads the file twice and `sharingStatus` a third time through `publicSettings`. Questions 2 and 8: the computed field and the second parse are the same logic.
- F-5 · advisory · src/sharing/store.ts:25 · The re-export of `GENERATION_KEY` and `newGeneration` from migrations.ts is imported only by tests/unit/sharing-store.test.ts. The same goes for the exported `REBIND` (store.ts:96), which is used only inside its own file. Question 8: unused exports.
- F-6 · advisory · src/sharing/levels.ts:117 · `policyWith`, which its own doc calls "a hand-built policy, for tests", is exported from a production module and imported only by tests. Question 8.
- F-7 · advisory · src/sharing/store.ts:42 · The two sharing key names are declared again in four more places: src/sharing/patch.ts:8, src/cli/commands/share.ts:153 (`LIST_KEYS`), src/status/report.ts `SHARING_LISTS` and ui/src/components/settings/Sharing.vue:14. settings.ts already exports `SHARING_KEYS` and the `SharingKey` type. Question 2: duplicated boilerplate.
- F-8 · advisory · src/ui/api.ts:13427 (diff line; `listProjects`) · It reads the `remote:%` aliases and filters them with `isHostLedAlias`, the same query and filter as `entryAliases` in src/sharing/report.ts:174. "Does this project have a host-led remote" is written twice. Question 2.
- F-9 · advisory · src/sharing/report.ts:576 · The variable `sent` holds the ledger's `received` records as well as the sent ones, which `decide` reads. The name says less than what it holds. Question 3.
- F-10 · advisory · src/backup/backup.ts:1306 (diff line; `RestoreOptions.dataDir`) · `dataDir` is optional and falls back to `resolvePaths().dataDir`, but both production callers (the CLI and the viewer) pass it. The fallback serves only the older tests that omit it. Question 9: a second path nobody asked for.

## Outside the change
- src/sharing/report.ts and src/status/report.ts · The `knowledgeStatus`, `formatKnowledge` and `knowledgeOn` code in src/status/report.ts belongs to the sibling item 2026-11-09-001 and was not reviewed here; the same applies to the knowledge hunks of CLAUDE.md, README.md, ADR 0019 and ADR 0024.

## Not answerable
- Question 11, for docs/adr/0025-sharing-policy.md · I read the ADR's diff region only in part. Whether the rewrite drops or alters a fact or hedge from an earlier draft cannot be judged from the diff, because the ADR is a new file and its earlier wording is not in the base.
- Question 7 · review/inputs.json (the gate's `dependencies` list) was not given. No package.json hunk was examined.

Paths:
- Diff: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/review/diff.patch
- Main files cited: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/policy.ts, src/sharing/report.ts, src/sharing/levels.ts, src/sharing/store.ts, src/settings/settings.ts, src/ui/api.ts, src/backup/backup.ts (all under the same worktree root)
