# security lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- AC-18 (`spec.md:95`) keeps what my R-1 asked for and is stronger than AC-14: a `deferred` row must name `GIT_CONFIG_GLOBAL`, the missing time limit on `push.ts`'s git calls, and `MARKETPLACE_TOKEN` inherited by the calls without the header. The last was only in Design 4 (`spec.md:74`) before; my round-2 advisory on it is now a criterion.
- AC-18 has a failing test today: `docs/real-use/findings.md:70-71` are `deferred`, cite no item `2026-11-12-005`, and no row names `GIT_CONFIG_GLOBAL` or a time limit on git calls.
- The two advisories this item does not touch (`decideHold`'s `previous === null` branch, the temporary folders of `deploy-files.test.ts`) stay `deferred`, which matches `docs/real-use/findings.md:71`; nothing security-relevant is dropped by splitting that row.
- The references follow the new id: `spec.md:25`, `spec.md:100`, `conclave.md:22-23` and `conclave.md:37` all cite AC-18.
- I re-read only AC-18, its references and `conclave.md:47-49`; the rest of the spec is taken as unchanged, as the coordinator stated. My round-2 notes on AC-9, AC-10, AC-16 and `spec.md:57-59` stand.
