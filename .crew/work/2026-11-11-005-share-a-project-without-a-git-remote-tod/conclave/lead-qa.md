# qa lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: validated
## Returns
none
## Notes
- AC-25 (spec.md:272) is testable as reworded. `src/team/routes.ts:83-99`: `match` runs `decodeURIComponent` on a `:param` segment, and on a throw it returns `null`. `%E0%A4%A` is a malformed escape, so it throws. At `routes.ts:505-509`, `sameRoute` is then empty for `GET /v1/names/%E0%A4%A`, and the router answers `problem(404, "not found")` before any handler or SQL runs. The test can assert status 404 and the body `not found`. The criterion's own parenthesis, "a 404 too, never a 400 or a 500", is observable on the same response.
- The other `GET /v1/names/<alias>` cases in AC-25 still hold. A malformed but decodable alias such as `name:Bad`, and an encoded `remote:…`, reach the handler and get `unknown-name` with no SQL. The held-name case returns the item. The criterion keeps the two 404 bodies distinct (`unknown-name` and `not found`), so a test cannot confuse them.
- AC-22 (spec.md:276) and AC-23 (spec.md:277) are unchanged and do not depend on where `bindName` lives. They exercise it through `hooks.afterServer` (the in-process route and CLI cases) and through the outcome's message constant. Both are proven at the `bindName` call, not at its module path. The module move therefore changes nothing for them.
- AC-2, AC-3, AC-4, AC-8, AC-11, AC-13, AC-14, AC-16, AC-17 and AC-24 are as in my round-3 validation. The ids listed in spec.md:266 match the criteria present.
