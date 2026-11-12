# qa lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- Round 2's R-1 is answered. AC-18 (spec.md:95) names what is absent today: the answered rows cite `2026-11-12-005` and are no longer `deferred`; the version rule's row names piece 2; a `deferred` row names `GIT_CONFIG_GLOBAL`, the missing time limit and `MARKETPLACE_TOKEN`; the two untouched advisories stay `deferred`.
- AC-18 has a red on today's tree: a search of `docs/real-use/findings.md` for `2026-11-12-005`, `GIT_CONFIG_GLOBAL`, `piece 2` and `MARKETPLACE_TOKEN` finds nothing, and the rows it rewrites are still `deferred` (docs/real-use/findings.md:70-71).
- The test planned for AC-18 (plan.md:64) would fail if the rows were left alone or closed without the open row. It also holds that no status still starts `deferred, first of the follow-up`, and that the `decideHold` / `deploy-files.test.ts` advisories keep a `deferred` row.
- AC-13 (plan.md:63): the paragraph is located by `gh run list --workflow distribute.yml`, sits under "Repeating a target", and the minutes are read from `release.yml`. That keeps it clear of the "What a run shows" check (tests/unit/release-docs.test.ts:98-103) and of the words already in the runbook's table (docs/runbooks/release.md:47, :49).
- AC-15 (plan.md:65): the Releasing line of `CLAUDE.md` is cut out before looking, and the ADR is held to `::add-mask::`, "exact match" and "no destination from its environment". All three are absent from ADR 0029 today, so the test is red first.
- AC-9 (plan.md:37) has one case per sentence site, a dry-run case and the complement, with and without a token.
- AC-9 advisory for the build: the rebase and second-push cases need the injected runner to count `push` calls (first answered `[rejected]`, second failed), since one runner serves both.
- AC-16 and AC-17 are written first on the code as it is, with `crew tdd before` (plan.md:49), so both preserves get their baseline before `push.ts` changes.
- AC-11 is red off a runner today (plan.md:50; scripts/release/push.ts:219-222).
- AC-10 (plan.md:51) covers the failing clone, the dry run, `VERSION` unset and a passing run's summary file.
- The red for AC-12 is the import of unexported names, which fails the whole of release-push.test.ts; the plan records it as that (plan.md:41).
- I ran nothing; this is a read of AC-18, round 2's section of `conclave.md`, `plan.md` and a search of `findings.md`. I did not open `work.json`, so I did not confirm the recorded criteria match the spec's texts.
