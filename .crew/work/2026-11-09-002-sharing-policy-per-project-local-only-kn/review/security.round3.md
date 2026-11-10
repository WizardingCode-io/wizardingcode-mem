# security findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-security
read: 13 files, risk areas: personal-data, data-migration, auth

## Findings
- F-1 · advisory · src/sharing/types.ts:523 · `OutgoingEntry.frontmatter` is listed to leave "as the file holds it" (ADR 0025, "What leaves with an item"), and an entry's frontmatter carries `author`, the person's name from `WIZARDINGCODE_MEM_AUTHOR` or the global git `user.name` (src/modules/knowledge/author.ts:13, entry.ts:390). Nothing is sent in this part, so nobody can take this path yet. Still, the ADR's lists of what accompanies an item and what never leaves should name the author attribution outright, so part 6 sends it on purpose and not by accident.

## Outside the change
none

## Not answerable
none

Notes behind the answers (no findings):
- Boundary: `validatePatch` (src/settings/settings.ts:400) now refuses `\r` or `\n` under any key before the per-key rule runs, so no value can write a second key into the env file. The env-file reader splits only on `\r?\n`, and a lone `\r` is refused too. `sharingPreview` checks its own input: `projectId` must be a known number, `level` must pass `isLevel`, roots must pass `isRoot` and areas must match `SHARE_AREA`. `setProjectSharing` takes the id only from the `(\d+)` route capture. In `PUT /api/settings`, `confirm` is removed from the patch before validation.
- Secrets: I found no credential in the diff's sharing paths or fixtures. `normalizeRemote` drops `user:pass@` from a remote, and `isHostLedAlias` would reject an alias that kept it, so a bound alias carries no credential.
- auth: the three new routes and the changed `PUT /api/settings` and `GET /api/overview` sit after the Host check (src/ui/server.ts:249-251) and the token check (server.ts:263-266), like their neighbours, and the viewer listens on 127.0.0.1 only. Every widening is judged under the write lock against the stored state, from the request's own `confirm === true`: `setLevel` for levels and `applySettingsPatch` for the lists, which throws `NeedsConfirm` without it. The CLI asks a question or needs `--yes`. The environment can only narrow the lists, a hand edit of the env file is recorded with source `file`, and no MCP tool or hook calls `setLevel` or `applySettingsPatch` (grep over src/). Refusal messages name no user and repeat no value.
- personal-data: nothing leaves the machine in this part. `GET /api/sharing?list=1` and `share status --list` show entry titles and memory titles, unredacted, to the same local person who already sees them in the viewer, so the audience is no wider. `memoryItems` reads no title or body, and `withHashes` passes texts through `redactForSend` before hashing. `decide` keeps user rules, imported, stale and branch-bound memories, and fails closed when the policy cannot be loaded. The ledger and the change log hold uids, levels and list ids, never texts. Erasure is no harder than before.
- data-migration: 0001_sharing_policy.sql only adds tables, with no foreign key or trigger on a core table, recorded in `module_migrations` with `user_version` left at 7; it is forward-only like the core migrations. On restore, `resetLevels` deletes `sharing_levels` only in the unpacked copy, before the swap, while the store is frozen. The backup file is untouched and the replaced database is kept as `.replaced-<time>`, and a reset that fails fails the whole restore.
- Sibling item 2026-11-09-001's paths (src/modules/knowledge/, src/judge/, src/mcp/, the opencode plugin) were not judged here. F-1 touches its author attribution only through this item's payload contract.
