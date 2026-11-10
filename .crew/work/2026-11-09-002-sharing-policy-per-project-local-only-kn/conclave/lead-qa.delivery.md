# qa lead's validation of 2026-11-09-002-sharing-policy-per-project-local-only-kn: delivery
verdict: validated
## Returns
none
## Notes
- Gates QA owns passed on the merged tree (report.md:59-67). Test: `bun run test` passed, with logs/test-_-1794259085724.txt. The plugins/opencode test passed. Build and typecheck passed. Lint passed with 1 untouched file with problems, none of the item's. The e2e skip is a recorded user decision (report.md:67, report.md:254).
- The test-quality gate is proven with 0 findings (review/test-quality.findings.md:6; review/ruling.json test-quality entry). The reviewer read the decide section of tests/unit/sharing-policy.test.ts in full and spot-checked 20 criteria.
- AC-25 is the only test change since round four. The test is at tests/unit/sharing-policy.test.ts:687 and I confirmed it exists. The reviewer cites its red run, logs/tdd-AC-25-red-1794259007760.txt, where 1 test failed against the old `reason === "allowed" ? "level-local" : reason` arm. The loop test at line 676 passed at red. The reviewer explains why: it pins existing behaviour, and it would catch a rewrite that always answered `level-local`.
- The behavior criteria are recorded red then green in report.md:32-53. The superseded ones (AC-6, AC-7, AC-14, AC-15) are replaced by AC-20, AC-21, AC-18 and AC-19, each with its own red record.
- The two observed criteria are justified. AC-18 has the same script run against the base (`--at 62780aa`), which exits 1, and on the tree, which exits 0, in probes/check-docs-at-base.md. AC-24 is a preservation check by `probes/check-preserve.ts`, which compares the base's snapshots byte for byte. The removed AC-13, AC-16 and AC-17 are on record at report.md:255-257.
- All seven judge rulings are proven, and every finding is advisory (review/ruling.json). The advisories are not QA matters. Examples are the throw at src/sharing/policy.ts:315, which no production path reaches, and the `Backups.vue` toast capture.
- The spec was validated by lead-qa in round 1 with 0 returns (report.md:142).
