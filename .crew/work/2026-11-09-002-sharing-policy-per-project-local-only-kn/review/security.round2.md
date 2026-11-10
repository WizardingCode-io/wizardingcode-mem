# security findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-security
read: 24 files, risk areas: personal-data, data-migration, auth

## Findings
- F-1 · advisory · src/sharing/types.ts:153 · `OutgoingEntry.frontmatter` is the entry's whole frontmatter text. That text includes the author's name (from `WIZARDINGCODE_MEM_AUTHOR` or the git name), and ADR 0025 line 134 still never says that the author leaves. Nothing is sent in this part, so no caller gets the name today. But once part 6 sends entries, the pinned key set cannot keep a person's name off the team server. Either the ADR says the author leaves, or the payload names the frontmatter fields that may leave. Carried from round one, still open.
- F-2 · advisory · src/settings/settings.ts:403 · `validatePatch` now refuses `\r` and `\n` under every key, which closes the round-one injection (probes/newline-in-a-setting.md). `parseEnvFile` splits only on `\r?\n`, and its `.*` does not cross U+2028 or U+2029, so such a value drops its own line and widens nothing. Refusing every C0 control character would be hardening beyond the module's own rules.
- F-3 · advisory · src/ui/server.ts:452 · `GET /api/sharing` writes. `policyInForce` reconciles and logs to `sharing_changes`, and `wouldLeave` with `fresh: true` refreshes the repositories' index. It sits behind the same Host and token checks as every route (server.ts:249–266), so no new caller reaches it. A GET that writes is still a pattern that a later cross-origin weakness would turn into a write path.

## Outside the change
- src/store/db.ts · `openDb` turns WAL on only when it creates a database, so a restored store stays in rollback-journal mode. probes/restore-journal-mode.md shows this predates the item: the `VACUUM INTO` copy is already in DELETE mode, and `resetSharingInCopy`'s `PRAGMA journal_mode = DELETE` changes nothing. Debt.
- ui/src/components/ProjectsView.vue:84 · the existing links toast ("Not changed") still shows `error.message`. The item's own sharing toast (line 121) and Sharing.vue use fixed sentences, as AC-23 asks. Debt.

## Not answerable
- none

Notes for the judge (no defect in any of these):
- **auth:** `GET /api/sharing`, `POST /api/sharing/preview`, `PUT /api/projects/<id>/sharing` and the sharing branch of `PUT /api/settings` are all handled after the global Host check and token check (src/ui/server.ts:249–266), like every route around them.
  - `confirm` is taken from the request itself (server.ts:427; the project route reads `body.confirm === true`). `setLevel` and `applySettingsPatch` judge it inside `withWrite`, against what the store and the file hold at that moment.
  - The project id matches only `\d+`. Preview input is checked with `isLevel`, `isRoot` and `SHARE_AREA`.
  - A closed policy is refused with 409.
  - A patch with no sharing key goes through `saveSettings`. That calls the same `writeEnvFile` (0600, atomic rename) as `applySettingsPatch`.
- **personal-data:** `decide` (src/sharing/policy.ts) fails closed. A closed policy, an unknown destination, a disabled project, a lost or non-host-led alias, and project 0 or an orphan all keep everything.
  - Memories leave only at `all`, and only if active, not stale, project-scoped, not imported and not a user rule (D-15).
  - The memory candidate query reads no title or body. Texts are read only to hash ledger-recorded candidates, after `redactForSend`.
  - Memory titles from `?list=1` and `share status --list` go only to the local token-gated viewer or the owner's terminal, which already show memories.
  - Nothing is sent, and no hook reads the policy.
  - A widening needs a confirmation on the server side. Without a TTY and without `--yes`, `askYesNo` answers no.
- **data-migration:** `0001_sharing_policy.sql` only adds three tables and an index. It is forward-only like the core, has no foreign key or trigger on core tables, and leaves `user_version` at 7.
  - `migrateModules` runs every module's pending migrations in one locked transaction, and an error rolls the whole upgrade back.
  - `resetLevels` runs on the unpacked copy, under the frozen live store, before the first rename. The replaced store is kept as `.replaced-<time>`, and a reset that throws fails the restore with nothing renamed.
- **Sibling item (2026-11-09-001):** nothing found in its paths (src/modules/knowledge/, src/judge/, src/mcp/, src/cli/commands/mcp.ts and tool.ts, the OpenCode plugin). `WIZARDINGCODE_MEM_AUTHOR` and `authorNameProblem`, which F-1 depends on, belong to the knowledge work. F-1 itself is about this item's payload contract.

Paths:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/types.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/settings/settings.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/settings/env-file.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/server.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/api.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/policy.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/report.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/backup/backup.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/store/db.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0025-sharing-policy.md
