# architects lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: delivery
verdict: returned
## Returns
- R-1 · docs/runbooks/release.md:28 · Change "The first tag after this setup exists is pushed after steps 1 and 2 and before step 3, while there is no environment" to the spec's wording, "The first tag that carries this item is pushed after steps 1 and 2 and before step 3, while the environment does not exist" (spec.md:219). As written, the sentence contradicts itself: the setup cannot exist before step 3. Read as "finish the setup, then tag", the tag's automatic run makes the two npm publishes with no dry run first, and those cannot be undone (spec.md:274). The dry-run-first order lives only in this runbook, not in code. The risk seat raised it (review/risk.findings.md:8) and the judge upheld it (review/ruling.json, risk gate, docs/runbooks/release.md:419), but the line is unchanged in the tree.
- R-2 · docs/adr/0008-m5-distribution.md:3 · Extend the status line with a pointer forward, for example "Status: accepted; Homebrew row superseded, npm and curl rows amended, by ADR 0029". This is one clause, not the rewrite the spec's Non-Goals exclude (spec.md:50). The proof it rests on:
  - docs/adr/0029-release-distribution.md:3 declares the supersession, but 0008 still reads plain "accepted".
  - docs/adr/0008-m5-distribution.md:14 names a "source copy in `packaging/homebrew/`" that this item deleted; only `packaging/homebrew/wizardingcode-mem.rb.template` remains.
  - docs/adr/0008-m5-distribution.md:41 still lists as "Left to do" the automation this item delivers.
  - The repository marks the older ADR (docs/adr/0004-brand-and-name.md:3, "superseded by ADR 0011"), and this same diff gave ADR 0026 its pointer (docs/adr/0026-team-server.md:88).
  - The architecture seat raised it (review/architecture.findings.md:6) and the judge upheld it; it is unchanged in the tree.

Both returns are document-only lines; no code, test or workflow needs to change for them.

## Notes
- I ran nothing: the gate and judgement results below are read from report.md and review/ruling.json, and the code claims from the files cited.
- No task briefs exist (the item was built inline), so "what changed, what was proven, what is left" was read from report.md alone.
- **Gates my team owns:** architecture and risk are both "proven" in round 3 with advisories only (report.md:78-79, review/ruling.json). The mechanical gates (build, test, lint, typecheck, and the npm and plugins/opencode tests) pass (report.md:62-69).
- **Criteria:** AC-57 to AC-73 and AC-78 are recorded "red then green" (report.md:35-56). AC-74 and AC-76 are observed; AC-75 and AC-77 are superseded by AC-78.
- **Design followed, release decisions:** the commands under scripts/release/ import only `./lib.ts` and Node built-ins. `lib.ts` imports `src/util/version.ts` and `scripts/build.ts` (`TARGETS`) and nothing else (scripts/release/lib.ts:5-7).
- **Design followed, version order:** the TypeScript order is `olderThan` over `Bun.semver.order` (src/util/version.ts:18-21). `stageBinary` uses it and has the `{ version, force }` to `{ path, kept }` contract (src/install/binary.ts:34-56). Its only production caller is src/cli/commands/install.ts:223, and `--force` is in USAGE (install.ts:69, 74).
- **Design followed, workflow:** .github/workflows/distribute.yml matches the Design's job table.
  - Top-level `permissions: {}` (line 38).
  - `environment: release` on `npm`, `tap` and `marketplace` only (lines 77, 117, 149).
  - `id-token: write` on `npm` only (line 80); `packages: write` on `latest` only (line 178).
  - `npm` checks out `needs.plan.outputs.sha` (line 87).
  - `latest` runs under `!cancelled()` with a first step that fails when a needed job did not succeed (lines 174, 184-191).
- **Base documents:** ADR 0029 records D-1 to D-5, the carried decisions, the alternatives and the limits, including the `--force` limit at line 59 (docs/adr/0029-release-distribution.md:25-65). The checkout's CLAUDE.md names the two workflows, `scripts/release/lib.ts`, the environment `release`, the forward-only rule, the runbook and the ADR. ADR 0026 points forward at line 88.
- **Advisory, runbook placeholders:** docs/runbooks/release.md:47 writes the hold line as `<previous> speaks <n>`, reusing `<n>` for two different contracts. Line 87 and spec.md:151 write `<m>`. It could be fixed in the same commit as R-1 if `tests/unit/release-docs.test.ts` and `summaryLine`'s table text allow.
- **Advisory, npm version check:** the inline `bun -e` check at .github/workflows/distribute.yml:99 is the one decision outside `scripts/release/lib.ts` and outside a unit test. It crosses no boundary; a follow-up, not a return.
- **Advisory, ruleset refusal:** scripts/release/push.ts:126 matches `GH006|protected branch` but not a ruleset's `GH013`, so the runbook's named repair never shows for a ruleset refusal. The push still fails visibly and can be repeated.
- **For piece 3:** the `latest` job holds `packages: write` outside the environment (distribute.yml:172-178), and `latest` can be moved outside the workflow (ADR 0029:54). Piece 3's spec must take both up, since it adds the first reader of `latest`.
- **Engine bookkeeping:** report.md:145 shows "Rounds: judgement 3 of 2, validation 3 of 2". The rounds went over the planned count; I did not treat it as a fault of the delivery.

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/runbooks/release.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0008-m5-distribution.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0029-release-distribution.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/distribute.yml
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/report.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/review/ruling.json
