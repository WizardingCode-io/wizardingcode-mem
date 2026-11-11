# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 11). This round I read the Alternatives tail, all the Acceptance criteria (:227 to :244), the Risks (:246 to :254), the Rollback (:256 to :259) and the NFRs (:261 to :266). Lines 1 to 221 I read in round 9. I did not re-read them in this round, so I did not check the revision-11 edits to those lines: the ownership rule under "Where things live", the snapshot per cursor, and the instance-change deletion of pending rows. Those rest on the criteria text I did read and on the coordinator's summary. I did not read plan.md.

The earlier properties hold at the new lines:
- **What leaves.**
  - The `pinned` line never leaves, and redaction and the hash over the redacted bytes are unchanged (:235).
  - A pending row sends nothing (:231).
  - Refusals and purged rows block re-sends (:235).
  - A `receive` project sends nothing (:233).
- **The token.** It is at 0600, in no table, route, output or log (:231, :240, :241, :266).
- **Redirects and loopback.** AC-15 refuses `http://localhost.example.com` and treats a redirect as a failure (:231). `redirect: "error"` is on every client request (:266).
- **Path components.** The grammar and the folder guards are tested (:237).
- **The pin.** AC-52 (:236) pins that a revision adding `pinned: true` does not pin the entry. Received entries are never pinned, and `knowledge pin` refuses them (:237).
- **The 403 and the re-join.** `disabled` is tested (:238). `rejoin` keeps the ledger (:231).
- **D-9.** A project bound to server A is never named in server B's pull (:237).

The new rules, now read in full:
- **The injection surface (:249).** Risks names it: any member may push to any bound alias, and the floor's false-injection rate was measured on 18 entries. The mitigations are apart storage, the marker, never pinned, one received entry per prompt, none at session start, a third of a brief, a mute per server or member, and the person's own items first. That is what I asked for. The residual risk is accepted by the non-goal on a review gate (:38).
- **The restore hold key cleared on `remove` and in the restore's step 4 (:232, :239).** A re-added server cannot inherit a hold nobody set. The hold is released only by `share server resume` after a preview and a yes (:232, :239). That is the safer direction for what leaves.
- **The `applied` ledger direction (:236, :242).**
  - A teammate's revision applied to an own item is recorded in its own direction. It is never read by `decide` and is cleared with the `sent` row.
  - An own entry sent to two servers and revised on one still decides `send` on the other (:236). That closes a false `received-elsewhere` outflow block, and it adds no outflow.
- **Snapshot per cursor and the pending rows (:238).**
  - `snapshot_due` clears only when every cursor has completed.
  - An instance change deletes the server's pending rows, so a stored payload from the old instance is never re-applied over what the snapshot replaced.
  - This is the correct fail-safe for received text.
- **The memory `stale` loop fix (:235).**
  - The `sent` row records the server's copy with the local `memoryHash`, and the sweep skips the uid until the memory changes.
  - It stops a re-send loop and adds no outflow.
- **The ownership rule for sharing tables (per the coordinator's summary).** It limits which files write the sharing tables, and "nothing under `src/sync/` but `spawn.ts`, and not `src/backup/carry.ts`, runs on a hook path" keeps the network off the hooks (D-1).
- **Rollback (:258).** Nothing new: the token file is read by nobody older, and `user_version` stays 7.
- **Hiding (:237, :250, :266).** Nothing of a server this machine no longer lists, or of an unbound alias, reaches an agent.
