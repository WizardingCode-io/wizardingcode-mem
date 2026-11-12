# architects lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-11-005-share-a-project-without-a-git-remote-tod/spec.md:112 · `bindName` must live in `src/sync/binding.ts`, not `src/sharing/binding.ts`. Change both path mentions on this line and in the file lists or tasks that name the new module (lines 276-277 mention `bindName`).
  - Layering: `src/sharing/` today imports nothing from `src/sync/` (grep of src/sharing finds no such import). The dependency runs the other way: `src/sync/join.ts`, `servers.ts`, `ledger.ts`, `outbound.ts`, `inbound.ts`, `received.ts` and `naming.ts` all import `../sharing/*`. `src/sharing/binding.ts` would import `sync/client.ts` and `sync/servers.ts`, and `servers.ts` imports `sharing/store.ts`. That makes a folder-level cycle between `sharing` and `sync`.
  - Design: CLAUDE.md and ADR 0025 describe the sharing policy as the layer the sync client sits on, so the policy must not know the client. ADR 0027's boundary is that the sync client holds the server calls, and `bindName` is a server call (create or join).
  - `src/sync/join.ts` already does "dry run, ask the server, write" for `share server add`, so `bindName` belongs beside it.
  - Tests: `tests/unit/sync-boundary.test.ts` does not forbid `src/sharing` → `src/sync`, so a file under `src/sharing/` would pass. That is a gap in the test, not permission. Under `src/sync/` the test's rules hold as they are: only `src/team/contract.ts` is imported from the team, and no `src/backup` or `src/cli` import.
  - Table rule: `src/sync/binding.ts` must not name any sharing table in SQL, the same as `join.ts` (the "quiet" list in the boundary test). It reaches the tables only through `setLevel` and `servers.ts`. State this on line 112, or add `src/sync/binding.ts` to that test's quiet list in the plan.
  - The viewer route (`src/ui`) and the CLI may import `src/sync/binding.ts`. The existing `join.ts` is already reached by both.
## Notes
- Everything else in revision 3 holds from my round 2. The test seam `hooks.afterServer`, supplied only by tests and left unset in production, is a reasonable single seam and matches `Context.contract` on the server. The race paragraph and AC-22 and AC-23 are consistent with a single shared function. The erasure statement (AC-21, AC-24) does not change the architecture.
- Once R-1 is applied nothing else is outstanding for the architects. It is a path rename plus the quiet-list note.
