# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
Lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 15). I read D-10 (:62), the resume paragraph (:110) and the outbound guards paragraph (:157) in full. I located the restore's `-wal` rule (:216, :217) and AC-72 (:283) by search and did not read them in full. I did not read plan.md. The coordinator's account of the `-wal`/`-shm` refusal, the `openFile` copy, the sticky main set, the importance rounding, the marker derivation and the tick throttle is the only basis I have for those, and I have not checked it. None of them touches what leaves, the token or the pin. The properties I validated in round 13 are unchanged at the new lines.

- **R-1 from round 13 is answered.**
  - D-10 and the guards paragraph limit the `bulk` hold to withdrawals no action of the person explains: an entry gone from a present repository, or a `system` removal of a level or an alias (:62, :157).
  - A withdrawal that follows the person's own narrowing (`setLevel`, `share roots`, `share areas`, the viewer) is never held. It is recognised by its `sharing_changes` row with the source `cli` or `viewer` after the sent row (:157). Its preview was the yes.
  - A person who sets a project with 25 sent items to Nothing therefore sees it withdrawn at once, and AC-72 (:283) names the case. A removal made on behalf of a team is no longer left readable by a hold.
- **The hold covers the right set.**
  - An unmounted, refused or unindexed repository is never withdrawn (:157).
  - Many deleted entries from a present repository, and a `system` removal, are held (:157). These are the cases where an unwanted mass withdrawal is the risk.
  - After a restore every level is reset to Nothing, so a restore hold covers all of them (:62).
  - While a hold is set, only what the person's own narrowing explains is withdrawn (:157). A person who narrows after a restore therefore still takes things back at once.
- **Resume does not loop (:110, :157).**
  - It authorises exactly the uids it showed, in `meta` `sharing.resume_authorised:<serverId>`.
  - The next sweep withdraws those uids with the guard suspended and clears the list. Later sweeps are guarded again.
  - The authorised set is limited to what the person saw and confirmed, so it opens no new withdrawal and no outflow.
- **The carry and the restore.**
  - The restore refuses a `-wal` or `-shm` file beside the copy, sets the copy's journal mode to DELETE and closes it before the rename (per the coordinator; the `-wal` rule is at :216 and :217). No carried row, including the person's conflict text, can sit in an unrenamed side file and be lost.
  - The token file stays outside the backup and is kept (:218).
- **What leaves.** The payload drops the `pinned` line, redaction and the redacted-bytes hash are unchanged, and the sweep reads committed text only (:155, :159). A pending row sends nothing (:98, :104).
- **The token, redirects and loopback.** `servers.json` is at 0600, written under `withWrite` and in no table, route, output, log or backup (:100). `redirect: "error"` is on every request (:180, :268).
- **Path components, the pin, the 403, the re-join and D-9.** These are unchanged. A teammate's revision keeps the local pin, a revised pinned entry has its pin held, and a project bound to server A is never named in server B's pull (:182, :185, :165).
- **Marker derivation.** The `revised by` marker and the held pin are derived from the `applied` ledger row (no stored flag), read by the knowledge module's own SQL, per the coordinator. That adds no new table and no outflow.
