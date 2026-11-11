# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 10). I read lines 1 to 221 in full, which is everything up to the end of Alternatives. I did not read lines 222 to 265 (the Acceptance criteria, including AC-49 to AC-57, the Risks and the NFRs). I only grepped them for `redirect: "error"`, which appears at :264. The Risks wording on the injection surface is therefore unchecked, and the criteria text is taken from the coordinator's summary. I did not read plan.md.

What I validated earlier still holds at the new lines:
- **What leaves.**
  - The `pinned` line is removed from the payload, both frontmatter and body pass `redactForSend`, and the hash is recomputed over the redacted bytes with `entryBytes` (:136).
  - A pending row sends nothing and the sweep, the pull and the spawn read confirmed rows only (:95, :101, :130).
  - Refusals and purged rows block re-sends (:134, :138).
  - A `receive` project sends nothing (:113).
- **The token.**
  - It lives in `servers.json` at 0600 and is created that way through `writeFileAtomic` (:97).
  - It is never in a route, an output, a log or the backup (:97, :201).
  - Writes are under the store's write lock with a re-read-and-compare, so no writer loses another's update (:97).
  - A lost join answer needs a new code and an orphan device is the admin's to revoke. That is stated, and it is part 7's runbook (:101, :42).
- **Redirects and loopback.** Loopback is the literal set (:19). The URL check is at :101. `redirect: "error"` is on every request (:155, :264).
- **Path components.**
  - Grammar checks and the folder guards are unchanged (:174).
  - Member folders are named by id alone (:157). Id grammar is enforced (:174), so a renamed or erased member moves no folder and the name never becomes a path component.
- **The pin.** The local `pinned` line is kept on a teammate's revision (:157, :182).
- **The 403 and the re-join.** `disabled` stops the server with its remedy (:162). `rejoin` replaces the device and the token and keeps the ledger (:103).
- **D-9.** A pull names only bound projects (:60, :145). Server B is never sent a project bound to A (:72, :145).

The new rules:
- **The restore hold per server (:107, :197, :219).**
  - Only `share server resume` clears it. It shows the withdrawals per project first and takes a yes. This closes the risk that one `setLevel` would have released a withdrawal sweep over every other project's items unseen.
  - It is the safer direction for what leaves. The withdrawal is a take-back from the team, and it is held until the person has seen it.
- **Hiding copies of an unbound alias from every read (:168).**
  - A copy no pull refreshes, which an admin's purge would never reach, cannot reach an agent. Reads require a listed server, a bound alias and no mute.
  - The retrieval's received-memory reads filter by listed server and mute (:178).
- **The prompt floor (:169).**
  - It shows at most one received entry of its two per prompt, and the session-start block pins none. This limits what a teammate's text can inject. The unchecked Risks wording is the only part I did not see.
  - Residual risk, a note only: any member may push to any bound alias, and the floor's false-injection rate is measured on 18 entries. This is the accepted risk the review gate's non-goal names (:38).
- **The failed-start back-off (:130).** It adds no outflow. A start that fails writes a `meta` mark and the spawn backs off, so a broken start is not spawned on every prompt.
- **The lease guard (:121).** A process that lost the lease writes nothing, and a cursor never moves backwards.
- **Pending rows store the feed row's JSON payload (:95).**
  - That is received text already in the person's store, kept on the machine, and nothing sends it.
  - It is deleted with the server's other pending rows (:105, :194).
- **`logError` (:201).** It dedupes per server and operation, and never writes a token, a code or a payload.
- **The restore (:186 to :197).**
  - A stale carry mark in the copy is cleared before the rename (:191).
  - The carry's one function, the owed-carry rules and the unlisted-server deletion are as I validated in rounds 7 and 8.
  - The token file is outside the backup and is kept (:192).
  - Received copies of an unlisted server are hidden until `deleteServerReceived` runs (:194).
- **The contract module (:91).** It exports `entryBytes`, the header names and the request-id grammar. The client mints ids of that grammar (:155). No new outflow.
