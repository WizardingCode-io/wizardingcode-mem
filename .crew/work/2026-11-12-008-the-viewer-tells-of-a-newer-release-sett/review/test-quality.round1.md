# test-quality findings for 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett
reviewer: review-test-quality
read: 5 test files, 7 criteria

## Findings
- F-1 · advisory · tests/integration/ui-update.test.ts:201 · AC-8 says a builder that throws gives "200 with the shape". The test calls `viewerUpdate` with its own `build` directly, so neither the route nor the 200 status is checked. The `/api/update` route at src/ui/server.ts:842 passes no builder. The test still fails if the catch is reverted, so this is rubric question 5, not 1. A case through the route (for example an unreadable `update.json`, if `updateReport` throws on one) would close the gap.
- F-2 · advisory · tests/integration/ui-update.test.ts:267 · AC-10's network test wraps `globalThis.fetch` only after `start({})` has returned. A regression that starts a check when the viewer starts, and not inside the two routes, would get past it. The test does fail if either route calls `checkForRelease`, which is what the criterion's wording asks. Wrapping before `start` would also cover startup.
- F-3 · advisory · tests/unit/update-boundary.test.ts:778 · AC-10's walk uses the existing `imports` regex (line 10), which only matches quoted specifiers. A dynamic `import(\`../update/check.ts\`)` written with a template literal would not be followed. The positive controls at 793–794 show the walk itself is real.
- F-4 · advisory · tests/unit/ui-update.test.ts:117 · AC-11 status cases: the expected text is built from the fixture by the same capitalise formula the code uses (ui/src/update.ts:28). It mirrors the implementation instead of stating literal strings. Each tone is a literal and fails on reversion. The text would still fail if the capitalise step were removed, but not if both sides were changed the same way.
- F-5 · advisory · tests/unit/ui-update.test.ts:146 · `agentsNote` (ui/src/update.ts:61) produces the About card's agents line (About.vue:27) and no test exercises it. AC-11 does not list the agents line, so it is not a defect.

## Outside the change
none

## Not answerable
- Rubric question 1 for AC-11's second sentence (About card, banner over /memories and the marked list at 360/768/1280 in light and dark) · these are screen captures, not tests. The wiring of `bannerShort`, `releaseStatus` and `aboutMark` into UpdateBanner.vue, About.vue and Settings.vue has no test, and the spec says the clicks are not tested. Whether this holds is for the capture/design review.

Per criterion:
- **AC-8:** each state has an assertion that fails on reversion. That includes "release out" with the exact four commands and `banner` true, and `off-unknown`, `ci`, unchecked, failed, and off in the file versus off from the environment (`fromEnvironment`). The staged binary case is skipped on Windows and as root, as the spec says.
- **AC-9:** covers banner off after dismiss and back on for a later release, nothing kept in `meta` when no release is known, and a body naming another version being ignored. Each would fail if reverted.
- **AC-10:** the import walk and the fetch counter are both real.
- **AC-12:** covers off and check through PUT, the env file written and the mode followed, plus a 400 for an invalid value.
- **AC-13:** the doc assertions are specific, and the recorded red failed on the README itself.
- **AC-14 (preserve):** the named suites ran green before and after (72 to 74 tests). The diff only adds tests to update-boundary.test.ts and does not change the existing ones.

No defects. No fixture uses a real name. No mutation report was supplied.

Files reviewed:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/ui-update.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/ui-update.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/update-boundary.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/update-docs.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/update.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/update.ts
