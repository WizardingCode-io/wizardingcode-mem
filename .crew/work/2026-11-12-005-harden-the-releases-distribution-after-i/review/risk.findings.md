# risk findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: review-risk
read: spec, plan, 10 files

## Findings
- F-1 · advisory · docs/runbooks/release.md:64 · The paragraph that tells the person to re-run a cut job relies on two things nobody has measured: that `gh workflow run` finishes in under 5 minutes (spec.md:109 says this is seen only in real runs), and that a dispatch GitHub accepted late shows up within "a minute". If both runs start, the harm is bounded: the second run writes nothing the first already wrote. A stalled dispatch is also visible, because the job is cut and `release.yml` goes red. The rollback is a stated revert, so this is advisory only.

## Outside the change
- .github/workflows/distribute.yml:128 · The git calls that carry no header (`ls-remote`, `config`, `status`, `diff`, `commit`) still inherit `MARKETPLACE_TOKEN` and the person's global and system git configuration. Those git calls have no time limit of their own beyond the job's 15 minutes. The item records all three as `deferred` in docs/real-use/findings.md:73, so this is existing debt and the item does not add to it.
- docs/real-use/findings.md:73 · The repository has not established whether the runner masks a secret's base64 inside the step summary. The script's exact-match redaction is the only cover there, and the first real release is the first time its failure sentences reach GitHub (spec.md:111 names the author as the one who reads that run).

## Not answerable
- none
