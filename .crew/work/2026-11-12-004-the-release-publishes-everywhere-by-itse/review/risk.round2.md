# risk findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-risk
read: spec, plan, 38 files

## Findings
- F-1 · advisory · .github/workflows/distribute.yml:199 · When the `latest` retag (`docker buildx imagetools create`) fails, the step exits and the job's last step does not run. The job turns red, but the run's summary gets no `latest:` line, although the spec (spec.md:149, "any target: `<target>: failed: <sentence>`") and the runbook's "What a run shows" table promise a line for every failed target. The author learns of it only by opening the failed job's log; adding `if: always()` to the summary step, or a `failed` line on that path, would close the gap.
- F-2 · advisory · docs/runbooks/release.md:10 · `release.yml` turns green as soon as the dispatch is sent, and `distribute.yml` runs as its own run, started by the workflow's token. A failed npm, tap, marketplace or retag in the first hour is seen only if the author opens the `distribute v<version>` run, as this line and ADR 0029:58 tell them to. The spec's Risks (spec.md:272) does not say whether anyone gets a failure notification for a run that github-actions started. The failure stays visible on the run page, and repeating the dispatch fixes it, so this is advisory.
- F-3 · advisory · .github/workflows/distribute.yml:100 · The first real dispatch is the first npm publish of both packages, for real. It cannot be undone: npm does not let a version number be reused. The dry run does not exercise trusted publishing. The spec states this (spec.md:271, 273), and its fix is a higher version, so it is advisory. Nothing in code limits that first run beyond the `dry_run` input and the order the runbook gives.
- F-4 · advisory · scripts/release/push.ts:2024 · The tap edit has no forward-only check of its own: it writes whatever `renderFormula` gives, and only `plan`'s highest-tag rule stops it from writing a lower version. The marketplace edit refuses to overwrite an entry a person bumped by hand (`left-alone`). The tap gets no such guard, although the tap was also bumped by hand for 0.7.0 and 0.8.0 (spec.md:11). If the tap is ever ahead of the highest tag on `main`, a run moves it back, and only the runbook's "revert by a commit" puts it right.

## Outside the change
- .github/workflows/release.yml:104 · `actions/checkout@v7`, `actions/download-artifact@v8` and, at :90, `docker/build-push-action@v6` are pinned by tag, not by commit, in jobs that hold write tokens (the image push, the release). The new `distribute.yml` pins every action by SHA; `release.yml` still does not.
- .github/workflows/release.yml:90 · A branch's own workflow, or a tag on an older commit, can still push the image's `latest`. The spec states this (spec.md:276) and leaves it to piece 3.

## Not answerable
- Q1 (the first hour: how anyone would know) · The spec does not say whether GitHub notifies anyone of a failed `distribute.yml` run that `release.yml` dispatched with its own token. Without that, a failed distribution may only be found by someone opening the run.
