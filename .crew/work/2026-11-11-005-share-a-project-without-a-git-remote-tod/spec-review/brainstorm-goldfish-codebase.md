mode: brainstorm

# codebase findings for 2026-11-11-005 concept (share a project without a git remote)
reviewer: goldfish-codebase
read: probes/concept.md (whole); src/sharing/levels.ts, store.ts (180-470), report.ts (165-203), types.ts, policy.ts (100-160); src/core/project.ts; src/team/contract.ts, validate.ts, feed.ts, routes.ts (200-260), store.ts (grep); src/sync/naming.ts, inbound.ts (295-334, 640-717), outbound.ts, received.ts, log.ts, ledger.ts (refusals), conflicts.ts (projectByAlias), client.ts (routes); src/modules/knowledge/resolve.ts, entry.ts (slugify); src/ui/api.ts; ui/src/components/ProjectsView.vue; src/cli/commands/share.ts; src/status/report.ts; docs/adr/0024 line 69; the tests named below. The lens: observability and debugging.

## Findings
- F-1 · Blocker · Hypothesis 5 · `/v1/health` returns no version. It answers `{ ok: true }` or `{ ok: false, error: "low disk" }` (src/team/routes.ts:205-211), and tests/integration/team-auth.test.ts:59 and :656 pin that exact body with `toEqual`. The sync client never calls health: src/sync/client.ts only calls `/v1/join`, `/v1/me` and `/v1/push`, plus the pull. The version in src/team/status.ts:83 is `serve status`, which only the operator sees. So the gate needs two things: a new field, and a new client call whose rule is "no version means 0.7.0". If the version goes in `/v1/me` instead, `RESULT_SHAPES.me` changes and so does `CONTRACT_FINGERPRINT` (contract.ts:74-141). That breaks "no contract bump".
- F-2 · Blocker · Hypothesis 5 · An older server causes two failures the concept does not cover. (a) `parsePullQuery` rejects the whole pull with 400 when any alias is bad (feed.ts:56-57). One team alias therefore stops every pull, the shared and workspace scopes included, until the gate exists. (b) Push refusals are stored for each uid and hash (`sharing_refusals`, src/sync/ledger.ts:284), and outbound skips any item with a stored refusal (outbound.ts:435). Every item refused with `shape` before the server upgrade stays refused after it, until its text changes. The concept needs a rule that clears these refusals when the server's version moves, and a status line that says so.
- F-3 · Blocker · Hypothesis 1 · Swapping in `isTeamAlias` is not enough on its own. Three call sites run a SQL prefilter first: report.ts:183 and ui/api.ts:92 use `LIKE 'remote:%'`, and `ENTRY_UID` (contract.ts:27) contains the literal `remote:`. A `team:` row never reaches the predicate. The concept also misses other `LIKE 'remote:%'` places:
  - src/sync/inbound.ts:664 (`projectAliases`). This feeds `memoryInScope` in `compareSnapshot` (inbound.ts:703-711). Received memories under a team name would never be reconciled by a snapshot, so a memory withdrawn on the server stays on the machine with nothing reported.
  - src/core/project.ts:87 (`hasRemote`).
  - src/links/suggest.ts:42.
  - resolve.ts:191 (`byRemote`) and :258.
- F-4 · Major · Hypotheses 3 and 9 · A project can end up with two identities. If `~/Projects/wizardingcode` later gets a git remote, `resolveProject` keeps the same project, because `hasRemote` counts only `remote:` (project.ts:98-102). The project then holds both the team alias and the remote alias. `aliasToBind` keeps the alias it is already bound to (store.ts:345), so it stays on `team:`, while `has-remote` now refuses any change of name. The concept's "one identity on the server" holds only at the moment `as` is given. A reader would not see which identity the server uses. `share status` shows it (share.ts:319); nothing else does.
- F-5 · Major · Hypothesis 8 · "`share explain` names the alias as it does a remote" is false. `explain` prints `ref: answer · reason · text` and the ledger rows (share.ts:401-413), and no alias. Only `share status` names one: "(bound to <alias>)", share.ts:319. `explain` also looks only at what this machine sends, so it cannot explain "never arrives".
- F-6 · Major · Observability: "my teammate's project never arrives". Today there is nowhere to see why.
  - `status` prints one line per server: cursor, push and pull times, backlog, dirty, pending, conflicts (status/report.ts:184-195). It shows no aliases.
  - The sync logs errors only (src/sync/log.ts:1-4). A pull that names `team:wizarding-code` while the teammate sent under `team:wizardingcode` gets zero items and logs nothing.
  - doctor has no sharing alias check.
  - Needed: for each bound alias, the name, its extra cursor (`cursorsOf(...).extra[alias]`, inbound.ts:648), the received entries and memories, and the time of the last item. Also a doctor check, "bound name has no items on the server", built on the new `GET /v1/projects`.
- F-7 · Major · Hypothesis 6 · `GET /v1/projects` adds an answer the client reads. Under the rule at contract.ts:73 it belongs in `RESULT_SHAPES`. Adding it moves the fingerprint and turns tests/unit/team-contract.test.ts red. The concept must either bump the contract or say why this answer is exempt.
- F-8 · Major · Hypothesis 8 · `share project` works only on the project of the current folder (`findProject(db, process.cwd())`, share.ts:200). `imported:<name>` projects, most of the 149, have no folder, so `--as` cannot reach them from the CLI. Only the viewer can.
- F-9 · Major · Hypothesis 7 · `ProjectSummary.remote: boolean` (ui/api.ts:70) is the switch behind `sharingLocked` (ProjectsView.vue:133) and the sentence at :327. The summary needs a new field for the team name. tests/integration/ui-sharing.test.ts:290 and :306 pin `remote: false`.
- F-10 · Nit · Hypothesis 1 · The name grammar does not match `slugify` (entry.ts:72-87): that function caps at 80 characters, not 63, falls back to `entry` when nothing is left, and adds `-entry` to reserved names. `repoFolder` uses `slugify`, so `team:aux` would get the folder `aux-entry-…`. The concept does not say what happens when a name leaves no slug, such as "設計".
- F-11 · Nit · The `unbound-alias` texts say "git remote" (types.ts:109, policy.ts:116). They would be wrong for a team name that is lost.

Tests that would turn red:
- sharing-store-writes.test.ts:147-152, 204, 418, 433, 571 (`no-remote` becomes `no-name`)
- sharing-store.test.ts:660
- ui-sharing-copy.test.ts:170, 292
- ui-sharing.test.ts:290, 306
- team-auth.test.ts:59, 656, if health gains a version
- team-contract.test.ts, if any shape is added

These stay green but need cases for `team:`: sharing-levels.test.ts:23-51, team-validate.test.ts:23-40, sync-naming.test.ts:24-29, team-pull.test.ts:187, team-mirror.test.ts:219.

Answers to the concept's four questions, from this lens:
1. Two members who both pick `docs` get merged with no trace afterwards. Each received item carries `member`, but nothing on the client says "3 members send under this name". The counts in the list are seen once, when the field opens. A server rule is possible, since `changes.member_id` records the first sender, but the client also needs a lasting signal, either in status or in doctor.
2. Binding a folder to a `remote:` alias picked from the list is dangerous. `aliasToBind` requires the alias to be in `project_aliases` (store.ts:344), so the code would have to insert a `remote:` row. A remote alias is inserted with `INSERT OR IGNORE` and is never moved (project.ts:133). A later real clone of that remote would then resolve into the borrowed folder's project. It is not the same feature.
3. Rename by Nothing first: `noteUnbound` (store.ts:304-326) already drives the cleanup of received copies. A move would change every uid, and `compareSnapshot` would show it as a delete plus a new entry, with no log line. Keep Nothing first, but make status show the old name until it is withdrawn.
4. Imported memories: `share explain memory <id>` already says "Imported memories stay." (types.ts:115). Making this visible only needs the count split shown in the dock. Changing D-19 is a separate decision; it belongs in its own item.

## Not answerable
- Whether setting Nothing withdraws what was sent on the server (hypothesis 2) · I did not trace the withdrawal path from `removeLevel` and `sharing_unbound` to the push.
- doctor's sharing checks · I read only checks.ts:633 and doctor-sharing.test.ts.
