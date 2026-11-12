# qa lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: delivery
verdict: validated
## Returns
none
## Notes
- I ran nothing: this is a read of the report, the ruling, the probe, the four test files, `scripts/release/push.ts` and the gate log. `review/diff.patch` was not opened; I read the changed files in the tree instead.
- The test gate passed on the tree the report fingerprints: `3410 pass`, `0 fail` (.crew/work/2026-11-12-005-harden-the-releases-distribution-after-i/logs/test-_-1794505455891.txt:78-80; report.md:51). All six judgement gates are `proven` with advisories only (report.md:59-64).
- AC-6 is held at tests/unit/deploy-files.test.ts:203 against .github/workflows/release.yml:156.
- AC-9 has one case per sentence site, each asserting `Authorization: Basic ***` is present and the encoded value absent (tests/integration/release-push.test.ts:281-308).
  - The tag read is among them. It goes through the wrapper at scripts/release/push.ts:95-101, so redaction placed in `must` alone would fail it.
  - The dry-run lines are at :310-328.
  - The complement is at :330-360: git's own text comes back as the exact sentence with a token set, and the quoted header is kept with `token: null`. `redact` is also tested directly at :431-442.
- AC-11 has four cases: both targets, on and off a runner. Each asserts the `ls-remote --tags https://github.com/o/r.git` call, the `clone --quiet <remote> .` call, and no `elsewhere.git` (tests/integration/release-commands.test.ts:447-465). The stub reaches the clone (:386-389), which is what round 1's R-1 asked. The names `PUSH_REMOTE`/`PUSH_ORIGIN` are left only there in `scripts`, `src` and `tests`, apart from a string the docs test looks for.
- AC-12: both edits run through `commitAndPush` on local repositories. The tap's second run answers `already-at` with one commit; both manifests are read back; the lower version is left alone with the head unmoved (release-push.test.ts:391-427). The fixtures hold no `9.9.9`, so the loose `toContain("9.9.9")` at :420 is not vacuous.
- AC-17 (round 1's R-2): the three command cases are kept on the stub (release-commands.test.ts:418-444), and the marketplace edit is shown to have run through `committed.json` (:433).
- AC-17 advisory: the tap case would also pass with an edit that writes nothing, since the stub's `status --porcelain` always reports a change (:391). The formula itself is proven only below the command (release-push.test.ts:403-405).
- AC-19: the failing clone prints the header from its own `GIT_CONFIG_VALUE_0` (release-commands.test.ts:373, :388), so the value tested is the one `push.ts` built. Standard output, standard error and the summary are all checked for `***` and for the absence of the value (:481-485); the dry run likewise (:488-501).
- AC-19's red was recorded after the code, with the wrapper's two `redact` calls switched off and then restored; AC-17's baseline was recorded with `push.ts` put back to the item's base (probes/lint-by-name.md:14). The tests do fail without the code, but test-first does not hold for AC-19. report.md:39 says only "red then green"; the pull request's description should carry the probe's sentence.
- AC-20: the paragraph is found by `gh run list --workflow distribute.yml` inside "Repeating a target", exactly one, with the minutes read from `release.yml` (tests/unit/release-docs.test.ts:111-129; docs/runbooks/release.md:64).
- AC-21: the two answered rows cite the item and are no longer deferred (docs/real-use/findings.md:70-71), and the test holds that (release-docs.test.ts:141-149).
- AC-21 partial coverage, as the judge ruled advisory (report.md:71): `PUSH_ORIGIN` is not looked for, and "time limit" is a loose phrase (release-docs.test.ts:145, :153). The file itself does name both variables (findings.md:71).
- AC-22 partial coverage, also ruled advisory (report.md:70): the ADR test holds the bare token `::add-mask::` (release-docs.test.ts:166), not that the ADR says the runner masks the base64 itself or why no line is printed. A later edit that inverted that sentence would pass. Worth tightening in the next item that touches the file; not a blocker.
- From my spec validation, the mask-order cases (`VERSION` unset, the value once in standard output, the three no-mask cells) went with AC-10 and AC-16 when the `::add-mask::` line was removed (conclave.md:53-55). Nothing that survived the change is unbuilt.
- The lint gate checked no file of the item inside the worktree; the by-name run is recorded: 9 files, no fixes (probes/lint-by-name.md:3-10; report.md:52).
- Mutation testing was not answerable for this stack (review/test-quality.findings.md:13).
