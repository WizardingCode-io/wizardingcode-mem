

## Clarifications
- # test-quality findings for 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett
  reviewer: review-test-quality
  read: 5 test files, 8 criteria
  
  ## Findings
  none
  
  ## Outside the change
  none
  
  ## Not answerable
  none
  
  Round 2. I re-read the five test files, `ui/src/update.ts` and the new `updateReport` option in `src/ui/server.ts` (lines 125 and 851), and checked the re-recorded reds in evidence.json. Each round-1 advisory is closed:
  
  - **F-1 (AC-8):** tests/integration/ui-update.test.ts:240 now goes through the route. It starts the viewer with `startUi`'s `updateReport` set to throw, then checks status 200, `built` false, `out` and `banner` false, no commands, and the error's first line. The new AC-8 red (22:25) is a real behaviour failure: the route answered `line: "not checked yet"` and no `built` field.
  - **F-2 (AC-10):** tests/integration/ui-update.test.ts:297 wraps `fetch` before `start({})`. `seen.length` must be exactly 3, so a request made when the viewer starts would also fail the test.
  - **F-3 (AC-10):** tests/unit/update-boundary.test.ts:11. The import regex now also matches template-literal specifiers.
  - **F-4 (AC-11):** tests/unit/ui-update.test.ts:155. Each state now asserts a literal `{ text, tone, sign }` with `toEqual`. Line 177 checks that the tone follows the `built` and `failed` fields, not the wording of the line.
  - **F-5:** `agentsNote` (line 184), `channelRows` (line 203) and `checksDaily` (line 249) now have assertions that would fail if their behaviour were reverted. The AC-11 red (22:25) was recorded before `channelRows` existed.
  
  AC-15 (observed): the recorded reason is that being seen can only be shown by a capture, with no browser harness and the e2e gate skipped by the author's standing decision. That holds. The states' texts, tones and signs are held by AC-11's tests, which have a red and a green. The counting command only shows that the 30 captures exist, which is all the criterion adds.
  
  AC-9, AC-12, AC-13 and AC-14 are unchanged from round 1 and still sound.
  
  Files reviewed:
  - /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/ui-update.test.ts
  - /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/ui-update.test.ts
  - /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/update-boundary.test.ts
  - /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/update-docs.test.ts
  - /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/update.ts
  - /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/server.ts
