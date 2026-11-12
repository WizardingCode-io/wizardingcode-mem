# architecture findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-architecture
read: the rubric; the spec (Design and AC-57 to AC-78); CLAUDE.md; docs/adr/0008-m5-distribution.md, the ADR status-line convention across docs/adr/ (0004 marked "superseded by ADR 0011"); the diff's 0026 and 0029 hunks; the whole diff.patch (39 files); the base it touches: scripts/build.ts (TARGETS, guarded by import.meta.main), src/store/meta.ts:158, every caller of stageBinary, every writer of `<data dir>/bin` in src/, and tests/unit/deploy-files.test.ts:260-310 (it holds the `latest` job's summary texts)

## Findings
- F-1 · advisory · docs/adr/0029-release-distribution.md:3 · ADR 0029 says it supersedes ADR 0008's Homebrew row and amends its npm and curl rows. ADR 0008 is still "Status: accepted", with no pointer forward, and its "Left to do" still lists automating the release. The project's own convention is to mark the older ADR (0004: "Status: superseded by ADR 0011"), and this diff does add a forward pointer to ADR 0026. The fix is one sentence on 0008's status line, for example "Homebrew row superseded, npm and curl rows amended, by ADR 0029". That is not the rewrite the spec rules out as a non-goal (rubric question 6).
- F-2 · advisory · .github/workflows/distribute.yml:105 · The npm job checks the npm version with inline code in the workflow: `bun -e` calling `Bun.semver.order` directly. The Design puts the release's decisions in `scripts/release/lib.ts` and gives `src/util/version.ts` as the one TypeScript order. This check orders npm's version, not the staged binary's, so it crosses no boundary. Still, it is the only decision of the workflow that lives outside lib.ts and outside a unit test. It could be a small function in lib.ts called by `npm.ts` (rubric question 6).

## Outside the change
- docs/adr/0008-m5-distribution.md:10-14 · The table still names the retired shibaox paths and repositories (`~/.shibaox/mem/bin`, `WizardingCode-io/homebrew-shibaox`, `shibaox-plugins`, `SHIBAOX_MEM_VERSION`). It is a historical record written before ADR 0011; this is debt, not caused by this diff.

## Not answerable
- none

Notes for the judge: no defect found. Each part of the change sits where the Design puts it:
- Release decisions are pure functions in `scripts/release/lib.ts`. The commands beside it use only Bun and Node built-ins plus `src/util/version.ts` and `scripts/build.ts` (TARGETS, a guarded import with no side effects), so the release's six assets come from the one build list.
- The one version order is `src/util/version.ts`, `OLDER_JS` generated into `plugins/opencode/binary.js` and the npm shim, and the shell `older()` copied into `scripts/install.sh`, all held by `tests/fixtures/version-order.ts`. The generated plugin files changed only through the template (ADR 0009).
- The `stageBinary` contract change has a single production caller, `src/cli/commands/install.ts:223`, which is updated, and no other code writes `<data dir>/bin`. The `--force` flag is in USAGE.
- `release.yml` no longer tags `latest`. ADR 0026 and the team runbook say so, and ADR 0029 records it.
- The token reaches git only through the child process's environment (`scripts/release/push.ts:1911-1923`). `secrets.MARKETPLACE_TOKEN` appears only in step `env:` blocks of `tap` and `marketplace`.
- The two summary texts the workflow writes itself (`distribute.yml:194`, `:210`) are tied to `summaryLine` by `tests/unit/deploy-files.test.ts:276-307`, so the "texts in one place" rule holds.
- The contract file is read as text, which the Design chose (D-2).

Files referenced:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0029-release-distribution.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0008-m5-distribution.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/distribute.yml
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/deploy-files.test.ts
