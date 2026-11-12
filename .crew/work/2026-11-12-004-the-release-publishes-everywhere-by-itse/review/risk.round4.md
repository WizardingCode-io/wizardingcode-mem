# risk findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-risk
read: spec, plan, 41 files

## Findings
- F-1 · advisory · docs/runbooks/release.md:33 · The first release tests all four external writes at once, on a plain tag. The npm publish to dist-tag `latest`, the pushes to the tap and the shared marketplace, and the retag all go out for real in one dispatch, after a dry run that tests none of them (spec.md:219, :272). The spec states this and its way back is a higher version, so it is advisory. Making the first tag that carries this item a pre-release (`v<next>-rc.1`) would exercise trusted publishing and the OIDC path under `next`, where no unpinned user sees it, before a plain tag writes to npm `latest`, the tap and the marketplace. `plan`'s rules already allow the plain tag after it (refusal 7).
- F-2 · advisory · .github/workflows/distribute.yml:104 · The first real publish moves npm users from 0.4.4 straight to the new version in one step. Every unpinned `npx wizardingcode-mem` and every OpenCode install of `wizardingcode-mem-opencode` (written unpinned by `src/install/opencode-plugin.ts`) jumps to the new version at their next start, across every store migration since 0.4.4. After that the 0.4.4 shim still on their machine refuses the migrated store. The spec says only that the versions in between are not published (spec.md:48) and that old shims keep their rule (spec.md:285). Its Risks does not name this group's first-hour exposure. The way back exists (a higher version; a backup restore, per the runbook's "A person's way back"), so this is advisory. One line in Risks, or an rc under `next` first (F-1), would cover it.

## Outside the change
- .github/workflows/release.yml:104 · `release.yml` still references `actions/checkout@v7`, `actions/download-artifact@v8` and `docker/build-push-action@v6` by moving tag, under a workflow-level `contents: write`. Its output now travels by itself to the tap's checksums and to `latest`. This is debt the repository already carried, and docs/real-use/findings.md already defers it. Advisory.

## Not answerable
- none

Notes for the judge, not findings:
- Two round-3 advisories are closed in this diff:
  - The rule refusal now matches `GH013` and "repository rule violations" (scripts/release/push.ts, the `first.stderr` test).
  - The runbook now says "the first tag that carries this procedure".
- Round 2's missing summary line on a failed retag is also closed: the retag step writes `latest: failed: …` before it exits.
- The other earlier risk advisories are deferred in docs/real-use/findings.md and are not repeated above:
  - whether anyone is notified when the dispatched run fails;
  - the tap has no forward-only check of its own;
  - a third dispatch replaces the pending run;
  - the template and scripts are read from `main`.
- Checked and found sound:
  - the `latest` job is skipped when `plan` refuses (its outputs are empty);
  - a staged binary's `--version` is answered before any store or legacy-migration code runs (src/cli/main.ts:58);
  - the hand-over in `install` cannot loop, since the staged binary staging itself returns `kept: null`;
  - both npm packages carry the `repository.url` that trusted publishing's provenance needs;
  - `push.ts` ignores the local remote overrides on a runner.

Files: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md, /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/review/diff.patch
