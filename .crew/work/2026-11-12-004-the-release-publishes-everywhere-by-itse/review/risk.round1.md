# risk findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-risk
read: spec, plan, 38 files

## Findings
- F-1 · advisory · docs/runbooks/release.md:76 · The "person's way back" (`install --force` from the older binary) does not hold, and the runbook says nothing about why. A plugin still at the newer version sees the forced older binary as older at its next hook (`scripts/templates/wizardingcode-mem.sh` `older()`) and stages the newer one again. If the newer binary has already migrated the store, the older one refuses it (`SchemaTooNewError`). Spec J-6 (spec.md:68) and ADR 0029 also promise the way back without these two limits.
- F-2 · advisory · .github/workflows/release.yml:157 · The `distribute` job goes green as soon as GitHub accepts the dispatch. So the tag's own release run reports success even when `distribute.yml` then refuses or fails. That failure shows only on a separate run, started by the workflow token, and the runbook asks the author to open it ("Read its summary", docs/runbooks/release.md:10). It is not established who, if anyone, GitHub notifies about that run's failure. A partly distributed release can go unnoticed in the first hour unless the author looks.
- F-3 · advisory · scripts/release/push.ts:127 · A push refused by branch protection (GitHub's `GH006 Protected branch update failed`, which contains neither `403` nor `Permission`) is handled as a race. The script runs `pull --rebase`, pushes again and stops with "refused twice". The author then gets a sentence that is not among the runbook's repairs (docs/runbooks/release.md:64), though runbook step 4 of the setup names this cause. The failure is visible and nothing is written, so this is about the message only.
- F-4 · advisory · spec.md:271 · The first real dispatch is the first run of four irreversible writes. The npm publish of both packages under the dist-tag `latest` reaches every `npx` and OpenCode user at once, and an npm version cannot be reused. The code limits the first run only through the dry run and the runbook's order, and the dry run does not exercise these writes. This risk is stated, along with its repair (repeat the dispatch, fix forward with a higher version), so it is advisory.

## Outside the change
- .github/workflows/release.yml:104 · `release.yml` still uses actions pinned by tag, not by commit (`actions/checkout@v7`, `actions/download-artifact@v8`, `docker/build-push-action@v6`). This item now also gives that workflow the job that starts the privileged distribution (`actions: write`). This is debt the repository already carried; the item applies its pinning rule only to `distribute.yml`.

## Not answerable
- Q1 (first hour: how would anyone know) · Neither the spec nor the runbook says whether GitHub notifies anyone when a run of `distribute.yml` started by the workflow token fails. Nothing in the diff adds an alert beyond the run's summary and its failed status.
