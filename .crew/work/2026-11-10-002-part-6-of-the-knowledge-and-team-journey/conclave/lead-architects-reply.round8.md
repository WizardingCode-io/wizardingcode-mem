# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- My round-7 return is answered. The knowledge module reads and returns only rows of a listed server, one with a `sharing_servers` row. The ownership stays where it was.
  - spec.md:134 says "for listed servers only (one with a `sharing_servers` row, by the module's own SQL over that table, the one it reads for the mutes)". spec.md:138 says the same for received memories.
  - plan.md:96 puts the filter in `searchEntries` and `browseEntries` in `src/modules/knowledge/index-store.ts` ("importing nothing of `src/sharing/` or `src/sync/`").
  - plan.md:98 puts it in `src/retrieve/brief.ts` and `src/retrieve/notes.ts`, "by the retrieval's own SQL".
  - The boundary sentence at spec.md:80 is unchanged, and the boundary test (plan.md:74) still pins it.
- The folder deletion stays in `src/sync/received.ts` under the store's guards.
  - `deleteServerReceived` (plan.md:96) is the one owner. `remove` calls it (plan.md:99) and so does the sync's start (plan.md:103), for a server id with received rows or with a `received/<serverId>/` folder, but no `sharing_servers` row.
  - The folder is read through `lookAt`, `kindAt` and `namesIn`, and a link or an unreadable folder is refused. That agrees with the guards paragraph at spec.md:134.
  - `reindexReceived` covers listed servers only (plan.md:96, plan.md:103). So it never reindexes a folder that `deleteServerReceived` is about to remove.
  - The start's order is the same in spec.md:109 and spec.md:146 and in plan task 16 (plan.md:103): `completeOwedCarry`, then `deleteServerReceived`, then `reindexReceived`. It also runs under `sync --once` with no server listed.
- The import directions are unchanged. `src/backup/carry.ts` touches sharing tables only. `src/sync/run.ts` is the only importer of `src/backup/`. `src/backup/` never imports `src/sync/`, and the knowledge module and the retrieval import nothing of `src/sync/` or `src/sharing/`.
- The criteria agree with the spec and the plan.
  - AC-47 (spec.md:182, supersedes AC-45) carries the orphan-server case: "the searches, `knowledge_get` and the brief return nothing of a server with no `sharing_servers` row". It also carries the crashed-`remove` folder deleted at the start, and a linked or unreadable folder refused.
  - AC-48 (spec.md:184, supersedes AC-46) has the restore case.
  - The plan's phase headers and test lines use AC-47 and AC-48 (plan.md:94, plan.md:97, plan.md:105 and plan.md:127-129).
  - AC-44 (`remove`) and its delete list are unchanged since the last round.
- Two small drafting notes, not returns.
  - The sentence at spec.md:134 lists `searchEntries`, `browseEntries` and the floor under "for listed servers only", but `knowledge_get` is only named in the following clause. AC-47 and plan.md:97 do cover `knowledge_get`. Make the by-reference read explicit in ADR 0027, so that `knowledge_get` and `knowledge take` are not forgotten when the filter is written.
  - The schema versions (sharing v2, knowledge v8, `user_version` 7) and the eight carried tables are unchanged and agree across the spec, the plan and the criteria.
