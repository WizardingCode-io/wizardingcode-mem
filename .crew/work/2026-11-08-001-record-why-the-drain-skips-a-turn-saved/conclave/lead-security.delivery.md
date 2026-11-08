# security lead's validation of 2026-11-08-001-record-why-the-drain-skips-a-turn-saved: delivery
verdict: validated
## Returns
none
## Notes
- The security-relevant surface is small and holds. The stored value is `skip:<reason>`, built only by `skipMark(reason: SkipReason)` from a closed four-member union (review/diff.patch:69). No user, model or turn text reaches `last_error` for a skipped turn.
- Every SQL write and read is parameterised. The write is `UPDATE turns SET state = ?, ..., last_error = ? WHERE id = ?` (diff.patch:150). The status read is `... WHERE project_id = ? AND state = 'skipped' GROUP BY last_error` (diff.patch:267). Both are scoped to the project, so status does not count another project's turns. tests/integration/status-skips.test.ts:710 proves this with a second project's turn that is excluded.
- Parsing a stored value is guarded against prototype keys. `Object.hasOwn(SKIPPED_KEY, name)` stops `skip:constructor` from reaching the object's prototype (diff.patch:272-273). `skip:bogus` and `skip:constructor` both count as `unknown` (status-skips.test.ts:711, 724-730).
- The change adds no endpoint, auth, network access, migration or new data store. It writes only a fixed-vocabulary reason to an existing column, which matches the spec's no-schema-change decision D-1. A `done` turn clears `last_error` in the same write as its state (diff.patch:146-151), so an old error is not kept. A test proves this at distill.test.ts:532 (diff.patch:532-537).
- The reason code is a count and a label. It does not store the redacted turn text, so the redaction path is unchanged.
- Gates in report.md:26-33 all pass: secrets, prose, build, test, lint and typecheck. The judgement gates are proven. The four code-quality findings are advisory and none is a security matter.
- O-1 (report.md:105) is advisory. `last_error` is a misleading column name, and the write site and the status line document it. That is acceptable.
