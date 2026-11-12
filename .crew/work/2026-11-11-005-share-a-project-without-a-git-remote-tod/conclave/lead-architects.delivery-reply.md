# architects lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: validated
## Returns
none
## Notes
- **R-1 is applied.** Every `PUT /api/projects/<id>/sharing` now goes through `prepareBinding` (src/ui/api.ts:1299) and then `commitBinding` (src/ui/api.ts:1307), with `as` or without it. This is the same path src/cli/commands/share.ts:265-295 takes, so the viewer and the CLI share one bind.
  - The branch that called `setLevel` directly is gone.
  - Across `src/`, `setLevel` is now called only from src/sync/binding.ts:269 and :339 and from the preview's dry run (src/ui/api.ts:1254).
  - The doc comment at src/ui/api.ts:1272-1282 describes that one path.
- **The no-`as` case binds through the registry.**
  - A project at Nothing that still carries a name gets that name from `prepareBinding`, through the dry run's `boundAlias` (src/sync/binding.ts:282).
  - Without `confirm`, `commitBinding` refuses `needs-confirm` before any POST (src/sync/binding.ts:357).
  - With `confirm`, the level row stores the registry's id.
  - The test proves all three: tests/integration/ui-sharing.test.ts:1065-1091 checks the 400 `needs-confirm`, an unchanged POST count, the 200 `joined: true`, and `nameId: w.nameId` on the row.
  - The re-created check in src/sync/inbound.ts:180 therefore has an id to compare against.
- **Nothing that needs no server step changed.** A remote, Nothing, or a level change on a name already bound answers `action: "none"` (src/sync/binding.ts:292-306). The write then runs with the request's own `confirm`, so `needs-confirm` on a widening still holds (src/sharing/store.ts:560).
- **The answer adds keys, it does not rename any.** Every answer carries `level`, `old`, `boundAlias` and `sharedName`. It adds `named`, `created` and `joined` only after a server step (src/ui/api.ts:1309-1323).
- **I agree with keeping the architecture review's two round-4 advisories as advisories:**
  - The viewer passes no `remoteAlias`. It has no working directory to give, and `setLevel` then falls back to the project's first host-led remote (src/sharing/store.ts:543-551).
  - The additive keys are read by no other code.
- **Boundaries are unchanged from my round-1 notes:**
  - The identity leaf has no imports (src/core/identity.ts).
  - src/team/contract.ts:5 imports the leaf.
  - The quiet list holds `src/sync/binding.ts` (tests/unit/sync-boundary.test.ts:181).
  - src/sharing/ imports nothing of src/sync.
- **Gates.** report.md:8 reads Proven. The latest gate run passed build, test, lint and typecheck (report.md:56-59). All seven judgement gates are proven in review/ruling.json.
