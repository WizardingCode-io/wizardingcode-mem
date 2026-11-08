# code-quality findings for 2026-11-08-001-record-why-the-drain-skips-a-turn-saved
reviewer: review-code-quality
read: 8 files, 17 hunks

## Findings
- F-1 · advisory · src/status/report.ts:271 · The `skip:` prefix is written by `skipMark` in pipeline.ts but parsed here with a bare `startsWith("skip:")` and `slice(5)`. The format knowledge is split across two modules (rubric question 1/2); a `parseSkipMark` next to `skipMark` would keep it in one place.
- F-2 · advisory · src/distill/skips.ts:590 · The four reason keys are spelled out in `SkippedBy`, `SKIPPED_KEY` and `noneSkipped`. Adding a reason means editing three places (question 2, boilerplate).
- F-3 · advisory · tests/integration/distill.test.ts:344 · The test file defines its own `NONE` object, which repeats `noneSkipped()` from skips.ts (question 2, boilerplate).
- F-4 · advisory · src/status/report.ts:273 · `SKIPPED_KEY[name as SkipReason]` casts an unchecked string to the union. The `Object.hasOwn` guard makes it safe, but the cast hides that (question 6).

## Outside the change
- none

## Not answerable
- none
