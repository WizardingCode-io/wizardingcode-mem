# security lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: validated
## Returns
none
## Notes
- Round-3 return applied, and it holds against the code. `src/team/routes.ts:89-94` decodes a `:param` with `decodeURIComponent` and returns `null` when it throws. `routes.ts:505-509` finds no matching route, so the same-route list is empty. It answers `problem(404, "not found")`, never a 400 or a 500, and the handler is never reached. This is the wording at `spec.md:154` ("the router's `match` already answers its own 404 `not found`…, a 404 too and never a 400 or a 500"). AC-25 at `spec.md:272` asserts the body, the `%E0%A4%A` case answering the router's own 404 `not found`. The `unknown-name` body is kept for a malformed alias, a `remote:` alias and an unheld name, with no SQL for the first two. The route still cannot be used to probe for a remote.
- Side effect, not a return: a malformed escape on a method the route does not serve also gets 404 rather than 405. It leaks nothing.
- The architects' change is consistent. `bindName` lives in `src/sync/binding.ts` at `spec.md:112`. That is the sync client's side of the boundary, so `src/sharing/` does not learn the client. It names no sharing table in SQL and reaches the tables through `setLevel` and `servers.ts`. `hooks.afterServer` is the only seam, unset in production. The viewer route at `spec.md:193` and AC-22 and AC-23 (`spec.md:276-277`) refer to it the same way.
- Nothing else moved on the security side:
  - The confirmation by name at every level, Receive only included (`spec.md:104`, AC-22, AC-23).
  - The names list shows names only, paged, under the devices bucket, with `after` judged by `isSharedName` (`spec.md:152-153`).
  - The operator's erasure, `serve purge name`, with its stated limit (`spec.md:158`, AC-25, AC-24).
  - The registry check inside the push transaction (`spec.md:156`, AC-16).
  - Contract 2 with 1 accepted, and names held (`spec.md:162-166`).
  - Rollback by refusal: store version 8 and team schema 2 (`spec.md:259-263`, AC-2, AC-25).
- Criteria list: AC-2, AC-3, AC-4, AC-8, AC-11, AC-13, AC-14, AC-16, AC-17, AC-22, AC-23, AC-24 and AC-25 are all present, and each is observable.
