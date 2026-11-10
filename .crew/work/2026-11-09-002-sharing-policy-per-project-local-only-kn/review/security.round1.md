# security findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-security
read: 16 files, risk areas: personal-data, data-migration, auth

## Findings
- F-1 · advisory · src/sharing/types.ts:153 · `OutgoingEntry.frontmatter` is the entry's whole frontmatter text. It carries the `author` field, a person's name taken from `WIZARDINGCODE_MEM_AUTHOR` or else from the git name. ADR 0025 (line 134) lists the frontmatter as one opaque thing that leaves and never names the author inside it. Nothing is sent in this part, so no caller gets anything yet. But the pinned key set cannot stop a person's name from reaching the team server once part 6 sends entries. The ADR should say that the author leaves, or the payload should name the frontmatter fields that may leave.
- F-2 · advisory · src/settings/settings.ts:9895 · `validatePatch` now refuses `\r` and `\n` under every key, which closes the second-line injection the round-one probe showed (probes/newline-in-a-setting.md). Other control characters (NUL, U+2028) still pass to `writeEnvFile`. Refusing every C0 control character would be stricter than the module's own rules, which is hardening beyond the risk areas.
- F-3 · advisory · src/ui/server.ts:13110 · `GET /api/sharing` writes. `policyInForce` reconciles and logs to `sharing_changes`, and `wouldLeave` with `fresh: true` runs `ensureFresh` (git) on the workspace, the shared repository and the projects above Nothing. It is behind the same Host check and token as every route, so no new caller reaches it. A GET that writes is still a pattern a later cross-origin weakness would turn into a write path.

## Outside the change
- src/store/db.ts:12563 · `openDb` turns WAL on only when it creates a database, so every restore leaves the live store in rollback-journal mode. probes/restore-journal-mode.md shows this predates the item: the `VACUUM INTO` copy is already in DELETE mode, and the item's `PRAGMA journal_mode = DELETE` in `resetSharingInCopy` (src/backup/backup.ts) changes nothing. Debt, not this item's defect.
- ui/src/components/ProjectsView.vue:84 · the links toast ("Not changed" on a link decision) still shows `error.message` to the person. This code existed before the item; the item's own sharing toasts (lines 121 and following, and Sharing.vue lines 158 and 171) use fixed sentences.

## Not answerable
- none

Notes for the judge, all answered with no defect:
- **auth:** the three new routes and the sharing branch of `PUT /api/settings` are dispatched after the global Host check (server.ts:249) and the token check (server.ts:263–266), like every route around them. `confirm` comes from the request itself and is judged inside `setLevel` / `applySettingsPatch` under `withWrite`. The project id is `\d+`. Preview input is checked with `isLevel`, `isRoot` and `SHARE_AREA`. A closed policy refuses with 409.
- **personal-data:** `decide` fails closed: a closed policy and an unknown destination keep everything. Memories go only at `all`, and only active, non-stale, project-scoped, non-imported ones that are not user rules. Entries need their root or their project's level plus an area that is in force. Proposals are a separate table and never become candidates. The memory titles in `?list=1` go to the local, token-gated viewer, which already shows memories. Nothing is sent, and no hook reads the policy.
- **data-migration:** `0001_sharing_policy.sql` only adds tables, forward-only like the core, with no foreign key into core tables, and `user_version` stays 7. `resetLevels` runs on the unpacked copy before the swap, and the replaced store is kept as `.replaced-<time>`.
- **Sibling item:** nothing found in 2026-11-09-001's paths (src/modules/knowledge/, src/judge/, src/mcp/, the OpenCode plugin). The author setting that F-1 depends on (`WIZARDINGCODE_MEM_AUTHOR`, `authorNameProblem`) belongs to that item's area. F-1 itself is about this item's payload contract.

Paths:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/types.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/settings/settings.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/server.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/store/db.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0025-sharing-policy.md
