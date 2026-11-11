# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 12). I read the ownership bullet at :83 and the exceptions at :84 to :88, the import-boundary bullet at :89 and the client inventory at :82. I did not re-read the rest of the spec or plan.md. The coordinator states that no rule of what leaves, no DDL and no criterion changed, and I took that as given.

- **What leaves is unaffected.** The ownership rule decides which files hold SQL over the sharing tables (:83). It does not change a payload, a policy or a send decision. The `pinned` line, `redactForSend` and the hash rules are untouched (round 10).
- **The token.** The rule says `status`, `doctor` and the viewer's routes read the server rows through `state.ts` and name no sharing table (:83). The token is not in any table, so none of them can read it from the database. It stays in `servers.json` (:97). The routes' no-token guarantees from round 10 still hold (:241, :266).
- **The hook path.** `spawn.ts` holds the hook's one statement over `sharing_servers` (:83). Nothing else under `src/sync/`, and not `src/backup/carry.ts`, runs on a hook path (:89). The network stays off the hooks (D-1, :52).
- **Redirects and loopback, path components, the pin, the 403, the re-join and D-9.** These were not touched by this revision and hold as validated in round 10.
- **Narrower surface.** Ledger SQL is confined to `ledger.ts` (:83), and the exceptions are named one by one (:84 to :88). A boundary test pins that. This reduces the chance that a stray statement reads or writes the sharing tables outside the policy's checks. The read-only readers in the knowledge module and the retrieval are still limited to `sharing_servers`, `sharing_muted_members`, `sharing_levels`, `sharing_conflicts` and `sharing_received_memories` (:84, :85). None of them reads a token or sends anything.
