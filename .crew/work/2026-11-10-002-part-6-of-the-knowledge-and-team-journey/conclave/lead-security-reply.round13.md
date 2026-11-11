# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:62 (also :157, :256, AC-65 at :283) · D-10's `bulk` hold can leave items on the server that the person has just taken back. D-10 says it holds "a withdrawal that the person did not ask for one item at a time". But :157 holds any sweep that would withdraw more than 20 items or more than half of a server's sent rows, whatever caused it. AC-65 (:283) pins both "narrowing the policy withdraws the item" and "a sweep that would withdraw more than 20 items holds them under `bulk`". A person who sets a project at Knowledge with 25 sent items back to Nothing, or narrows the server's roots or areas, asked for that withdrawal. Under the current text it stalls until `share server resume`, and the items stay readable by the team. The only signal is a `status` line (:224). ADR 0025's promise that narrowing takes back what was sent is broken for exactly the case where the person is removing a client's data. What must change:
  - The spec says which causes the `bulk` hold covers. Narrowing made by the person through `setLevel`, `share roots` or `share areas`, or the viewer, has already been shown a preview (`withChange` and `wouldLeave`). That preview is the yes, so it must not be held.
  - The hold applies only to withdrawals no such action explains: a missing, refused or unindexed repository, many deleted files, a restore, a memory-off or lost-alias `system` removal.
  - If the spec wants to keep the hold for narrowing too, then it must state the delay. The narrowing command and the viewer must print "N items stay on the server until `share server resume`", and AC-65 needs a case that the preview names the count.
## Notes
Lines cited are in `spec.md` (revision 14). I read the spec whole except the tail of AC-24 (:289 onward). I did not read plan.md. The properties I validated before still hold at the new lines, and the new rules add no other outflow or loss.

- **What leaves.**
  - Payloads drop the `pinned` line, pass `redactForSend`, and the hash is recomputed over the redacted bytes with `entryBytes` (:159).
  - The sweep reads committed text only, and a dirty path is skipped and counted (:155, :157).
  - A pending row sends nothing (:98, :104).
  - Refusals and purged rows block re-sends (:157).
  - A `receive` project sends nothing (:127, :128).
  - A missing, refused or unindexed repository is never withdrawn (:157, :256).
- **The token.**
  - `servers.json` is at 0600, written only by `add`, `rejoin` and `remove` inside `withWrite` (:100).
  - It is in no table, route, output, log or backup (:100, :224, :268).
  - A lost join answer needs a new code (:104).
  - The restore keeps the token file outside the backup (:218).
- **Redirects and loopback.** Loopback is the literal set (:19). The URL check is at :104. `redirect: "error"` is on every request (:180, :268, AC-15 at :279).
- **Path components.** The grammar checks, `reachedByFolders`, `lookAt`, `kindAt` and `namesIn` are unchanged (:200). `members/<member id>` is by id alone (:182). The alias folder uses `repoFolder` from the server's contract module (:182).
- **The pin.**
  - A teammate's revision keeps the local `pinned` line, and the payload never carries it (:159, :182, AC-69 at :286).
  - A pinned own entry a teammate revised leaves the brief's pinned block and shows on the floor as `(pin held)` until the person edits it or re-pins it (:182, :254, AC-67 at :285). A teammate's text never enters the brief under the person's pin, which is the right outcome.
  - Received entries are never pinned (:194, :197).
- **The 403 and the re-join.** `disabled` is tested (:187, AC-66 at :284). `rejoin` replaces the device and the token and keeps the ledger (:106).
- **D-9.**
  - The main pull names `scope=all` with the first 100 bound aliases. Extra aliases are pulled alone, and a new alias is snapshotted alone (:165 to :170).
  - A project bound to server A is never named in server B's pull (AC-67 at :285).
  - Each pull still carries only bound aliases.
- **The restore (:210 to :220).**
  - The carry runs into the raw copy before the rename, which is the single commit point. A failure leaves the live store unchanged and the copy discarded (:212, :217).
  - This removes the earlier recovery machinery and the orphan replaced-file risk.
  - The restore holds withdrawals per server with the reason `restore`, so a restore cannot silently take knowledge back (:217, :220).
  - Received copies of an unlisted server are hidden until the sync's start deletes them (:219).
- **Hiding and deletion.** The reads cover listed servers, bound aliases and unmuted members only (:193). The retrieval reads `sharing_levels` too, so an unbound alias's memories are hidden from the brief (:204). `deleteServerReceived` and the unbind reconcile delete received copies only, never own items (:175, :200).
- **The conflict proposal (:208).** It is committed under the person's own identity with the sync as committer, since it holds the person's text. The applied revision keeps the member as author. The text stays on the machine, is redacted as every proposal is, and is sent only after the person accepts it (D-2 at :54).
- **The hook path.** The spawn decision is one statement and one `process.kill(pid, 0)`, with nothing on a store without the sharing schema, and any failure fails open (:151). The lease expires across a sleep, a take-over on wake is safe, and a process that lost the lease writes nothing (:140, :142).
- **Received memories.** A foreign kind, importance and status are mapped, with the remote values kept in the provenance row. Their ledger uid is `remote:<device alias>:<uid>`, which cannot collide with a local uid (:184).
- **The injection surface.** Risks names it (:254). The mitigations are apart storage, the marker, never pinned, one received entry per prompt, none in the brief's pinned block, a third of a brief, a mute per server or member, and the person's own items first. The residual risk is accepted by the non-goal on a review gate (:38).
- **The rollback sentence (:272).** It states plainly that no older binary spares `team:` rows in `history replace-imports`.
