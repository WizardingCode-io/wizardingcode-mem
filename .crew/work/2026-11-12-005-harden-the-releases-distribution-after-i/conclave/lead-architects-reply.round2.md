# architects lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: spec
verdict: validated
## Returns
none
## Notes
- R-1 is closed. Goal G-4 (spec.md:20), Design 4 (spec.md:74) and AC-14 (spec.md:95) carry the `docs/real-use/findings.md` update: what was done, the version rule pointed to the next item, and an open row for the git isolation and the git-call time limit. The non-goal at spec.md:25 now cites AC-14 instead of claiming the rows already exist. The rows it answers are `docs/real-use/findings.md:70` and `:71`.
- R-2 is closed. Design 4 (spec.md:75) and AC-15 (spec.md:96) put both rules in ADR 0029, amended in place as a draft, and in the Releasing line of `CLAUDE.md`. spec.md:100 names `tests/unit/release-docs.test.ts` as the test that holds them.
- AC-15's text omits "writes are tested through `commitAndPush`", which Design 4 (spec.md:75) includes. The build should write the sentence as the Design has it; the criterion's shorter text is enough for the test.
- The wrapper is placed as asked: once, on `options.runner ?? run`, with the environment passed through untouched (spec.md:48). That covers the `ls-remote` at `scripts/release/push.ts:82` and the three calls that bypass `must` (`push.ts:124, 140, 147`). `Runner` and `run` stay the one runner in `scripts/release/lib.ts:19-46`.
- The mask line goes through `process.stdout.write` and never `summary()` (spec.md:49), and AC-10 (spec.md:90) holds that the summary file never carries it. The summary's texts stay in `summaryLine` (`lib.ts:130`); the design adds no outcome.
- The command's wiring to the summary is kept on a stub `git` and held by AC-17 (spec.md:61-66, 98), so `push.ts:231` stays tested after the two write cases move to `tests/integration/release-push.test.ts`.
- `findings.md:71` also holds two things this item does not touch: `decideHold`'s `previous === null` branch with no case, and the three temporary folders of `deploy-files.test.ts`. When that row is rewritten for AC-14, they must stay recorded as deferred.
- spec.md:57 now says what `gitEnv`'s overwrite covers as the code does it (`push.ts:38-44`: only with a token, only on the calls given `authed`). No design change follows; it is the open row of AC-14.
- Unchanged from round 1: the placement of the three functions in `push.ts`, exporting `editTap` and `editMarketplace`, and moving the version rule to piece 2 all hold.
