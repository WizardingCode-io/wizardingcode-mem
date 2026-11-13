# Report: The viewer tells of a newer release: Settings → About says the latest release, w

- Work: `2026-11-12-008-the-viewer-tells-of-a-newer-release-sett`
- Type: feature. Kind: feature (from work_type feature). Route: standard (feature, scope level 1, clear request; personal data in lines not read for risk (test or excluded): phone (tests/unit/ui-update.test.ts); the change's lines name personal data: phone (ui/src/components/UpdateBanner.vue) and 1 more)
- CTO plan: none
- Packs: none
- Checklists: endpoint (1 file), screen (1 file)
- Verdict: **Proven**

## Knowledge

- K-394 · validated-solution · "The client learns of a release and its staged binary follows (piece 2 of 2026-11" · alone · stack node, word viewer, word tells, word newer, word release, word settings, word says, word latest · likely 0.81
- K-381 · validated-solution · "Share a project without a git remote. Today a project can be set above Nothing o" · alone · stack node, word viewer, word newer, word says, word latest · unlikely 0.03
- K-363 · validated-solution · "Team server: wizardingcode-mem serve, one Docker image with SQLite and the repos" · alone · stack node, word viewer, word tells, word newer, word release · unlikely 0.07
- K-398 · validated-solution · "Three tests fail intermittently on the macOS runner and block the required check" · alone · stack node, word settings, word says, word latest · unlikely 0.09
- K-391 · validated-solution · "Harden the release's distribution after its first review (follow-up of 2026-11-1" · alone · stack node, word release, word says, word latest · unverified 0.29
- K-390 · validated-solution · "The release publishes everywhere by itself, and <data dir>/bin has one owner tha" · alone · stack node, word newer, word release · unverified 0.22
- K-371 · validated-solution · "Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem kee" · alone · stack node, word viewer, word says · unlikely 0.09
- K-346 · validated-solution · "Sharing policy: per project local only, knowledge only, or knowledge and memory;" · alone · stack node, word viewer, word says · unlikely 0.04
- K-335 · validated-solution · "Knowledge store: entries as Markdown with frontmatter (kind knowledge, strategy," · alone · stack node, word viewer, word latest · unlikely 0.05
- K-383 · validated-solution · "Homebrew formula: 0.8.0 with the release's checksums. packaging/homebrew/wizardi" · alone · stack node, word release · unlikely 0.2
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-8 | behavior | GET /api/update answers the report in the viewer's shape for each state: a release out (the four channels' commands, banner true); the running version the latest; the check off in the file; off by the environment (fromEnvironment true); a value neither check nor off (off-unknown); CI set (ci); not checked yet; a last check that failed; a staged binary of another version gives the agents line; a builder that throws gives 200 with the shape, line saying why, out and banner false and no commands. | red then green; the red recorded 2 times (the latest decides); the green recorded 2 times (the latest decides) |
| AC-9 | behavior | POST /api/update/dismiss keeps the release dismissed: banner is false for it afterwards and true again when update.json names a later release; with no release known it keeps nothing; a body that names another version changes nothing of that. | red then green; the green recorded 2 times (the latest decides) |
| AC-10 | behavior | No file of src/ui/ reaches src/update/check.ts through static or dynamic imports, at any depth; and with a check due, answering GET /api/update and POST /api/update/dismiss makes no request to any host but the viewer's own loopback address, counted by a wrapped fetch. | red then green; the green recorded 2 times (the latest decides) |
| AC-11 | behavior | The banner's line, the card's status and tone and the Settings list's mark, as ui/src/update.ts writes them, for each state: out with a staged copy, out with none, latest, ahead, off, off by the environment, off-unknown, not checked in CI, not checked yet, could not check, and a report that could not be built; the About card, the banner over the memories view and the marked list show them at the three widths in both schemes. | red then green; the red recorded 3 times (the latest decides); the green recorded 3 times (the latest decides) |
| AC-12 | behavior | The switch's two values go through PUT /api/settings: WIZARDINGCODE_MEM_UPDATE=off and =check are written to the env file, and GET /api/update then says the mode it was set to. | red then green; the green recorded 2 times (the latest decides) |
| AC-13 | behavior | The README says in neither of its two places that WIZARDINGCODE_MEM_UPDATE is set by hand, and says where the viewer tells of a release; CLAUDE.md names the two routes and the files; in docs/real-use/findings.md the row of the missing About line and Settings field says that part is answered, its other remark kept. | red then green |
| AC-14 | preserve | tests/integration/ui.test.ts, tests/integration/ui-settings.test.ts and the tests tests/unit/update-boundary.test.ts holds today pass as before. | passing before and after (72 → 74 pass); the after recorded 2 times (the latest decides) |
| AC-15 | observed | The other states the page reaches are captured too, at the three widths in both schemes: the running version ahead of the latest release, a value of the key that is neither check nor off, not checked in CI, a report that could not be built, and the banner when no copy is staged. | observed: passes after (Whether a state is seen is shown by its capture, which no test of this project can fail on purpose (no browser test harness; the e2e gate is skipped by the author's standing decision). The states' texts, tones and signs are held by AC-11's tests, red then green.) |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 44 ms |  |
| prose | . | pass | `built-in prose scan` | 43 ms |  |
| design-lint | . | pass | `built-in design lint` | 77 ms |  |
| build | . | pass | `bun run build` | 2619 ms | logs/build-_-1794522520051.txt |
| test | . | pass | `bun run test` | 234321 ms | logs/test-_-1794522522704.txt |
| lint | . | pass: 1 untouched file with problems, none of the item's | `bun run lint` | 96 ms | logs/lint-_-1794522757025.txt |
| typecheck | . | pass | `bun run typecheck` | 395 ms | logs/typecheck-_-1794522757123.txt |
| e2e | . | skipped: This project has no e2e suite: the viewer's UI evidence is the session's captures under review/ui/ (manifest by the session). Decided by the author on 2026-11-09 with 'sim força' after the two options (a standing skip, or an environment and an e2e command in the profile) were presented; relayed by the agent. |  | 0 ms |  |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 1 | 213720 |
| test-quality | proven | review-test-quality | 0 | 262810 |
| security | proven | review-security | 1 | 191343 |
| ui-ux | proven | review-ui-ux | 6 | 457209 |

- code-quality: src/ui/update.ts:226 Upheld as advisory (question 5). To call lastFailed, the viewer builds a stand-in UpdateState with an invented attemptAt: null. src/update/report.ts already computes 'failed' from the real state, so the report could carry it as a field. This is duplication, not a defect. The five advisories from round 1 are resolved: one ViewerUpdate declaration, the server's built/failed fields, and checksDaily. (advisory)
- security: src/ui/update.ts:209 Upheld as advisory. 'line' (the error's first line when the report cannot be built) and 'agents' (the staged binary's absolute path) can carry home-directory paths to the page. The audience is not wider: the route is behind the Host and token checks on the loopback-only viewer, and status/doctor already print the same lines to the same person. The updateReport seam is in-process only, and no request or CLI command sets it. (advisory)
- ui-ux: src/ui/update.ts:74 Lowered to advisory (judge's evidence rule). The reviewer's defect, under question 5: in the unbuilt state the About status line shows a raw system error, 'Not checked: EIO: i/o error, read' (settings-about-unbuilt@1280-dark.png, @360-light.png). It is not upheld as a defect for two reasons. (1) The captures are listed only in the session-written review/ui/manifest.json. review/ui-evidence.json is absent, so they are not evidence that can uphold a ui-ux defect, and a raw error on screen is what a capture shows, so the diff-line branch does not apply. (2) The wording is what spec.md:16 prescribes ('not checked: <the error's first line>'), and AC-8 holds it. Only the spec can change that, not a gate ruling. If the author wants the plain sentence, it is a spec change: amend spec.md:16 and AC-8. (advisory)
- ui-ux: ui/src/update.ts:74 Upheld as advisory. When the report cannot be built, the server sends mode 'check' and fromEnvironment false. checksDaily then shows the switch on and enabled even when the setting is off. This is a narrow fallback state (settings-about-unbuilt@1280-dark.png). (advisory)
- ui-ux: ui/src/update.ts:37 Upheld as advisory. In the off-env state the status line and the switch description say the same thing twice (settings-about-off-env@1280-dark.png, @360-light.png). (advisory)
- ui-ux: ui/src/components/settings/About.vue:57 Upheld as advisory. In the off state the status line prints the data directory's full env path, which takes five lines at 360 (settings-about-off@360-dark.png, @1280-light.png). Crowding that still holds. (advisory)
- ui-ux: ui/src/App.vue:165 Advisory, debt (outside the change). The 216px projects panel stays open at 768 and 360. The banner no longer depends on it (memories-update-out@768-dark.png, @360-light.png). (advisory)
- ui-ux: ui/vite.config.ts:60 Advisory, debt (outside the change). In the light scheme the USwitch off track is barely visible on white cards, across every switch in Settings (settings-about-off-unknown@1280-light.png). (advisory, outside the change)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-394 | yes 0.81 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-381 | no 0.97 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-363 | no 0.93 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-398 | no 0.91 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-391 | no 0.71 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-390 | no 0.78 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-371 | no 0.91 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-346 | no 0.96 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-335 | no 0.95 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| knowledge | K-383 | no 0.80 | - | jev-1.14.0 | 2026-11-12T21:59:17.824Z |
| validator | complete-gap-round v1 | yes 0.98 | 0.98 | jev-1.14.0 | 2026-11-12T22:04:16.768Z |
| validator | complete-gap-round v2 | yes 0.88 | 0.88 | jev-1.14.0 | 2026-11-12T22:04:16.768Z |
| defect | ui-ux ui/src/update.ts:52 | yes 0.84 | 0.84 | jev-1.14.0 | 2026-11-12T22:24:13.884Z |

## Team

- Primary team: frontend (the session; its lead validates)

| Seat | Team | Reason |
| :- | :- | :- |
| researcher | researchers | standard route |
| review-code-quality | backend | standard route |
| review-test-quality | qa | standard route |
| review-security | security | risk area personal-data |
| review-ui-ux | frontend | interface files: ui/src/App.vue, ui/src/components/Settings.vue, ui/src/components/UpdateBanner.vue, +1 more |
| lead-qa | qa | standard route |
| lead-security | security | standard route |
| lead-frontend | frontend | interface files: ui/src/App.vue, ui/src/components/Settings.vue, ui/src/components/UpdateBanner.vue, +1 more |
| judge |  | a gate is planned |

- Rounds: judgement 2 of 2, validation 2 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| spec | lead-qa | returned | 3 | 1 | conclave/lead-qa.md |
| spec | lead-security | returned | 1 | 1 | conclave/lead-security.md |
| spec | lead-qa | validated | 0 | 2 | conclave/lead-qa-reply.md |
| spec | lead-security | validated | 0 | 2 | conclave/lead-security-reply.md |

## Gap round

- D-1: Where does the viewer show that a newer release is out? → About + faixa no topo: the About card says the latest release, when it was checked and the channel's command, and a dismissible banner at the top of the viewer says a newer release is out, by the user, relayed by the agent
- D-2: May the viewer ask github.com for the latest release on a button, or does it only read update.json? → Só lê (Recomendado): the viewer shows what update.json holds and never asks the network, by the user, relayed by the agent
- Debate: none

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T22:02:26.575Z | 54959 | conclave/lead-security.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T22:02:46.916Z | 60930 | conclave/lead-qa.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T22:04:02.866Z | 66078 | conclave/lead-security-reply.md | hook |
| tech-lead | claude-fable-5-2 | - | 2026-11-12T22:04:09.259Z | 73552 | conclave/lead-qa-reply.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T22:19:41.977Z | 62912 | review/security.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T22:19:57.376Z | 69493 | review/code-quality.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T22:20:33.207Z | 94493 | review/test-quality.findings.md | hook |
| review-ui-ux | claude-opus-5-5 | - | 2026-11-12T22:22:19.376Z | 147023 | review/ui-ux.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T22:23:46.717Z | 71052 | review/ruling.json | hook |
| review-security | claude-opus-5-5 | - | 2026-11-12T22:35:21.916Z | 151162 | review/security.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-12T22:35:30.948Z | 173539 | review/code-quality.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-12T22:35:38.815Z | 222629 | review/test-quality.findings.md | hook |
| review-ui-ux | claude-opus-5-5 | - | 2026-11-12T22:38:03.789Z | 417028 | review/ui-ux.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-12T22:38:37.619Z | 160722 | review/ruling.json | hook |

## Decisions

- spec approved by the validator (rule: complete-gap-round) (2026-11-12T22:04:16.769Z): counted, a person was present
- `gate:e2e` skipped by the user (standing decision of 2026-11-09): This project has no e2e suite: the viewer's UI evidence is the session's captures under review/ui/ (manifest by the session). Decided by the author on 2026-11-09 with 'sim força' after the two options (a standing skip, or an environment and an e2e command in the profile) were presented; relayed by the agent.
- AC-1 (behavior) removed (2026-11-12T22:03:30.621Z): GET /api/update answers the report in the viewer's shape for each state of the data directory: a release out (with the four channels' commands and banner true), the running version the latest, the check off in the file, the check off by the environment (fromEnvironment true), not checked yet, and a last check that failed; a staged binary of another version gives the agents line.
- AC-2 (behavior) removed (2026-11-12T22:03:30.687Z): POST /api/update/dismiss keeps the release dismissed: banner is false for it afterwards and true again when update.json names a later release; with no release known it keeps nothing.
- AC-3 (behavior) removed (2026-11-12T22:03:30.754Z): Nothing in src/ui/ imports src/update/check.ts, directly or through another file of src/ui/, and answering GET /api/update calls fetch zero times.
- AC-4 (behavior) removed (2026-11-12T22:03:30.821Z): The banner's line, the card's status and tone and the Settings list's mark, as ui/src/update.ts writes them, for each state: out with a staged copy, out with none, latest, ahead, off, off by the environment, not checked, could not check; the About card, the banner over the memories view and the marked list show them at the three widths in both schemes.
- AC-5 (behavior) removed (2026-11-12T22:03:30.886Z): The switch's two values go through PUT /api/settings: WIZARDINGCODE_MEM_UPDATE=off and =check are written to the env file, and GET /api/update then says the mode it was set to.
- AC-6 (behavior) removed (2026-11-12T22:03:30.962Z): The README no longer says WIZARDINGCODE_MEM_UPDATE has no field and says where the viewer tells of a release; CLAUDE.md names the two routes and the files; docs/real-use/findings.md marks the row of the missing About line as answered.
- AC-7 (preserve) removed (2026-11-12T22:03:31.031Z): tests/integration/ui.test.ts, tests/integration/ui-settings.test.ts and tests/unit/update-boundary.test.ts pass as before.

## Waits

- for the roles (2026-11-12T22:19:27.320Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T22:19:54.713Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T22:20:12.478Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T22:20:46.650Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T22:22:35.291Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-12T22:30:48.494Z), not proven: code changed since the last gate run
- for the roles (2026-11-12T22:31:19.138Z), not proven: code changed since the last gate run
- for the roles (2026-11-12T22:35:26.407Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T22:35:38.592Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T22:35:51.806Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-12T22:38:19.072Z), not proven: judgement gate code-quality not run on the current code

## Objections

- O-1 (advisory, raised by gap-round) open: The release banner is on every view until dismissed, above the History and Links offers: three banners can stack on a first run.
- O-2 (advisory, raised by gap-round) open: GET /api/update runs the staged binary's --version at each page load, under ADR 0030's guards.

Fingerprint: sha256:742340deb79d64109724dd8dc35aeb607f9a378ee06eb48f849c6e7dcf897547
