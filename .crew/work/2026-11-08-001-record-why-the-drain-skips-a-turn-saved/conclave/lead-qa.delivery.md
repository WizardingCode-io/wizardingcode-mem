# qa lead's validation of 2026-11-08-001-record-why-the-drain-skips-a-turn-saved: delivery
verdict: validated
## Returns
none
## Notes
- Each of the three criteria has a recorded red run and a green run, and the latest green decides (evidence.json:3-99).
  - AC-1: red at evidence.json:6-20, exit 1 with 13 failures, for example `reason: null` where `skip:no-title` was expected. Green at :21-30, 58 pass.
  - AC-2: red at :34-48, where the CLI printed "1 skipped" and the test expected "1 skipped (not-worth 1)". Green at :49-58 (re-run, latest) and :59-70, 6 pass.
  - AC-3: red at :74-88, where `skippedBy` was undefined. Green at :89-98, 2 pass.
- Each reason in AC-1 is asserted against `turns.last_error` in the database, in tests/integration/distill.test.ts.
  - `skip:saved` at line 704, `skip:empty` at 1114, `skip:not-worth` at 1120 and 1130, `skip:no-title` at 1136.
  - A done turn clears any earlier failure text (line 1141 and the test-quality findings).
- AC-3 edge cases are covered in tests/integration/status-skips.test.ts and doctor.test.ts, per review/test-quality.findings.md:19-24: NULL counts as `unknown`, another project's turns are excluded, and `skip:constructor` falls into `unknown`.
- The QA gates passed on the merged tree. All five are at fingerprint sha256:75fe6078… (evidence.json:114-185) and match the report's fingerprint.
  - build: pass.
  - test: pass, 2026 pass, 0 fail (:155).
  - lint: pass with warnings only (exit 0).
  - typecheck: pass.
  - secrets and prose scans: pass.
- The test-quality gate is proven with 0 findings (evidence.json:343-352). The code-quality gate is proven with 4 advisory findings, none a defect. The judge upheld them as advisory with reasons (report.md:42-45).
- The `changedTests` list is the same in all three reds (distill-cli, distill and status-skips tests), so the reds ran against the changed tests.
- O-1 (advisory objection, report.md:105): `last_error` is a misleading name for a skip reason. It is documented at the write site and in the status line, so it does not block.
- One thing is outside QA scope. Pre-change skipped turns show as `unknown`, which spec.md:30 lists as out of scope.
