# risk findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-risk
read: spec, plan, 39 files

## Findings
- F-1 · advisory · .github/workflows/release.yml:152 · The `distribute` job only starts `distribute.yml` with the workflow's own token and turns `release.yml` green at once. A dispatch made that way may not send its failure email to the author (an unverified reading of GitHub's notification rule). A failed npm, tap or marketplace write on a tag's automatic run would then show only on a run page nobody is pointed to. The limit is stated in ADR 0029 and the runbook says to read the `distribute v<version>` run, so this is advisory. Waiting on the dispatched run (for example `gh run watch`) would make the failure visible on the release itself.
- F-2 · advisory · scripts/release/push.ts:126 · The "refused by a rule on its branch" sentence is chosen by `/GH006|protected branch/i`. A repository ruleset, which is what the setup and this repository use, rejects a push with `GH013: Repository rule violations found`. Such a refusal falls through to the generic `the push to <remote> failed: <git's text>`, so the runbook's named repair (docs/runbooks/release.md:458) never matches what the author sees. The failure stays visible and can be repeated, so this is advisory.
- F-3 · advisory · docs/runbooks/release.md:419 · The rule that the first real dispatch comes only after a dry run is written in the runbook only, not in code. The first non-dry run makes npm publishes that cannot be undone (a version cannot be reused). The spec states the way back (a higher version, spec.md:274), and `plan`'s environment refusal stops the tag's automatic run, so this is advisory. The sentence "The first tag after this setup exists is pushed after steps 1 and 2 and before step 3" also contradicts itself: the setup does not exist yet at that point. It should say "the first tag that carries this item", as the spec does.

## Outside the change
- .github/workflows/release.yml:104 · `release.yml`'s existing jobs still use actions pinned by tag (`actions/checkout@v7`, `actions/download-artifact@v8`, `docker/build-push-action@v6`) in a workflow that pushes the image and creates the release. `distribute.yml` pins by commit and `release.yml` does not. This is debt the repository already carried, and the release's assets, which the tap's checksums trust, are built there.

## Not answerable
- none
