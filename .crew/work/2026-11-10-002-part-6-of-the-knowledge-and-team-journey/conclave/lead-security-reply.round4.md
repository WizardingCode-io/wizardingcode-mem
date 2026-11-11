# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 5). I re-read only `spec.md`. I did not re-read `plan.md`, so its task 5, 7, 9, 11 and 17 changes are taken from the coordinator's message and not checked by me. What I validated earlier still holds:
- **What leaves.**
  - The `pinned` line never leaves (:117).
  - Frontmatter and body both pass `redactForSend`, and the hash is recomputed over the redacted bytes (:117).
  - Nothing goes to a pending server (:87, :93, :111, AC-15 at :177).
  - Refusals and purged rows stop re-sends (:115, :119).
  - A `receive` project sends nothing (:103, AC-35 at :178).
- **The token.**
  - It sits in `servers.json` at 0600, created that way, and outside the database and the backup (:89).
  - No route or output returns it (:89, AC-15 at :177).
  - `last_error` goes through `redact`, and the log never carries a token, code or payload (:150).
  - The new `sharing_servers` reads by the knowledge module and the retrieval code touch no token column (:82, :87).
- **Redirects and loopback.**
  - Loopback is the literal set (:18).
  - The URL check is at :93 and AC-15 (:177) refuses `http://localhost.example.com`.
  - The preference is applied: `redirect: "error"` on every client request (:207, :123).
- **Path components.** Each is checked against its grammar. `reachedByFolders`, `lookAt`, `kindAt` and `namesIn` are named, and a linked `received/` or `received/<serverId>/` is refused (:134, AC-36 at :182).
- **The pin.**
  - A teammate's revision can neither pin nor un-pin: the local `pinned` line is kept (:125, :142).
  - AC-37 (:181) pins the case where a revision adds `pinned: true`.
  - Received items are never read by `pinnedEntries`, and `knowledge pin` refuses them (:134).
- **The 403.** `403 member disabled` stops the server as `disabled`, with its remedy (:130, AC-31 at :183).
- **The re-join.** `rejoin` replaces the device and the token and keeps the ledger (:95). `add` of a stopped listed server does the same (:95).
- **D-9 and the A/B clause.** A pull names only bound projects (:59, :123), and AC-36 (:182) keeps "a project bound to server A is never named in server B's pull".

The new rules, and what a security lead would check in each:
- **The unbinding deletion (:123, AC-36 at :182).**
  - It deletes only the server's received copies of unbound aliases, never own files or own rows.
  - It runs before the pull's first page, one transaction per alias, with the `superseded_by` rule.
  - A re-bind brings the rows back through a snapshot.
  - It narrows what a project's received copies retain, which is the right direction for privacy.
  - Limit, not a return: until the next pull the rows still read as before (:123). If the server is stopped or offline, an unbound project's received copies stay visible to agents. That is the person's own local data, so I raise no return. ADR 0027 could name this window.
- **The conflicts close (:142, AC-37 at :181).**
  - The row is closed by `proposal_id` after the store's write.
  - Orphan rows are closed at the sync's start.
  - The person's text stays in the row, never leaves the machine, and is sent only after the person accepts the proposal (D-2 at :52).
  - Closing a row loses nothing, since the text also lives in the proposal and the row.
- **The carry of conflicts and refusals (:146, AC-38 at :184).**
  - The seven tables are carried server by server from the live store, so a refused hash is not re-sent after a restore.
  - The conflict text record survives the restore, and it travels on the same machine only.
  - The copy's rows for a server the live list did not hold are deleted, so a restore never resurrects a server the person removed.
  - The token file stays outside the backup.
- **The orphan replaced file (:146, AC-38 at :184).**
  - The mark `sharing.carry_owed` cannot be written if `openDb` fails on the restored file.
  - In that case the restore prints the failure and the file's name, and `doctor` warns for an unmarked `<db>.replaced-*` file.
  - That file holds the whole live database. It is the same sensitivity and the same location as the store, and the restore already kept it.
  - The remedy, "restore again, or move the file away", is acceptable.
  - Preference, not a return: the warning could add that the file is a full copy of the person's memories and should be deleted once the carry completes.
- **Boundary and the shared name function (:80, :82).**
  - `agentName` is a leaf in `src/core/agent-name.ts` and serves all three renderings (:134).
  - The knowledge module and `src/retrieve/` read `sharing_servers` and `sharing_muted_members` read-only, by their own SQL, and import nothing of `src/sync/` or `src/sharing/`.
  - The sync writer's SQL stays in `ledger.ts`.
- **The one-time upgrade (:81).** Both module migrations run in one transaction after the `VACUUM INTO` copy. A failure rolls both back and the next opener retries. `user_version` stays 7. The v1 `run` resolves any project with two rows above Nothing before it creates the unique partial index, so no store is left unopenable. This adds no new outflow.
- **AC-35 (:178).** The viewer, `status`, `doctor` and the `share project` preview read the bound server's level, else Nothing, never `team`. A stale `team` level can no longer be shown as in force.
