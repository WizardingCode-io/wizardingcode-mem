# code-quality findings for 2026-11-08-001-record-why-the-drain-skips-a-turn-saved
reviewer: review-code-quality
read: 9 files, 17 hunks (read from the diff alone; no file outside it was opened)

## Findings
- F-1 · defect · src/distill/pipeline.ts:~335 · `const reason = skipped ?? "empty"` has an unreachable fallback. `draftTurn` returns `skipped` non-null whenever `verdict` or `draft` is null, so the `?? "empty"` hides a broken invariant instead of stating it. It fails Q4 (dead path) and Q9 (a guard for a case the code cannot reach). Returning a discriminated result from `draftTurn` would remove it.
- F-2 · advisory · src/status/report.ts:243 · The zero-filled literal `{ saved: 0, empty: 0, notWorth: 0, noTitle: 0, unknown: 0 }` repeats `noneSkipped()` from `skips.ts`; `{ ...noneSkipped(), unknown: 0 }` would do (Q2).
- F-3 · advisory · src/distill/pipeline.ts:~323 · `finish` tests `state === "done"` twice in one array literal to map the outcome to the state and to the stored mark. It is readable, but a small helper or two branches would show the intent better (Q1/Q5).
- F-4 · advisory · tests/integration/distill.test.ts:1091 · The describe title "(findings row 11)" points at a tracking row that has no use once the work is done (Q10).
- F-5 · advisory · tests/integration/distill.test.ts:324 · The `NONE` constant repeats `noneSkipped()` from `skips.ts` (Q2).

## Outside the change
- none

## Not answerable
- none
