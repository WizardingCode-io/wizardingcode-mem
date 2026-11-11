# architects lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/plan.md:104 · The parenthesis at the end of the negative list is wrong for three of its six files, and as written it points an implementer at an import the boundary test forbids.
  - The list says `src/status/report.ts`, `src/doctor/checks.ts`, `src/ui/server.ts`, `src/ui/api.ts`, `src/sync/join.ts` and `src/modules/knowledge/tools.ts` "name no sharing table (they read the server rows through `src/sync/state.ts`)".
  - `src/modules/knowledge/tools.ts` must not import `src/sync/` (the same line, and spec.md:89). It gets the server name through `serverByName` in `index-store.ts` (plan.md:97).
  - `src/ui/api.ts` reads levels through the policy functions of `src/sharing/` (plan.md:88).
  - `src/sync/join.ts` is inside the client and reaches the server rows through `servers.ts`, the ledger's tables through `ledger.ts`, and the policy tables through the two `src/sharing/store.ts` functions (spec.md:83).
  - If the parenthesis is followed literally, `tools.ts` imports `state.ts`, and the boundary test fails.
  - What must change: replace the parenthesis at plan.md:104 with the route for each file.
    - `status`, `doctor` and `src/ui/server.ts` read the server rows through `src/sync/state.ts`.
    - `src/ui/api.ts` reads levels through `src/sharing/`.
    - `join.ts` goes through `servers.ts`, `ledger.ts` and the two `src/sharing/store.ts` functions.
    - `tools.ts` goes through `serverByName` in `index-store.ts`.
## Notes
- The ownership list is otherwise complete against the file plan, and a test written from it passes on the planned tree.
  - `removeServerLevels` and `logServerChange` are named in the `src/sharing/` entry (spec.md:83), the `remove` and mute paragraph (spec.md:107) and plan tasks 7 and 8 (plan.md:84 and :88).
  - `src/sharing/` is described as "its own reads and writes", with `destinationsOf`, `boundServerOf`, `loadPolicy` and `ledgerRecords` named (spec.md:83).
  - `ledger.ts` is "the statements over the ledger's seven tables" (spec.md:82).
  - `serverByName` is in `index-store.ts` (plan.md:97). It is the one place `knowledge_get` resolves a server name, so the reading files stay at four: `index-store.ts`, `contribute.ts`, `brief.ts` and `notes.ts`.
  - The negative list adds `src/ui/api.ts`, `src/sync/join.ts` and `src/modules/knowledge/tools.ts` (plan.md:104).
  - `state.ts` reads the open conflicts and the pending rows through `ledger.ts`, the only file that names those two tables (plan.md:110).
  - The files not named in either list (`outbound.ts`, `inbound.ts`, `received.ts`, `conflicts.ts`, `run.ts`, `client.ts`, `share.ts`, `knowledge.ts`) reach the tables through `ledger.ts`, `servers.ts`, `state.ts` or the sharing functions, so an "only in" test passes on them.
- One consequence to keep in mind when the test is written, not a return. The test pins nine of the eleven sharing tables: the seven ledger tables, `sharing_servers` and `sharing_muted_members`. `sharing_levels` and `sharing_changes` are covered by the rule that `join.ts` names neither (spec.md:83), and by the knowledge module's read of `sharing_levels` (spec.md:84). A grep over `src/` outside `src/sharing/` shows the current code names none of them, so adding both to the "only in" list costs nothing and closes the gap.
- The schema versions (sharing v2, knowledge v8, `user_version` 7), the import boundaries (spec.md:89) and the criteria numbering are unchanged from last round.
