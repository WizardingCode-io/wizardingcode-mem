# code-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-code-quality
read: 31 files (every non-test hunk of the item's patch in full: docs, src/, ui/src/, tests/preload.ts; `src/doctor/checks.ts` read in the tree), about 75 hunks

## Findings
- F-1 · defect · src/cli/commands/share.ts:114 · `policyInForce` (load, return if closed, `reconcileSettings`, `reconcileLevels`, load again) is the same logic as `policyInForce` in src/ui/api.ts:916, and the CLI's `requireLoaded` (share.ts:123) builds the same refusal text as `sharingRefusal` (src/ui/api.ts:906). That is logic written twice where one call from `src/sharing/` would do. ADR 0025 also says part 6's sync must run this same sequence, which would make a third copy (Q2).
- F-2 · defect · src/doctor/checks.ts:898 · The `catch` in the `sharing` check cannot be reached. `loadPolicy` wraps all of its reading in its own try and never throws, and `isDefault`, `projectsAt`, `shareListText` and `plural` are pure. The docstring's reason for the try ("a store may still lack the sharing tables") is already handled inside `loadPolicy` through `hasLevelsTable` and `noStore` (Q4/Q9).
- F-3 · advisory · src/sharing/policy.ts:275 · `loadPolicy` takes `_now`, which its own docstring says "no step reads it", so every caller passes a dead argument. The codebase has the same pattern elsewhere (src/mcp/global.ts:114, src/judge/breaker.ts:45), so this is not a break from convention (Q4/Q5).
- F-4 · advisory · src/sharing/store.ts:215 · Only tests call `previewLevel`. The viewer works out a widening itself (ui/src/components/ProjectsView.vue:122, with `LEVELS.indexOf`), and the CLI relies on `setLevel`'s `needs-confirm`. Yet ADR 0025 (§ Changes, confirmation and the hand edit) describes `previewLevel` as the check every path makes before it asks (Q8; the record does not match the code).
- F-5 · advisory · ui/src/components/ProjectsView.vue:122 · `LEVELS.indexOf(level) < LEVELS.indexOf(p.sharing)` repeats `widens` from src/sharing/types.ts, which ui/src/api.ts already re-exports alongside `LEVELS` and `LEVEL_LABELS` (Q2).
- F-6 · advisory · src/sharing/report.ts:32 · `export { memoryHash }` re-exports something nothing imports from report.ts; the tests import it from hash.ts (Q8).
- F-7 · advisory · src/sharing/levels.ts:89 · `policyWith`, documented as "A hand-built policy, for tests", ships in a production module that only tests import. `resetSharingLog` (policy.ts:264) is the same kind of test hook (Q8).
- F-8 · advisory · src/sharing/report.ts:86 · `tableExists` runs the same `sqlite_master` lookup as `hasLevelsTable` (src/sharing/store.ts:144), which report.ts also imports. One helper would cover both (Q2, boilerplate).
- F-9 · advisory · src/sharing/report.ts:159 · `rootOf` writes out the rule "the shared repository's own areas, the workspace's for everything else" that `entryRefusal` also writes inline at src/sharing/policy.ts:332. If the rule changes, both places must change (Q2).
- F-10 · advisory · src/status/report.ts:170 · The two sharing key names are declared again here, in `LIST_KEYS` (src/cli/commands/share.ts:168), in `ROOTS_KEY`/`AREAS_KEY` (src/sharing/store.ts:42, src/sharing/patch.ts:8) and in Sharing.vue, while settings.ts keeps `SHARE_ROOTS`/`SHARE_AREAS` private and exports only `SHARING_KEYS` (Q2, boilerplate).
- F-11 · advisory · ui/src/components/settings/Sharing.vue:29 · The comment on `removed` says "the next save leaves them out of the list". In fact `buildSharingPatch` drops every inert id on every save, so the Remove button only hides a row, and the name and comment suggest an effect the button does not have (Q3/Q10).
- F-12 · advisory · src/doctor/checks.ts:865 · `projectsAt` here returns a count of projects at one level. `projectsAt` in src/sharing/report.ts:295 returns project ids that pass a predicate. Two units of the change share one name with different meanings (Q3).
- F-13 · advisory · src/cli/commands/install.ts:110 · `confirm` is now a one-line wrapper around `askYesNo(question, true)`, a layer that only forwards (Q5).

## Outside the change
- none

## Not answerable
- Questions 1–11 on the test files of the patch (`tests/unit/sharing-*.test.ts`, `share-confirm`, `status-sharing`, `doctor-sharing`, `ui-sharing-copy`, `tests/integration/sharing-cli`, `ui-sharing`, `backup`, `module-migrations`, `settings`) · their hunks (patch lines about 4110–10724) were not read line by line, so they are covered only by the grep checks on exports and helpers above.
- Question 7 · `review/inputs.json` was not read; the item's patch touches no `package.json`.
- Question 11 on the commit messages · the six commits' bodies were not read; only their subjects were given.

Patch reviewed: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/round-one-change.patch
