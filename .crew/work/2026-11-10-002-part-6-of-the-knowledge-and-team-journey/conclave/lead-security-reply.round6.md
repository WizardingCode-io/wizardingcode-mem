# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 7). I read only the passages that name `sharing_unbound` (:103, :123, :146) and the stale-mark clearing (:146, :184), and I did not re-read the rest. I did not read plan.md, and I did not find `resetSharingInCopy` or `completeOwedCarry` by name in spec.md. For those two I rely on the coordinator's description and on the spec's own statement of the behaviour (:146). The earlier properties are unchanged by the passages I read: what leaves, the token, redirects and loopback, path components, the pin, the 403, the re-join, and D-9 with its A/B clause (:117, :89, :18, :207, :134, :125, :130, :95, :123).

New rules:
- **`sharing_unbound` adds no outflow.**
  - It holds (server, alias, at) and is written only by a person's `setLevel` to Nothing (:103). The alias is a project name already known to this machine.
  - No pull, push, route or output uses it: the pull names only bound projects (:123), and the unbound list only drives local deletion.
  - It is carried on a restore with the other sharing tables, and that carry stays on the machine (:146).
- **Nothing is lost.**
  - Deletion keyed on an explicit person action is safer than "not bound". A restore's `resetLevels` can no longer cause a deletion of received copies (:103, :146).
  - It deletes only received copies, never own items. The files go first, then the rows and the `sharing_unbound` row in one transaction (:123).
  - The row is removed only when that transaction completes, so a failed or crashed reconcile is retried. A re-bind before the reconcile keeps the copies (:103).
- **Clearing the stale marks (:146, :184).**
  - A stale `sharing.carry_owed` or `sharing.carry_done` in the raw copy is cleared before the rename. This closes a real hazard: the sync's start could otherwise carry from an unrelated old file and overwrite the server list.
  - The clearing touches only marks. It reads and writes no memory text and does not touch the token file.
- **The owed-carry rules stand** (:146): the carry fails the restore early, nothing is changed, and the mark is kept.
- **The conflicts close is now CLI-only** (:142). The viewer has no route that closes a conflict, so no new route handles the person's conflict text. The close only changes a row's state.
- **One writer of `knowledge_fts` rows for received entries.** Only the received-row writer and dropper in the knowledge module touch them, which narrows the surface that guards the received tree.
