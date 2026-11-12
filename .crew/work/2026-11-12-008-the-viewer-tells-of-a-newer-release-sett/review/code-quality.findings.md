# code-quality findings for 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett
reviewer: review-code-quality
read: 22 files, 31 hunks

## Findings
- F-1 · advisory · ui/src/update.ts:1116 (diff line; file line 12) · The doc comment says "api.ts re-exports the type", but `ui/src/api.ts` only does `import type { ViewerUpdate } from "./update"` (line 3) and re-exports nothing, unlike its neighbours on lines 13-16. The comment states something the code does not do (Q10/Q11). Either add the re-export or drop the clause.
- F-2 · advisory · ui/src/update.ts:1162 (diff line; file line 58) · `releaseStatus` picks out a report that could not be built by matching the server's literal prefix `"not checked: "` (`NOT_BUILT`, copied from `src/ui/update.ts:185`). The two files are tied by a string the type does not carry, so rewording the server's line silently changes the tone. A field in `ViewerUpdate` would hold the same fact (Q5/Q6).
- F-3 · advisory · ui/src/update.ts:1164-1165 (diff lines; file lines 60-61) · The `failed` predicate re-writes `lastFailed` from `src/update/state.ts:49-51` (a file this diff does not touch) in the client. The server already has the report's `lastFailed`, so it could send the fact instead (Q2). The duplicate is one expression, and `state.ts` loads `node:fs`, which keeps the browser from importing it.
- F-4 · advisory · ui/src/components/settings/About.vue:1035 (diff line) · The switch `daily` reads on whenever the value is not `"off"`. With an unknown value (`mode: "off-unknown"`, the status line says "off") the switch shows "Check for new releases once a day" as on while no check runs. The name and the state it shows disagree in that one case (Q3). Reading `updateState.value?.mode` would make them agree.
- F-5 · advisory · src/ui/update.ts:134-154 (diff lines) · `ViewerUpdate` is declared twice: on the server here and on the client in `ui/src/update.ts:1117-1133` (diff lines). Nothing keeps the two in step, and the client spells `Mode` out as a literal union instead of importing it from the leaf `src/update/mode.ts`, even though `api.ts` already imports leaves from `../../src/sharing/` (Q2, boilerplate).

## Outside the change
none

## Not answerable
none
