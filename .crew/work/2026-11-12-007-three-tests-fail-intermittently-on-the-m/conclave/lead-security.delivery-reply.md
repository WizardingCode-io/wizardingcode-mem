# security lead's validation of 2026-11-12-007-three-tests-fail-intermittently-on-the-m: delivery
verdict: validated
## Returns
none
## Notes
- The committed code is what the spec's Design part 2 says. The three settings ride on `-c` in `configArgs` (`src/modules/knowledge/repo.ts:437-439`). `commitPaths` ends with `maintain` (`repo.ts:950`), which drops a `KnowledgeError` and logs anything else under the host's scope (`repo.ts:980-983`). `ALLOWED_SETTINGS` and the hooks path are untouched, so no new program can run.
- No git runs without the lease, and this is proven by a test, not only by reading. `tests/integration/team-mirror-maintenance.test.ts:111-112` asserts the call count is unchanged after the lease is taken and that the last call is the commit. Lines 107 and 122-126 prove the landed revision is recorded and the next run commits only the second revision, with a clean tree.
- The lost mirror lease is logged once under `team.mirror` (`team-mirror-maintenance.test.ts:116-119`), which closes the wording gap I noted at the spec.
- My R-1 holds in the committed ADR. `docs/adr/0024-knowledge-module.md:86` and `:195` say the housekeeping still runs, started by the runner in the foreground, and line 195 keeps the limit open in its words: unchecked files under `objects/`, the write through a link, the sync part to close it. Line 194 adds the timeout's leftovers as a known limit, and line 87 is the new rule.
- The `CLAUDE.md` defect I flagged is fixed. The sentence now follows "(a file) as its hooks path, and no template." whole (`CLAUDE.md:18`), and the hooks-path statement reads intact again.
- What is left is on record as deferred: the stale `maintenance.lock` and unkilled children (`docs/real-use/findings.md:72`), and the mirror's exposure between a lost lease and its next git call, including the `index.lock` removal and the record written without the lease (`findings.md:73`). Both rows state the facts as I read them in the code. Neither loses or corrupts the store's data, and the mirror is an export rebuilt from the database.
- The gates passed on the reported tree: secrets, build, test, lint and typecheck (`.crew/work/2026-11-12-007-three-tests-fail-intermittently-on-the-m/report.md:46-51`). AC-6 to AC-13 are each red then green (`report.md:33-40`), and AC-11 is 105 to 105.
- The engine's record lags the spec in three places, none of which the session can edit by hand and none a return:
  - `report.md:39` carries AC-12's earlier wording ("the run stops with its lost-lease error, as at any other git call"), while `spec.md:41` and the test prove the stronger rule.
  - `report.md:174` still states O-1 as the first draft's risk, a failed commit, which the design removed.
  - `report.md:125` records D-1 as "inside the commit".
- Not verified: the notice to the author that the mechanism changed inside D-1. `conclave.md:15` says the author is told in the delivery, and you say it is in the delivery message and the pull request. Neither is among the files I can read, and `report.md` does not carry it. My verdict rests on the code and the documents; that notice remains the session's to show.
- No security review seat ran on this route (`report.md:98-105`). The security reading of this delivery is this validation and the three spec rounds before it.
