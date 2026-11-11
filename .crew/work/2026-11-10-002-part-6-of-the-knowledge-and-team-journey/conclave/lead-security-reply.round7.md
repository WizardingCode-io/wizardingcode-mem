# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 8). I read only the passages that match `deleteServerReceived`, "same alias" and "bound again" (:103, :123, :146, :182). I did not read plan.md. I did not see the `reconcileLevels` rule, the `sync --once` sentence or AC-44 to AC-46 in my search, so those changes rest on the coordinator's description. The spec text I read is consistent with it. Earlier properties are unchanged by the passages I read: what leaves, the token, redirects and loopback, path components, the pin, the 403, the re-join, and D-9 with its A/B clause.

New rules:
- **The unbound row's write condition (:103).**
  - `setLevel` writes the row only when no other enabled project is still bound to that server under the same alias. Two clones of one repository share an alias, and a pull names aliases, so deleting on the first unbind would remove the second project's copies. This condition keeps them: it prevents a loss.
  - `reconcileReceived` re-checks each row and drops it without deleting anything when the alias is bound again (:182).
  - A `system` removal by `reconcileLevels` writes no row, so the received copies stay until the server is removed. That fails safe on data, and it is not an outflow: received items never travel on.
- **The orphan deletion at the sync's start (:146).**
  - `deleteServerReceived` removes received copies only: `knowledge_received` rows, their search rows, files and received memories, with the `superseded_by` rule. It never touches own items.
  - It applies to a server id that has received rows but no `sharing_servers` row. That means the person no longer lists the server, from `remove` or from a restore whose live list lacked it.
  - A single owner of that deletion, called by `remove` and by the start, reduces the chance of a partial delete.
  - The restore's carry deletes sharing rows only, which keeps the restore's one transaction small.
  - `sync --once` runs these start steps even with no server listed. A person who has removed every server therefore does not keep stale received copies unnoticed, and the restore says so when the live list is empty.
  - No network is involved, so there is no outflow.
- **The delete lists are complete** (:146). Ledger rows, sent hashes, refusals, conflicts, pending rows, unbound rows and mutes are listed one for one for an unlisted server, and `share server remove` carries the same set. No sharing row of a removed server survives to be mistaken for a live one.
- **The unbound list stays on the machine.** It names aliases the person already has, and no pull, push or route sends it (:123).
