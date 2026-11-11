# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 6). I read the pull paragraph (:123), the restore paragraph (:146) and the security NFR (:207) directly. I located the other changed paragraphs by search: the sync writer paragraph (:142), the `src/sharing/` bullet (:81), and AC-39, AC-40 and AC-41 (:181, :182, :184). I did not re-read those, nor plan.md, so their changes are taken from the coordinator's message and I have not checked them. What I validated earlier still holds, and the revision changes none of it:
- **What leaves.**
  - Frontmatter and body both pass `redactForSend`, the hash is recomputed over the redacted bytes, and the `pinned` line never leaves (:117).
  - A pending row sends nothing (:93, :111).
- **The token.** It sits in `servers.json` at 0600 and outside the database and the backup (:89). The restore keeps it out (:146).
- **Redirects and loopback.** Loopback is defined at :18. `redirect: "error"` applies to every client request (:123, :207).
- **Path components.** The grammar checks and the folder guards are unchanged (:134).
- **The pin.** The local `pinned` line is kept on a teammate's revision (:125).
- **The 403 and the re-join.** Both are unchanged (:95, :130).
- **D-9 and the A/B clause.** A pull names only bound projects (:123). The clause "a project bound to server A is never named in server B's pull" stands.

The new order and failure rules:
- **Unbind reconcile (:123).**
  - It deletes only received copies, files first and then the rows in one transaction. It never touches own files or rows.
  - A crash between the two steps leaves rows without files. That is a harmless intermediate state with no outflow, because received items never travel on (:127, :134).
  - The sync's start drops such rows. `reindexReceived` indexes only the files of aliases bound to that server and runs before any pull, so an unbind made while the sync was stopped is honoured.
  - A failed reconcile holds the pull's first page and is retried. Nothing from an unbound alias is applied meanwhile, which fails safe.
  - The window in which an unbound project's rows still read until the reconcile is unchanged from my round-4 note. It is the person's own local data.
- **Conflict close (AC-40).** Closing a row whose proposal is not `open`, or is gone, only changes the row's state. Round 4 recorded that the row keeps the person's text and never leaves the machine (:142), and this revision does not change that.
- **Restore (:146).**
  - A failed owed carry fails the restore before anything is read or renamed. This is stricter than before: no new loss, and the mark and the replaced file are kept.
  - `sharing.carry_done` is a `meta` mark naming a file. It carries no data.
  - The `doctor` warning for an unmarked, newer `<db>.replaced-*` file adds no outflow. It stays silent for earlier binaries' files and after an ordinary restore.
- **The `src/sharing/` bullet.** The tiebreak in the upgrade's resolve (the `team` row, else the lowest `destination` in byte order) is deterministic. It removes a level row only with a logged `system` change, so it opens no outflow. The pinned column contract for `sharing_servers` and `sharing_muted_members` is also fine: those reads touch no token column (:87).
- **My earlier preference, no return.** The wording of the orphan-file warning does not need the "full copy of the person's memories" sentence. The file has the store's own sensitivity and sits beside it, and the remedy "restore again, or move the file away" is enough. ADR 0027 could say that the file should be deleted once the carry completes.
