# security lead's validation of 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett: spec
verdict: validated
## Returns
none
## Notes
- R-1 is answered, way (a). spec.md:18 moves `mode` and `Mode` to the leaf `src/update/mode.ts`, leaves `check.ts` no export of them, and adds a test that walks every file of `src/ui/` through static and dynamic imports. AC-10 (spec.md:43) is transitive "at any depth", and its request count covers both `GET /api/update` and `POST /api/update/dismiss`, with a check due. That makes D-2 provable by a test, not by the scope of a word.
- AC-10's count is taken under the right conditions. spec.md:39 gives the tests their own environment and clock, so the suite's preload (`WIZARDINGCODE_MEM_UPDATE=off`, held at `tests/unit/update-boundary.test.ts:51-52`) and a runner's `CI` cannot make the zero-request result trivially true.
- The dismiss route takes nothing from the client. spec.md:17 says the body is ignored and the version kept is the one `readState` reads strictly (`src/update/state.ts:37`). AC-9 (spec.md:42) has the case of a body naming another version, and the case of no release known leaving no `update.dismissed` in `meta`.
- The failure path leaks no stack. spec.md:16 fixes the answer of a throwing builder to `not checked: <the error's first line>` with the same shape, and AC-8 (spec.md:41) proves it through the `viewerUpdate` seam.
- The refused-staged case not being in AC-8 is accepted. The guard is proven where it lives: `tests/unit/update-report.test.ts:178-188` and `:252` hold `mayRunStaged` and the `refused: true` facts, and the route calls `updateReport` with no seam for who runs it (`src/update/staged.ts:52`).
- Authentication is unchanged and structural: the Host check at `src/ui/server.ts:269`, the token at `src/ui/server.ts:285` before every `/api/` route, and the `127.0.0.1` bind at `src/ui/server.ts:884`. The plan should place both routes after line 285, as `/api/history/offer/dismiss` is at `src/ui/server.ts:835`.
- One importer is missing from spec.md:18's list, for the plan to pick up: `src/cli/commands/distill.ts:31` does `const { checkForRelease, mode } = await import("../../update/check.ts")`. With `check.ts` keeping no export of `mode`, that line must take `mode` from `src/update/mode.ts`. The typecheck gate would catch it, so this is not a return.
- I would prefer the plan to state that `line` and `agents`, which carry local paths (`src/update/report.ts:34`, `:72`), are rendered as text in `About.vue` and `UpdateBanner.vue`, never through `v-html`. Nothing in the spec suggests otherwise.

Files read this round:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-008-the-viewer-tells-of-a-newer-release-sett/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/update-report.test.ts (searched for the guard's tests only)
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/cli/commands/distill.ts (line 31 only, by search)
