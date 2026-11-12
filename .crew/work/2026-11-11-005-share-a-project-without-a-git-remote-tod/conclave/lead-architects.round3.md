# architects lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: spec
verdict: validated
## Returns
none
## Notes
- R-1 is answered. `setLevel` gains `dryRun`, which runs the whole refusal chain in a read and writes nothing (spec.md:96, :112). The chain order is stated at :97-104, with `needs-confirm` last, at every level (:104).
  - The two-phase write is stated at :112: dry run, then the server (create or join), then the write.
  - The race is said: the answer carries `named: true` and a sentence, and the risk is recorded at :240. It is also in "Alternatives considered" (:231).
  - The viewer route order is at :193: local refusals, then the contract check from the stored row, then create or join, then the write. The CLI order is at :205: dry run, then the question, then the server, then the write.
  - AC-18 (:276) and AC-19 (:277) cover the refusals decided before any request, the test server seeing none, and the `named: true` case after a flip between dry run and write.
- R-2 is answered. The registry check lives in `push.ts`, inside each item's transaction, after the pure checks (:156). The per-item order is stated: pure checks, `purged`, registry, ownership, base, rate, disk.
  - I confirmed this against `src/team/push.ts:196-233`. `checkEntryPayload` runs before `transaction` at :199, and `isPurged` is at :200. The registry check fits right after :200.
  - `validate.ts` stays pure and learns only the `name` reason and its rule text. `nameByAlias` stays in `store.ts` (:146). AC-15 keeps the store-boundary test.
  - The move rule is at :156 and AC-16 (:273). The new alias must be held when it is a name. The tombstone under the old alias, written at `push.ts:252-268`, needs nothing from the registry. A move to an unheld name writes no tombstone.
  - One implementation caution, not a return: the idempotent-replay shortcut at `push.ts:202-211` comes after `purged`. With the registry check placed before it, a replay under a name the operator later purged is refused `name`, not `applied`. This is consistent with the stated order. Cover it only if the plan wants the point pinned.
- My two earlier notes are taken. The boundary tests need no change (AC-14, :90). The client's `remote_alias` columns keep their names (:41, AC-20).
- The contract seam fits the architecture. `Context.contract` goes in `src/team/types.ts`, the leaf that already holds `Context`.
  - Today `auth.ts:47-48` and `routes.ts:240,265` read the constants directly. The spec moves them to `ctx.contract.accepted` and `.current` (:148). `serve` passes the constants, `contract.ts` stays the one grammar, and `tests/helpers/team.ts` takes `contract`.
  - No SQL is added outside `store.ts`. The names routes answer the route table's own 404 below contract 2, so a test server at 1 behaves as a 0.7.0 server.
- The names routes, the confirmation of a name binding, the preview route and `serve purge name` fit the architecture.
  - Names are listed by `listNames` and `nameByAlias` in `store.ts` alone. `purge name` is SQL in `store.ts` (`currentItemsUnder`, `deleteName`), with a CLI entry in `serve.ts`.
  - `mirror.ts`'s `purgeItem` needs no change: a name row is no mirror file, and the items are purged first.
  - The preview route calls `setLevel` with `dryRun` in the viewer's server process. It sends no request and writes nothing.
  - The by-alias route judges `isSharedName` before any SQL, so it cannot be used to probe for a remote.
- Hooks stay off the network. The `/v1/me` refresh runs in `startSteps` inside the detached sync process. The viewer routes and the CLI call the server; `resolveProject` and every hook path are unchanged.
- The identity leaf has no imports. The three SQL prefilters use `TEAM_ALIAS_SQL` and each still judges in code with `isTeamAlias`. The two `remote:`-by-meaning prefilters are named as non-goals.
- The data model holds. Team schema 2 renames four columns, and the spec says `RENAME COLUMN` carries `changes_scope`. Core migration 8 is deliberate (D-5), so a 0.7.0 binary refuses the store instead of withdrawing what it sent. The rollback is stated for both client and server.
- Alternatives are faced and reasoned, including the two this revision adds (create before the local refusals; no erasure of a name).
