# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 4). The spec's own text is the only proof I read; I did not re-read the source files behind my round-1 citations. Revision 4 changes no rule. D-9's answer narrows the pull and leaves the rest as I validated it in round 2. Round-1 returns:
- **R-1, nothing leaves before the yes.**
  - The row is written with `confirmed_at` null (:87, :93). The sweep, the pull and the spawn read only confirmed rows (:87, :93, :111).
  - The first server's `team` rows are moved only inside the yes transaction (:93).
  - A no leaves the row pending, so nothing is swept or pulled (:93).
  - AC-15 (:177) requires that a prompt-hook sync sends nothing while the row is pending.
  - The spawn read counts `confirmed_at IS NOT NULL AND stopped IS NULL` (:111).
- **R-2, a teammate cannot pin or un-pin.**
  - The `pinned` line is removed from the payload on send (:117).
  - On apply, the local `pinned` line is kept as it was (:125, :142).
  - The marker `revised by <member> via <server>` holds until the person edits again (:125).
  - AC-30 (:181) pins the case where a revision adds `pinned: true` and the entry is not pinned.
  - Received entries are never read by `pinnedEntries`, and `knowledge pin` refuses them (:134).
- **R-3, project names in a pull.**
  - A pull names only projects bound to that server (:11, :59, :123). "Bound" means a level above Nothing, or `receive`, which sends nothing.
  - D-9 records the person's answer "default" (:59), and the rejected alternative is stated with the reason (:171).
  - AC-20 (:182) keeps the clause "a project bound to server A is never named in server B's pull".
  - A changed alias group is a new group that starts from a snapshot (:123).
- **R-4, the 403.** `403 member disabled` stops the server as `disabled` with its remedy (:130). AC-31 (:183) tests it. The client makes no admin calls, so a 403 `admin only` rule is not needed.
- **R-5, re-join.**
  - `share server rejoin` replaces the device and the token, clears `stopped`, sets `snapshot_due`, and keeps the ledger, levels and received items (:95).
  - `add` of a listed, stopped server does the same (:95). The `unauthorized` and `rejoin` remedies point to rejoin (:130).
  - AC-15 (:177) covers the replacement. AC-31 (:183) covers the 401 stops.
- **R-6, the token file.**
  - It is created at 0600 (the temporary file is opened at 0600, then renamed) and sits outside the database file (:89).
  - The viewer's process is named as a holder (:89).
  - No route or output returns the token (:89), and AC-15 (:177) and AC-24 (:186) pin it.
  - The copied-whole data directory is stated as a known limit, with the remedy (:89, :40).
- **R-7, redirects and loopback.**
  - Loopback is defined as the literal `localhost`, `127.0.0.0/8` or `::1` (:18).
  - Every pull request uses `redirect: "error"` (:123).
  - The URL must be `https://` or loopback, origin only, no path, no credentials (:93).
  - AC-15 (:177) refuses `http://localhost.example.com` and treats a redirect as a failure.
- **R-8, path components from the server.**
  - `serverId`, member id, slug and alias folder are each checked against a grammar (:134).
  - Paths go through `reachedByFolders`, and a linked `received/` or `received/<serverId>/` is refused (:134).
  - AC-20 (:182) tests both.
- **Round-2 preferences are applied.**
  - `agentName` (80 characters, control characters stripped) serves all three renderings (:134, AC-20 at :182).
  - The restore hold is stated as the spec's choice, to be recorded in ADR 0027 (:146, :172).
- **Other security properties hold.**
  - Redaction passes through `redactForSend` on every send, with the hash recomputed over the redacted bytes (:117).
  - `last_error` goes through `redact`, and the log never carries a token, code or payload (:150).
  - Received memories are `imported` rows and received entries sit in their own table, so they never travel on (:127, :134).
  - The received tree is under the store's guards (:134).
  - The restore keeps the token file outside the backup, and a failed carry holds the sweep and the pull (:146).
  - `remove` forgets the token and says the device stays on the server until an admin revokes it (:97).
- **Preference, not a return.** The NFR line (:207) says "https outside loopback; no redirect followed". Only the pull's `redirect: "error"` is spelled out (:123). AC-15 covers join. The plan's client task could state that `redirect: "error"` applies to join, `/v1/me`, push and withdraw too.
