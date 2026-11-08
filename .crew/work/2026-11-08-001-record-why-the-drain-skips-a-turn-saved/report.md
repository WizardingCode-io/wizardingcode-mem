# Report: Record why the drain skips a turn (saved, empty, not-worth, no-title) in turns.l

- Work: `2026-11-08-001-record-why-the-drain-skips-a-turn-saved`
- Type: feature. Kind: feature (from work_type feature). Route: standard (feature, scope level 2, clear request)
- CTO plan: none
- Packs: none
- Checklists: none (A per-turn reason code written by the background drain and counted in CLI output: no endpoint, auth, payment, upload, migration, sync, link, deletion, merge or screen)
- Verdict: **Proven**

## Knowledge

- K-316 · validated-solution · "Memory quality: knowledge, not records of a session (spec docs/superpowers/specs" · alone · stack node, word record, word turn, word title · unverified 0.64
- K-311 · validated-solution · "T-4 of 2026-10-15-001-memory-quality-knowledge-not-records-of: AC-5: heuristic j" · alone · stack node, word worth · unverified 0.4
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | behavior | A turn the drain skips keeps its reason in last_error: skip:saved when the agent saved a memory, skip:empty when no sentence is left after the filter, skip:not-worth when the verdict is below SAVE_THRESHOLD or kind none, skip:no-title when no sentence reaches KNOWLEDGE_THRESHOLD; a done turn has none | red then green |
| AC-2 | behavior | drainQueue's report counts skipped turns per reason (skippedBy) and the distill command prints them | red then green; the green recorded 2 times (the latest decides) |
| AC-3 | behavior | status shows the project's skipped turns per reason; a skipped turn with no reason (from before this change) counts as unknown | red then green |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 25 ms |  |
| prose | . | pass | `built-in prose scan` | 24 ms |  |
| build | . | pass | `bun run build` | 2095 ms | logs/build-_-1794164378671.txt |
| test | . | pass | `bun run test` | 54109 ms | logs/test-_-1794164380790.txt |
| lint | . | pass | `bun run lint` | 333 ms | logs/lint-_-1794164434899.txt |
| typecheck | . | pass | `bun run typecheck` | 228 ms | logs/typecheck-_-1794164435232.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 4 | 47200 |
| test-quality | proven | review-test-quality | 0 | 48252 |

- code-quality: src/status/report.ts:126 The `skip:` prefix that `skipMark` (src/distill/pipeline.ts:119) writes is parsed here with a bare `startsWith("skip:")` and `slice(5)`, so the stored format is known in two modules; a `parseSkipMark` beside `skipMark` would keep it in one. Upheld as advisory, as the reviewer had it: rubric question 2 makes duplication a defect only when logic is written twice, and here the format is defined once and read once, with the comment above naming `skipMark`. The reviewer's 271 is the patch line; the file line is 126. (advisory)
- code-quality: src/distill/skips.ts:19 The four reasons are spelled out in `SkippedBy`, `SKIPPED_KEY` and `noneSkipped`: adding a reason means editing three places. Upheld as advisory (question 2, duplicated boilerplate): the compiler already ties two of the three to `SkipReason` (`Record<SkipReason, …>` and the `SkippedBy` return type), so only the interface is unenforced, and no logic is repeated. The reviewer's 590 is the patch line; the file line is 19. (advisory)
- code-quality: tests/integration/distill.test.ts:99 The test file's `NONE` repeats `noneSkipped()` from skips.ts. Upheld as advisory (question 2, boilerplate), and defensible as written: a test that pinned the drain report against the code's own zero value would pass by construction if `noneSkipped()` lost a key, so the literal in the test is the independent expectation. The reviewer's 344 is the patch line; the file line is 99. (advisory)
- code-quality: src/status/report.ts:128 `SKIPPED_KEY[name as SkipReason]` casts an unchecked string to the union; the `Object.hasOwn` guard on the same line is what makes it safe, and the cast hides that. Upheld as advisory (question 6, a style difference): `Object.hasOwn` does not narrow in TypeScript, so a cast or an explicit lookup is needed either way, the comment above states the own-keys reason, and no behaviour disagrees with the neighbours (report.ts had no cast before; pipeline.ts already casts `commands as Redacted[]`). The reviewer's 273 is the patch line; the file line is 128. (advisory)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| knowledge | K-316 | yes 0.64 | - | jev-1.14.0 | 2026-11-08T18:45:34.350Z |
| knowledge | K-311 | no 0.60 | - | jev-1.14.0 | 2026-11-08T18:45:34.350Z |
| defect | code-quality src/distill/pipeline.ts:335 | yes 0.98 | 0.98 | jev-1.14.0 | 2026-11-08T18:58:30.667Z |

## Team

- Primary team: backend (the session)

| Seat | Team | Reason |
| :- | :- | :- |
| researcher | researchers | standard route |
| review-code-quality | backend | standard route |
| review-test-quality | qa | standard route |
| lead-qa | qa | standard route |
| lead-security | security | standard route |
| judge |  | a gate is planned |

- Rounds: judgement 2 of 2, validation 1 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| spec | lead-qa | validated | 0 | 1 | conclave/lead-qa.md |
| spec | lead-security | validated | 0 | 1 | conclave/lead-security.md |
| delivery | lead-security | validated | 0 | 1 | conclave/lead-security.delivery.md |
| delivery | lead-qa | validated | 0 | 1 | conclave/lead-qa.delivery.md |

## Gap round

- D-1: Where is the skip reason stored? → In turns.last_error (the author chose 'Na coluna last_error'), no migration, by the user, relayed by the agent
- Debate: none

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| tech-lead | claude-sonnet-5-5 | - | 2026-11-08T18:46:59.138Z | 16707 | conclave/lead-security.md | hook |
| tech-lead | claude-sonnet-5-5 | - | 2026-11-08T18:47:06.177Z | 21671 | conclave/lead-qa.md | hook |
| review-code-quality | claude-sonnet-5-5 | - | 2026-11-08T18:55:54.925Z | 35485 | review/code-quality.findings.md | hook |
| review-test-quality | claude-sonnet-5-5 | - | 2026-11-08T18:55:57.467Z | 36635 | review/test-quality.findings.md | hook |
| judge | claude-fable-5-1 | - | 2026-11-08T18:58:24.222Z | 59060 | review/ruling.json | hook |
| review-code-quality | claude-sonnet-5-5 | - | 2026-11-08T19:00:59.236Z | 23885 | review/code-quality.findings.md | hook |
| review-test-quality | claude-sonnet-5-5 | - | 2026-11-08T19:01:02.028Z | 24937 | review/test-quality.findings.md | hook |
| judge | claude-fable-5-1 | - | 2026-11-08T19:03:00.786Z | 46630 | review/ruling.json | hook |
| tech-lead | claude-sonnet-5-5 | - | 2026-11-08T19:03:32.042Z | 36533 | conclave/lead-security.delivery.md | hook |
| tech-lead | claude-sonnet-5-5 | - | 2026-11-08T19:03:35.235Z | 34052 | conclave/lead-qa.delivery.md | hook |

## Waits

- for the roles (2026-11-08T18:55:59.533Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T18:56:31.627Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T19:01:02.847Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T19:01:21.540Z), not proven: judgement gate code-quality not run on the current code

## Objections

- O-1 (advisory, raised by gap-round) open: last_error is a misleading name for a skip reason; documented at the write site and in the status line

Fingerprint: sha256:75fe6078ed203ac25764899f7e205fd429e06dbec8d69af36df117e53d04e400
