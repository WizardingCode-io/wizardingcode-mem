# code-quality findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: review-code-quality
read: 5 files, 31 hunks

## Findings
- F-1 · defect · src/install/binary.ts:18 · The diff adds the parameter `timeoutMs = VERSION_TIMEOUT_MS` to the newly exported `stagedVersion`, but no caller passes it (binary.ts:52, reconcile.ts:95 and report.ts:30 all call `stagedVersion(path)`). That is a parameter nobody passes, which fails question 4 (dead paths).
- F-2 · defect · src/update/report.ts:98 · `updateCheck`'s fourth parameter `running: string = pkg.version` is never passed: doctor.ts:21 and the only test call (tests/integration/update-command.test.ts:176) both pass three arguments. This is another unpassed parameter under question 4.
- F-3 · defect · src/cli/commands/status.ts:20 · `catch { update = undefined; }` drops whatever `updateReport` threw (for example a `realpathSync` or settings read failure), so the release notice silently disappears from `status`. Its sibling in the same diff, `updateCheck` (report.ts:110-112), says `not checked: <message>` instead. This fallback hides its cause (question 9) and behaves differently from its neighbour (question 6); the fix is to show or log the reason the way doctor does.
- F-4 · advisory · src/update/report.ts:14 · `export type Source = "env" | "file" | "default"` repeats `Source` from src/settings/settings.ts:103, a module this file already imports `updateSetting` from, and nothing imports the new export (questions 2 and 8).
- F-5 · advisory · src/status/report.ts:154 · `export { ago };` is a forwarding re-export kept only so src/cli/commands/share.ts:45 can go on importing `ago` from the status report. Pointing that import at src/util/ago.ts would remove this layer that only forwards (question 5).
- F-6 · advisory · src/update/report.ts:29 · The "is this process the staged binary" test (`realpathSync(stagedPath) === realpathSync(process.execPath)`) is written again in src/update/reconcile.ts:89-90, along with the `existsSync` guard. This is small duplicated logic that one helper could hold (question 2).
- F-7 · advisory · src/update/check.ts:93 · The name `said` does not say what the helper does, which is to reduce a write error to its code or the first line of its message; something like `errorReason` would be sharper (question 3).

## Outside the change
none

## Not answerable
none
