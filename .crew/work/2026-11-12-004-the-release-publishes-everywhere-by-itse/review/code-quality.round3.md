# code-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-code-quality
read: 39 files, 48 hunks

## Findings
- F-1 · advisory · scripts/release/push.ts:216 · `PUSH_REMOTE` / `PUSH_ORIGIN` are environment overrides in the production release command that exist only for its test, as the comment on line 215 says. Question 5 (a configuration knob no criterion asked for). The test could inject `remote`/`origin` through `commitAndPush`, the way release-push.test.ts already does.
- F-2 · advisory · scripts/release/lib.ts:403 · `passingFacts` builds a set of placeholder facts that all pass (`tagSha: ""`, `onMain: true`, a full asset list), and plan.ts:91-115 overwrites them one at a time and re-runs `decidePlan` after each. This couples the read order in plan.ts to `decidePlan`'s internal refusal order and to each placeholder's "passing" value. Question 5: it is still one job, but adding a refusal means editing three places.
- F-3 · advisory · scripts/release/plan.ts:118 · `let hold = { held: false, byHand: false, outcome: null } as ReturnType<typeof decideHold>` repeats the `free` value that `decideHold` already defines (lib.ts:523) and needs a cast to do it. Question 2, boilerplate.
- F-4 · advisory · src/cli/commands/install.ts:208 · `resolveBinary` does more than resolve a path. Through `stageBinary` it copies the running binary into the data directory, so the name hides its main side effect. Question 3: a name like `stageOrNamedBinary` would be sharper.
- F-5 · advisory · docs/runbooks/release.md:87 · The hold's line is written `… <previous> speaks <m>` here, but `… speaks <n>` in the "What a run shows" table (line 438) for the same summary line. The two spellings of one line disagree, and release-docs.test.ts checks only the table. Question 11.

## Outside the change
- none

## Not answerable
- Question 6 (conventions of the module) for `.github/workflows/release.yml`'s new `distribute` job · I did not read the rest of release.yml beyond its hunks, so I cannot say whether its other jobs set `timeout-minutes`, as every job in distribute.yml does.

Paths: diff at /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/review/diff.patch; rubric at /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/code-quality.md.
