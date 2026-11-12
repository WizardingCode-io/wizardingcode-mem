# security lead's validation of 2026-11-12-007-three-tests-fail-intermittently-on-the-m: spec
verdict: validated
## Returns
none
## Notes
- The sorting by class in `.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/spec.md:13-14` now matches the code. The store's lost lease is a `KnowledgeError` with code `locked` (`src/modules/knowledge/repo.ts:1396-1397`), raised by the renew at `repo.ts:454` before git is spawned, so swallowing it runs no git without the lease and keeps `commitChange`'s catch (`repo.ts:1161-1173`) away from a landed commit. This closes the inaccuracy I noted last round.
- The mirror's lost lease goes on to the caller, as the spec says: `MirrorLeaseLostError` extends `Error`, not `KnowledgeError` (`src/team/mirror.ts:99-104`), is thrown by the host's renew (`mirror.ts:394-396`) and is already rethrown as itself by the per-repository wrapper (`mirror.ts:231`). The mirror never continues in a repository after losing its lease.
- AC-12 (`spec.md:38`) proves both sides of that sorting, store and mirror, and each is observable: tree equal to HEAD in the store, the run stopping with its lost-lease error in the mirror.
- "Seven call sites" (`spec.md:12`) is correct: `repo.ts:761` and `:1152`, `src/modules/knowledge/store.ts:1099`, and `mirror.ts:159`, `:245`, `:278`, `:289`.
- AC-13 (`spec.md:39`) closes a gap in AC-6: the trace showed the command ran, not that it did anything while `maintenance.auto=false` rides on the same call. The `gc.auto=1` it needs is given by the test's host, not added to `configArgs`, so the product's settings stay the three named.
- Unchanged and still holding from my last validation: AC-10 keeps ADR 0024's known limit open (`spec.md:41`, `docs/adr/0024-knowledge-module.md:193`); the Risks and Out of scope sections state the timeout's leftovers (`spec.md:48`, `spec.md:62`); the settings stay on `-c` and out of `.git/config` (`spec.md:18`); the trace goes through the tests' stub, not `gitEnv` (`spec.md:22`).
- Carried to the delivery: the mechanism inside D-1 changed without a new answer from the author, and the conclave says the author is told in the delivery. I will check that notice there.
