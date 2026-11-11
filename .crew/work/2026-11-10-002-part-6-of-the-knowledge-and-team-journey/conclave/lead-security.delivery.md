# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: delivery
verdict: returned
## Returns
- R-1 · docs/adr/0027-sync-client.md:102 · The "Known limits" paragraph must list the security limits this delivery leaves open. The judgement carries them at report.md:165-171, but the ADR, the project's lasting record of what is left, states only some of them. These four are missing:
  - (a) **Muted or unbound memories reach the agent through search.** A received memory becomes an ordinary `memories` row (src/sync/inbound.ts:262). `memory_search` does not check mutes or bindings, so a muted member's note, or the note of an unbound alias, still reaches the agent. ADR 0027:60 describes the mute only for the knowledge reads and the brief and prompt. A reader would conclude that muting hides a teammate from the agent everywhere.
  - (b) **A teammate's memory can go to TypeSafe.** With TypeSafe on, a received memory can be sent to the person's TypeSafe provider as a consolidation neighbour (src/distill/consolidate.ts:50). This data leaves the machine and is not in ADR 0025's ledger.
  - (c) **Received memories skip the binding check.** A received memory is filed under any enabled project that holds the alias, with no `aliasBoundTo` check (src/sync/inbound.ts:216). The entry path does make that check (`readsRange`, inbound.ts:316-321).
  - (d) **The pull's answer is trusted as sent.** Its items get no shape check, and the body is read whole with no size cap (src/sync/client.ts:240, src/sync/inbound.ts:137). A hostile or compromised server can make the sync process exhaust its memory.

  Add one sentence each, plus the fact that `--code` on the command line reaches shell history and `ps` (src/cli/commands/share.ts:421; ADR 0027:42 names only the no-echo prompt). The other two advisories are already recorded and need nothing: `remove` leaving the device valid (ADR 0027:42) and the erasure after a restore waiting for `sync --once` (ADR 0027:68, :106). This is a documents-only change. No code has to move.
## Notes
- **Token file.** It is written through `writeFileAtomic`, which opens the temporary file at 0600 with `wx` and then renames it (src/util/atomic-write.ts:9). It is changed under the store's write lock (src/sync/servers.ts:72-79). It is never stored in a table, and the backup does not copy it (src/backup/ has no reference to `servers.json`). Tests:
  - tests/unit/sync-servers.test.ts:76-86: mode 0600, and the token absent from the store's bytes.
  - tests/integration/sync-join.test.ts:101, :120, :438-453: the token in no command output.
  - tests/integration/ui-servers.test.ts:170, :185: the token in no route answer.
  - tests/integration/sync-status.test.ts:370: the token not in status.
- **URL and redirects.**
  - `checkServerUrl` refuses credentials, a path, a query or a fragment, and `http:` outside loopback (src/sync/client.ts:31-47).
  - `isLoopback` matches only literal `localhost`, `127.x.x.x` and `::1` (src/team/contract.ts:153-157).
  - Every request uses `redirect: "error"` (client.ts:225), which covers join, me, push and pull. That answers my spec-round preference.
  - The join sends no bearer token (client.ts:159).
  - Tests: tests/integration/sync-client.test.ts:82 (`localhost.example.com`) and :251-268 (a redirect fails).
- **Invitation code and errors.** The no-echo prompt is the fallback (share.ts:421). A token or invitation that lands in `last_error` is caught by the `team-token` and `team-invitation` rules (src/core/redact.ts:60-61) applied in src/sync/state.ts:164, :248.
- **What leaves.** Entry frontmatter and body, and memory title and body, go through `redactForSend`, and the hash is taken over the redacted bytes (src/sync/outbound.ts:210-226, :264-267). Received memories are `imported` rows, which `decide` keeps with `imported` (src/sharing/policy.ts:396), so they never travel on.
- **Nothing before the yes.** The sweep, the pull and the spawn read confirmed rows only (src/sync/servers.ts:282-284). A pending row is replaced only while still pending (servers.ts:360-364).
- **What is received.**
  - Every path component the server supplies is checked against a grammar (src/sync/naming.ts:11-15, :87-90).
  - A server id outside the grammar is refused before anything is written (src/sync/join.ts:143-148).
  - A file whose hash is not the server's is refused (src/sync/received.ts:154-155).
  - Folders are made through real folders only, at 0700, and linked roots are refused (received.ts:120-127, :157-161). Tested at tests/integration/sync-received.test.ts:619 and :1119.
  - Teammates' names reach the agent only through `agentName` (src/modules/knowledge/received-ref.ts:18-34, src/retrieve/received.ts:62, src/sync/conflicts.ts:138). This closes round 1's F-3.
- **Visibility in brief and prompt.** `receivedMarks` hides rows of a muted server or member and of an unbound project (src/retrieve/received.ts:39-57). It now covers the linked pools in src/retrieve/brief.ts:161-166 and src/retrieve/prompt.ts:131-139, which closes round 1's two defects.
- **Erasure.**
  - `remove` deletes the server's folder, received rows and memories, ledger rows, hold key and authorised list in one transaction, then the token (src/sync/join.ts:340-356, src/sync/ledger.ts:770-780).
  - `deleteReceivedMemory` resets the `superseded_by` pointers and cascades through `memory_vectors` with foreign keys on (src/store/memories.ts:239-262, src/store/migrations/0006_vectors.sql:5, src/store/db.ts:365).
  - The restore clears copied hold keys and authorised lists (src/backup/backup.ts:237).
- **Viewer routes.** Every route needs the viewer token (src/ui/server.ts:280-282). Answers carry no token (src/ui/servers-api.ts:68-87, :164-182), and a widening of server lists still needs `confirm` in the store (servers-api.ts:248-253).
- **Gates.** Security is proven on the final tree (report.md:156) and the secrets scan passed (report.md:141). The test-quality "not proven" rests on AC-85 alone, which is outside this team.
- **Not a return.** The replaced store `<db>.replaced-<time>` that a restore keeps, and existing backups, still hold teammates' received copies after a later `remove`. This is restore and backup behaviour from before this part. Part 7's runbook could say so.
