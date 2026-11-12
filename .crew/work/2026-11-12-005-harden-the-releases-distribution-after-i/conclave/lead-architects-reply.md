# architects lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- AC-18 (spec.md:95) replaces AC-14 and still carries my round-1 R-1: the answered rows cite item `2026-11-12-005` and say what was done, the version rule's row names piece 2, and a `deferred` row names `GIT_CONFIG_GLOBAL`, the missing time limit on `push.ts`'s git calls and the inherited `MARKETPLACE_TOKEN`. The non-goal (spec.md:25) and the test-file line (spec.md:100) cite AC-18.
- My round-2 note is taken: the two advisories of `docs/real-use/findings.md:71` that this item does not touch (`decideHold`'s `previous === null` branch, the temporary folders of `deploy-files.test.ts`) stay `deferred` by the criterion's own text.
- Design 4 (spec.md:74) was not reworded and still says only "a row stays open". It does not contradict AC-18, which is the stricter text; the build follows AC-18.
- `findings.md:70` is answered whole by this item, but `findings.md:71` mixes three answered points, the version rule and the two untouched advisories. AC-18 therefore means that row is split: an answered row, a piece-2 row and a deferred remainder. The plan should say so, so the docs test selects rows by content, not by position.
- Nothing else changed; the rest of my round-2 validation stands.
