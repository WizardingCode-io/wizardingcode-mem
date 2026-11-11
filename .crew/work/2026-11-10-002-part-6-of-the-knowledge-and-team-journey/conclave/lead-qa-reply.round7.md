# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- AC-47 (spec.md:182) is testable as written.
  - A folder left by a `remove` that crashed is deleted at the sync's start, and a linked or unreadable one is refused. Plan task 13 (plan.md:97) carries "folder left by a crashed `remove` deleted at the start and a linked one refused".
  - The searches, `knowledge_get` and the brief return nothing of a server with no `sharing_servers` row. This is checked in the retrieval's own SQL (plan.md:96, 98) and listed on the case line at plan.md:127 ("crashed `remove`'s folder").
  - Plan task 16 (plan.md:103) has the start-up deletion, then `reindexReceived` over listed servers only.
  - The 50 ms lock bound is still measured on wall time (plan.md:3).
- AC-48 (spec.md:184) is testable as written.
  - The restore's report names the pending deletion, and the searches and the brief return none of that server's items before the sync's start (plan.md:107).
  - The case line at plan.md:129 carries it.
  - A restore whose copy holds an unlisted server, followed by a search before the sync starts, is a deterministic in-process assertion.
- The remaining criteria are unchanged since round 7.
  - The preserve and observed criteria (AC-27, AC-33, AC-34) keep their `crew tdd` runs at phase I.
  - AC-44 and the other criteria stand as validated.
