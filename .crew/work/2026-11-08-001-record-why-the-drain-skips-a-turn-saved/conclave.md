# Conclave

## Assumed by good practice

- The four reason codes are named constants in one place (`pipeline.ts`), and the queue, the CLI and `status` read them from there.
- Writing the reason happens in the same `UPDATE` that sets `state = 'skipped'`, so a crash cannot leave a skipped turn with no reason, or a reason on a turn that is not skipped.
- A turn that the drain retries and then distils clears its reason, because `finish("done")` sets `last_error` to NULL as it does today.
- Existing tests of `distillTurn`, `drainQueue` and `status` keep passing.

## Decisions only the user can make

- D-1: where the reason is stored. Answered by the author: in `turns.last_error`, with no migration.

## Proposals

- Later, the cleanup item (D-1 of ADR 0023) can select `state = 'skipped' AND last_error IN ('skip:no-title', 'skip:not-worth')` to distil again.

## Warnings

- `last_error` is a misleading name for a skip reason. It is accepted to avoid a migration, and it is documented at the write site and in the status line. Advisory.
