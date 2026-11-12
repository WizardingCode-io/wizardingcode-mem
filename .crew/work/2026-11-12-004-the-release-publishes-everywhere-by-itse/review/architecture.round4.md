# architecture findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-architecture
read: the rubric; spec.md (Design, AC-57 to AC-78); CLAUDE.md (Where things are, Commands, Conventions); docs/adr/0008-m5-distribution.md, 0009-native-installation.md, 0026-team-server.md (image paragraph), 0029-release-distribution.md; docs/real-use/findings.md (rows dated 2026-11-12, "release distribution"); review/diff.patch in full (41 files in files.txt); for context, src/cli/commands/install.ts (run), scripts/build.ts (TARGETS), tests/unit/deploy-files.test.ts (the `latest` job's checks), and the callers of stageBinary and Bun.semver.order

## Findings
- F-1 · advisory · docs/adr/0029-release-distribution.md:3 · The status line links ADR 0009 as `0009-native-install.md`, but the file is `docs/adr/0009-native-installation.md`, so the new ADR's citation of the base it says is unchanged goes nowhere. Fix: link to `0009-native-installation.md`. No test catches this: `release-docs.test.ts` checks the runbook's cited files, not the ADR's.
- F-2 · advisory · scripts/release/lib.ts:1-118 · CLAUDE.md (the line added at diff 297) and ADR 0029 ("The decisions are pure functions in `scripts/release/lib.ts`") describe lib.ts as the pure decisions. The file also holds the side-effecting edge: `run` (spawns programs), `summary`/`output` (append to the `GITHUB_STEP_SUMMARY`/`GITHUB_OUTPUT` files) and `command` (calls `process.exit`). The base does not define this layer, so nothing is crossed. Either move those four into a separate module next to the command files, or make the CLAUDE.md and ADR sentence say that lib.ts also carries the commands' shared runner and summary writer.

Checked and found consistent with the base:
- The two workflows follow the Design's job table, environments, permissions and conditions. The `latest` job's two summary lines written inline are held to `summaryLine` by `tests/unit/deploy-files.test.ts:276-307`.
- The generated files (`plugin/`, `plugins/*/wizardingcode-mem.sh`, `plugins/opencode/binary.js`) change only through `scripts/templates/wizardingcode-mem.sh` and `OLDER_JS` in `scripts/plugins.ts`, so ADR 0009's generation rule holds. The "never downgrades" rule ADR 0009 already stated now holds in every writer.
- The `stageBinary` contract changed (options in, `{ path, kept }` out), and its only production caller (`install.ts:223`) and all its tests move with it. `--force` is in `install`'s USAGE.
- `<data dir>/bin` is still reached through `defaultDataDir()` (ADR 0010).
- ADR 0008's status line and ADR 0026's image paragraph are amended where ADR 0029 says it supersedes or amends them.
- The hold reads `CONTRACT`/`ACCEPTED_CONTRACTS` exactly as ADR 0026 and CLAUDE.md declare them, with the parser held to the real file by a test.
- `src/util/version.ts` sits beside the other utilities, and the release scripts import it with explicit `.ts` extensions.

## Outside the change
- src/store/meta.ts:158 · `takeOverLease` orders versions with `Bun.semver.order` directly rather than through `src/util/version.ts`, the one TypeScript version order this item sets up. This is debt, already deferred in docs/real-use/findings.md.
- .github/workflows/release.yml:100-111 · Lines the diff did not introduce still reference actions by moving tag (`actions/checkout@v7`, `actions/download-artifact@v8`, `docker/build-push-action@v6`), and their checkouts keep credentials under a workflow-level `contents: write`. `distribute.yml` holds the opposite rules (pinned by SHA, `persist-credentials: false`). This is debt, already deferred in docs/real-use/findings.md.

## Not answerable
- Data model (rubric question 2) · The change touches no schema, table or migration: none of core, the module namespaces or team.db. Nothing here to judge.
- Integrations against a project adapter (rubric question 4) · The base names no adapter for GitHub, npm or ghcr.io. The scripts call `gh`, `git` and `npm` through the one runner in `scripts/release/lib.ts`, and every write to another repository goes through `scripts/release/push.ts`, as the Design says. There is nothing beyond the Design to judge them against.
