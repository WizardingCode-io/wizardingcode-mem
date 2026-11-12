# architects lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: delivery
verdict: validated
## Returns
none
## Notes
- I ran nothing: the gate and judgement results are read from report.md, and the fixes from the files cited.
- **R-1 closed:** docs/runbooks/release.md:32 now reads "The first tag that carries this procedure is pushed after steps 1 and 2 and before step 3, while the environment does not exist". The contradiction is gone and the order matches spec.md:219. Lines 28-30 add the advice to make the first tag a pre-release and name the 0.4.4 jump for unpinned npm users, which covers the risk gate's two round-4 advisories (report.md:89-90).
- **R-2 closed:** docs/adr/0008-m5-distribution.md:3 keeps "accepted" and points to ADR 0029 for the superseded Homebrew row, the amended npm and curl rows and the automation listed as left to do. It is one clause, not the rewrite the spec's Non-Goals exclude (spec.md:50).
- **Round-1 notes taken:**
  - The hold line uses one spelling at docs/runbooks/release.md:51 and :91, with line 91 explaining that each `<n>` is that release's own contract number.
  - scripts/release/push.ts:127 now matches `GH013` and "repository rule violations", with both cases in tests/integration/release-push.test.ts:188-191.
  - docs/adr/0029-release-distribution.md:3 links `0009-native-installation.md`, which exists.
  - docs/adr/0029-release-distribution.md:13 and the checkout's CLAUDE.md describe `scripts/release/lib.ts` as the pure decisions plus what the commands share.
- **Gates my team owns:** architecture and risk are "proven" in the fourth judgement round with advisories only (report.md:78-79, 89-95). The mechanical gates pass on the re-run (report.md:62-69).
- **Advisory, runbook step 4:** docs/runbooks/release.md:37 calls the real dispatch "the first test of those four writes". With the pre-release first tag that line 28 now advises, that dispatch tests only the npm publish; the two pushes and the retag are first tested by the plain tag, as line 28 says. A wording follow-up, not a return.
- **Advisory, release.yml timeout:** the `distribute` job in .github/workflows/release.yml:152 has no `timeout-minutes` (report.md:96), while every job in distribute.yml has 15. A consistency follow-up.
- **Advisory, version read:** `version_of` in scripts/install.sh:95 and `stagedVersion` in src/install/binary.ts:17-18 read a staged binary's version by slightly different rules (report.md:82). The order itself is held equal by the fixture table; aligning the two reads would suit piece 2, where `doctor` names the staged version.
- **For piece 3, unchanged from round 1:** the `latest` job holds `packages: write` outside the environment, and `latest` can be moved outside the workflow (docs/adr/0029-release-distribution.md:54).

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/runbooks/release.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0008-m5-distribution.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0029-release-distribution.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/report.md
