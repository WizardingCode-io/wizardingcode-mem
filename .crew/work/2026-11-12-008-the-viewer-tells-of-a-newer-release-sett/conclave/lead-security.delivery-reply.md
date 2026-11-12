# security lead's validation of 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett: delivery
verdict: validated
## Returns
none
## Notes
- The gates my team owns passed: `secrets` at `.crew/work/2026-11-12-008-the-viewer-tells-of-a-newer-release-sett/report.md:41`, and the security judgement gate "proven" with one advisory at `report.md:56` and `report.md:60`. The test gate is at `report.md:45`; its log `logs/test-_-1794522522704.txt:78-80` reads 3598 pass, 0 fail.
- Both routes are behind the token and the Host check. They sit at `src/ui/server.ts:844` and `src/ui/server.ts:855`, after the token check at `src/ui/server.ts:289`. `tests/integration/ui-update.test.ts:76-80` asserts 401 for both without a token.
- The dismiss route reads nothing of the request. `dismissUpdate(db, dataDir)` at `src/ui/update.ts:113-117` takes only the database and the data directory, and keeps the `latest` that `readState` validated. `tests/integration/ui-update.test.ts:285-293` sends a body naming another version and finds the file's version kept; `:279-283` finds nothing kept when no release is known.
- My spec return R-1 is delivered as agreed. `src/update/mode.ts` is a leaf with no imports, and `src/update/report.ts:10` imports from it. `src/update/check.ts:5` keeps only a type import of `Mode` and exports neither. The other importers followed: `src/cli/commands/update.ts:6` and `src/cli/commands/distill.ts:32`, the one I flagged as missing from the spec's list.
- The transitive boundary is held by a test. `tests/unit/update-boundary.test.ts:69-79` walks static and dynamic imports from every file of `src/ui/`, proves the walk is real (it reaches `report.ts` and `mode.ts`) and fails if `check.ts` is reached. The walk lists only the top level of `src/ui/`; that covers all six `.ts` files there today, but a future subfolder would escape it.
- The request count is taken correctly. `tests/integration/ui-update.test.ts:297-318` wraps `fetch` before the viewer starts, with an empty environment and no `update.json`, so a check is due. It sees exactly the test's own three calls and none to another host.
- The `updateReport` option on `startUi` (`src/ui/server.ts:125-126`, used at `:851`) is reachable only in-process. Neither `startUi` call in `src/cli/commands/ui.ts:33-39` and `:64-72` passes it, and no request sets it.
- The failure path returns no stack: `src/ui/update.ts:74` keeps the error's first line only, and `tests/integration/ui-update.test.ts:240-261` proves it through the route with a two-line error.
- The lines are rendered as text. `ui/src/components/settings/About.vue:57-58` and `:65-66` and `ui/src/components/UpdateBanner.vue:34-35` use interpolation. The only `v-html` under `ui/src` is in `Markdown.vue:11` and `TopBar.vue:16`, neither in the change. The copy button writes a `CHANNEL_COMMANDS` constant (`About.vue:42`).
- The advisory is accepted as left. `line` and `agents` can carry home-directory paths, to the same person who reads them in `status`, behind the token on the loopback. It is recorded as deferred at `docs/real-use/findings.md:87`, together with the untested clicks.
- A reference nit: `report.md:60` cites `src/ui/update.ts:209`, a line of the patch; the file has 118 lines, and the lines meant are `src/ui/update.ts:74` and `:100`.
- Not checked: there is no `tasks/` folder or `plan.md` under the item, so no task briefs were read; I validated on `report.md` and the committed code. I did not open `review/ruling.json` beyond the report's own table.

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-008-the-viewer-tells-of-a-newer-release-sett/report.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-008-the-viewer-tells-of-a-newer-release-sett/review/security.findings.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/update.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/ui/server.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/update/mode.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/update/check.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/ui.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/update-boundary.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/integration/ui-update.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/About.vue
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/UpdateBanner.vue
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/real-use/findings.md
