# qa lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: spec
verdict: validated
## Returns
none
## Notes
- R-1 holds. AC-25 (spec.md:224) now has a case for a tag that does not exist, a release that does not exist and a draft release, matching refusals 3 and 7 (spec.md:109, :113). The decision is stated as a pure function over what the command gathered (spec.md:117), so each refusal is unit-testable.
- R-2 holds. AC-26 (spec.md:225) has "held, naming the read that failed" for the file present but unreadable at the previous plain release, and "not held, marked as released by hand" when `release_hold` is true, matching spec.md:119. The parser test now compares its reading with the constants the file exports, so a contract bump needs no test edit.
- R-3 holds. AC-27 (spec.md:226) has the version mismatch exiting 1 and `--dry-run` on a dry run. The dry run is proven for the other targets too: AC-34 (spec.md:233) "a dry run leaves the remote as it was", AC-30 (spec.md:229) conditions `latest`'s retag step on no dry run, and AC-35 fixes the "would …" lines.
- R-4 holds. The writer is named as `scripts/release/push.ts` (spec.md:145-149), and AC-34 (spec.md:233) runs it against a local bare repository: no commit on an unchanged tree, one commit `wizardingcode-mem <version>` on a changed one, one rebase on a refused push, and a dry run that writes nothing.
- R-5 holds. spec.md:93 and :132 say `plan` writes the lines of the targets it causes to be skipped or held. `summaryLine` in `scripts/release/lib.ts` with the table at spec.md:125-130 is the one source of the texts, and AC-35 (spec.md:234) proves both.
- R-6 holds. `token.ts` with no token is always a failure (spec.md:158, AC-28). The green run before the setup comes from the separate `door` job with no environment (spec.md:160), which AC-31 (spec.md:230) pins. The contradiction is gone.
- R-7 holds. spec.md:75 now cites `tests/integration/plugin-script.test.ts:103-114`, which is where both package versions are held to the root's.
- For the plan, not returns:
  - J-4 (spec.md:59) quotes the held line as `latest held: …`, while the table (spec.md:130) fixes it as `latest: held: …`. AC-35 binds the table's text; I would prefer the journey to quote the same.
  - "A second refusal exits 1" (spec.md:148) is not in AC-34. I would prefer the plan's test for `push.ts` to cover it alongside the single-rebase case.
  - `door.ts` is described as "the same reading of the environment as `plan`'s refusal 9" (spec.md:160). The plan should have both call one function, so AC-25's environment cases prove both.
  - Still open from round 1 for the plan: `tests/unit/deploy-files.test.ts:165-167` asserts the `latest` line that AC-29 removes and must be changed with it. AC-21 needs the compiled binary from `tests/helpers/binary.ts`, because `install` from source exits before staging (`src/cli/commands/install.ts:238-244`). The title of `tests/integration/npm-shim.test.ts:110` describes the old rule.
- Files read this round: `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md` and `conclave.md` (lines 36-49) in the same folder.
