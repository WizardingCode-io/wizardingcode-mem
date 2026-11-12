# security lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: spec
verdict: validated
## Returns
none
## Notes
- Round-2 R-1 (a tag moved after `plan` judged it) is closed. All paths are in `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/`.
  - `plan` gives the output `sha`, the commit the tag named when judged (spec.md:105), and AC-36 has an accepted tag give its commit (spec.md:226).
  - The `npm` job checks out that commit, "never the tag by name" (spec.md:136). AC-37 pins it: `npm`'s checkout takes its `ref` from `plan`'s `sha` output and no checkout takes `inputs.tag` (spec.md:231).
  - The revision goes further than the return asked: `push.ts` refuses before any write when the tag no longer names that commit (spec.md:151), proven by AC-38 (spec.md:235). That covers the marketplace `ref` and the formula's URLs inside the run.
- Round-1 R-1 to R-5 stay closed as recorded in round 2: refusal 4 and J-8; the door's preconditions and refusal 9; the token's path with AC-33 and AC-38; SHA-pinned actions; no `${{` in any `run:`. conclave.md:53 records the round-2 change.
- For the build, not a return: with an annotated tag, `git ls-remote` answers the tag object's id, and the commit only on the peeled `refs/tags/<tag>^{}` line. `push.ts` must compare the peeled commit with `plan`'s `sha`, or it refuses every annotated tag. That fails closed, but AC-38's test should include an annotated tag.
- Residual and accepted: after the run ends, a writer can still move a `v*` tag or replace release assets, which the marketplace `ref` and the plugins' downloads follow. That exposure exists today; signatures are a non-goal (spec.md:42) and the tag ruleset stays an optional runbook step. I would make the ruleset part of the setup; that is a preference.
- The two GitHub facts now cited from the documentation (a missing environment is created with no rules; the environment and its branch policies are readable under Actions read) match what refusal 9 and `plan`'s `actions: read` rest on. If the read fails anyway, refusal 9 fails closed.
- O-1 and O-2 remain advisory; nothing in this round changes them.
