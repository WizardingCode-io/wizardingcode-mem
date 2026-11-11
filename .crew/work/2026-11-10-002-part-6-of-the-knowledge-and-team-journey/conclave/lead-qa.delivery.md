# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: delivery
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/work.json:829 · AC-85 (preserve) is still a live criterion. It has no `supersededBy`, no removal, no skip and no record, and report.md:20 lists "test-first record missing for AC-85". Because of that, test-quality, the gate qa owns, is "not proven" at report.md:155. Its one defect (review/test-quality.findings.md:6, review/ruling.json, the test-quality entry) is that AC-85's "passes unchanged" is false for tests/unit/ui-sharing-copy.test.ts. The person's decision D-10 (work.json:1089-1095, 2026-11-11) retires AC-85 in favour of AC-92, but nothing in the engine records that retirement, and the gate cannot waive a live criterion. What must change: the engine has to record the retirement. Two ways are open. One is a skip of AC-85's test-first step that the policy lists, with D-10 as its recorded reason; per the earlier finding, the engine needs `policy.json` to list the step and the person to decide it. The other is an engine-side retire of a supersede-chain head that has no record. Then the test-quality judgement gate runs again on the unchanged tree, so F-1 closes and the gate reads proven. Until test-quality passes on the merged tree, I cannot validate this delivery on proof.
## Notes
- The substance AC-85 guarded holds under AC-92.
  - AC-92 (work.json:868, observed) names every change the reviewer found in tests/unit/ui-sharing-copy.test.ts: the saveSettings call at :100, the two signature regexes, the Servers card cases and the dock's Receive only case.
  - The reviewer confirmed the file's changes are now exactly those (review/test-quality.findings.md:10). Round 5's F-2 is fixed: :103-109 matches the base again.
  - AC-92's observed record stands at report.md:135, with the gate's whole-suite run passing.
- report.md:129 is the observed record of AC-86, now superseded by AC-92. It says "the preserve criterion AC-85 was removed". work.json:829 shows that is not so. That record line is stale and cannot be edited, but it should not be quoted as proof that AC-85 is retired.
- The behaviour criteria have red-then-green records: AC-15, AC-35, AC-69, AC-70, AC-77, AC-79, AC-80, AC-87, AC-88, AC-89 and AC-90 (report.md:59, 79, 113, 114, 121, 123, 124, 130-133).
- The observed criteria AC-62, AC-91 and AC-92 have their records at report.md:106, 134 and 135.
- AC-91's measurement is in the evidence (report.md:100): scripts/proof/upgrade-copy.ts ran on a 66.8 MB fixture and the first open took 124 ms, within the 10 s bar.
- Round 5's F-3 is closed: tests/unit/team-validate.test.ts is untouched by the diff (review/test-quality.findings.md:12). The server's tests are therefore unchanged as AC-91 states.
- The gate's last run passes (report.md:141-147): secrets, prose, design-lint, build, test (184 s, every suite), lint and typecheck. Lint's one untouched file with problems is not the item's. e2e is skipped under the standing decision of 2026-11-09 (report.md:148, 538).
- Two test-quality advisories remain. Neither is a return.
  - ui/src/components/settings/Sharing.vue:99: no test checks that the card calls `serverChange`, the name it passes, or its fallback to the old host or "a server" (review/test-quality.findings.md:7).
  - The Servers card's class search runs over the whole file (review/test-quality.findings.md:11).
  - Both are worth a follow-up test, but each is a coverage gap at advisory level, and the shown text is in the captures under review/ui/.
- The item has no tasks/ folder (no briefs under .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/tasks/). For each piece of work, what changed, what was proven and what is left is read from the ADR's "What building changed from the plan" and from the report.
