# code-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-code-quality
read: 26 files, 64 hunks

## Findings
- F-1 · advisory · src/sharing/levels.ts:7 · The doc comment for `DESTINATIONS` ("The destinations there are: the team's server, alone…") is now separated from its declaration by the inserted `REMOTE_ALIAS` constant and its own doc comment (line 11), so the first comment sits over nothing (questions 6 and 10). Moving `REMOTE_ALIAS` above it would put each comment back on its declaration.
- F-2 · advisory · src/sharing/report.ts:102 · An orphan doc comment ("The change counter an epoch was made from: what `epochOf` puts above its hash.") has no declaration under it. The function it described moved to `levels.ts` as `counterOfEpoch`, and the comment was left behind (questions 4 and 10).
- F-3 · advisory · src/sharing/levels.ts:117 · `policyWith`, documented "A hand-built policy, for tests", is exported from production code, but nothing in `src/` or `tests/` imports it: an unused export (question 8).
- F-4 · advisory · src/sharing/store.ts:25 · `export { GENERATION_KEY, newGeneration }` re-exports the names from `migrations.ts`, and only `tests/unit/sharing-store.test.ts` imports them through `store.ts`. It is a forwarding layer that serves a test import only (questions 5 and 8).
- F-5 · advisory · src/sharing/in-force.ts:1 · The header says `policyInForce` serves "every caller that changes sharing: the CLI, the viewer's routes", with "one sequence … so no caller records what is pending differently". Yet `setProjectSharing` (src/ui/api.ts) and `PUT /api/settings` (src/ui/server.ts) use `loadPolicy` + `sharingRefusal` without the reconcile. A level whose alias was gone is therefore logged as `rebind` from the viewer's dock, but as a `system` removal plus a new set from the CLI. ADR 0025 lists only `GET /api/sharing` and `share` as reconcilers, so the comment overclaims (questions 6 and 10). Either narrow the comment or route the two PUTs through `policyInForce`.
- F-6 · advisory · src/sharing/report.ts:576 · In `readLeaving`, the variable `sent` holds every ledger record of kind `entry` for the destination, including `received` ones and other destinations' received ones. The name says less than it holds (question 3); `ledger` (as in `leavingMemories`) would match.
- F-7 · advisory · src/status/report.ts:170 · The two sharing key strings are declared again in five places: `SHARING_LISTS` here, `LIST_KEYS` in src/cli/commands/share.ts:153, `ROOTS_KEY`/`AREAS_KEY` in src/sharing/store.ts:42, src/sharing/patch.ts:8 and ui/src/components/settings/Sharing.vue:14, beside `SHARE_ROOTS`/`SHARE_AREAS` in src/settings/settings.ts. Duplicated boilerplate (question 2). `patch.ts` gives a reason (no runtime import of settings into the viewer); the server-side copies could share one exported constant.
- F-8 · advisory · ui/src/components/settings/Backups.vue:115 · The restore toast writes `(${outcome.sharingReset} projects)` with no singular, so one reset project reads "1 projects". The CLI's same sentence (src/cli/commands/backup.ts:53) uses `plural` (question 6, a difference from its neighbour).
- F-9 · advisory · src/backup/backup.ts:98 · `RestoreOptions.dataDir` is optional and falls back to `resolvePaths().dataDir`. Both production callers (the CLI and the viewer) pass it; only tests leave it out, and they then read the process's real data directory for the baseline. This is a fallback the criteria did not ask for, kept for tests (question 9, advisory since it hides no failure).
- F-10 · advisory · docs/adr/0024-knowledge-module.md:222 · The line "The sharing policy (ADR 0025, not written yet)" is false once this item adds docs/adr/0025-sharing-policy.md, and the diff leaves it as is (question 11). The document belongs to the knowledge store's part, but this item is what makes the line stale.

## Outside the change
- none

## Not answerable
- Question 7 (a dependency the criteria did not ask for) · `review/inputs.json` was not given, and no `package.json` hunk appears in the diff, so no added dependency was seen. Without the gate run's `dependencies` list, an absence of new dependencies cannot be confirmed.
- Sibling-item scope · The diff also carries the knowledge store (2026-11-08-003) and the sibling item 2026-11-09-001 (src/modules/knowledge/, src/judge/, src/mcp/, compose/module, tool.ts, opencode plugin, knowledge and judge tests). Those hunks were not reviewed here except where sharing code calls into them (`openRepo`, `ensureFresh`, `readRegularFile`, `kindAt`, `parseTaxonomy`). F-10 is the only finding that touches one of their files.

Paths referenced (absolute):
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/levels.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/in-force.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/status/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/backup/backup.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Backups.vue
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0024-knowledge-module.md
