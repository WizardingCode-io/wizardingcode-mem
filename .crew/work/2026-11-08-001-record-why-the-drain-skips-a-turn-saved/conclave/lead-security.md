# security lead's validation of 2026-11-08-001-record-why-the-drain-skips-a-turn-saved: spec
verdict: validated
## Returns
none
## Notes
- The change touches no security risk area. spec.md:16 stores only four fixed codes (`skip:saved`, `skip:empty`, `skip:not-worth`, `skip:no-title`) in `turns.last_error`. No turn text, path, secret or user input goes into the column. The counts are aggregates in `DrainReport` and `StatusReport`.
- No new input, route, network access, permission or dependency (spec.md:27-32). There is no schema change, so there is no migration risk and no data to reverse. Decision D-1 is on record as made by the user (skip-status.json, decisions).
- The viewer API already reads `last_error` as `lastError` (src/ui/api.ts:372, :415). That is the same local, token-protected viewer, and the codes are static strings, so showing them there leaks nothing.
- `last_error` is cleared to NULL on done (src/distill/pipeline.ts:309, src/store/turns.ts:141). A stale reason cannot persist on a turn that later succeeds. conclave.md:6-7 requires the reason to be written in the same UPDATE as `state='skipped'`, which matches the write at src/distill/queue.ts:89.
- Advisory only: the doctor message (src/doctor/checks.ts:199) says `last_error` means a failure, but it counts failed turns only, so it is still correct. The misleading column name is already recorded as objection O-1 (advisory).
- The three criteria AC-1 to AC-3 are each observable by a test: the column value, the `skippedBy` counts and the `status` output.
