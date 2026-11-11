# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
Lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 16). I read the resume paragraph (:110) and the restore's step 4 (:217) in full, and I located `sharing.resume_authorised` by search. I did not read the `remove` paragraph, the pull's item 1, restore step 3 or the `pinnedEntries` bullet in this round. I did not read the new criteria AC-77 to AC-80, or plan.md. The `mainAliases`, `pinnedEntries` and `openStoreFile` changes rest on the coordinator's account, and the `remove` deletion of the authorised list rests on the resume paragraph's own statement. None of them touches what leaves, the token, redirects and loopback, path components, the 403, the re-join or D-9. A pinned entry that is left out of `pinnedEntries` while its pin is held only narrows what enters the brief. Round 14's properties stand.

- **The authorised list adds no withdrawal the person did not see.**
  - It is written only by `share server resume`, and only with the uids that resume printed and the person confirmed (:110).
  - Each uid leaves the list as its withdrawal is answered. A sweep interrupted by `rate`, a failure or a lost lease keeps the rest authorised, and the key is deleted when the list is empty (:110). Each pass can therefore withdraw only items from the shown set. It cannot widen, because nothing but a resume writes the list.
  - A withdrawal only happens for a `sent` row whose item no longer decides `send` (:110, :157). If the item has meanwhile come back to `send`, the authorised uid is simply never withdrawn, so the person's later change wins.
  - Later sweeps are guarded again (:110).
- **Stale lists are cleaned in every place they could outlive the person's decision.**
  - The restore clears every `sharing.resume_authorised:*` key of the copy with the hold keys, then sets the hold key of every listed server (:217). No list carried by an older backup suspends the guard for uids nobody showed the person.
  - `share server remove` deletes a server's authorised list with its hold key (:110). A re-added server cannot inherit one.
- **The restore carry.** The copy's `journal_mode` is set to DELETE and it is closed. The restore refuses the rename if a `-wal` file is still beside the copy, and any failure fails the restore with nothing changed and the copy discarded (:217). The token file is still outside the backup (:218).
- **Narrowing is still not held** (:157). The person's own narrowing, logged with the source `cli` or `viewer`, proceeds at once.
