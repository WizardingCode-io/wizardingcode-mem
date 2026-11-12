# devops lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- AC-18 (spec.md:95) changes only what `docs/real-use/findings.md` must say; no pipeline, workflow or runbook text moved, so my round 2 validation of J-4, Design 3, AC-6, AC-13 and the rollout (spec.md:37, :70, :93, :94, :107) stands as given.
- AC-18 is provable from DevOps's side: the rows it speaks of exist today as `deferred` (docs/real-use/findings.md:70 for the mask, and the long rows at :68 and :71), so a test in `tests/unit/release-docs.test.ts` (spec.md:100) can fail first on the status and on the citation of `2026-11-12-005`.
- The open row AC-18 keeps (`GIT_CONFIG_GLOBAL`, no time limit on `push.ts`'s git calls, `MARKETPLACE_TOKEN` inherited by the calls without the header) matches the item's non-goals (spec.md:25). Those calls stay bounded only by the jobs' 15 minutes (.github/workflows/distribute.yml:116, :148).
- For the build: docs/real-use/findings.md:67 (a third dispatch replaces the pending run; `release.yml` green once the distribution is started) is not answered by this item and should stay `deferred`. The new time limit does not close it, and AC-18 does not list it among the answered rows.
- I did not open the "round 2" section of `conclave.md` beyond its heading (its one line is long); this answer rests on spec.md and findings.md as read. I ran nothing.
