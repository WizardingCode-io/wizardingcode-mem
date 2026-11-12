# architecture findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-architecture
read: the rubric; the spec (Design, AC-57 to AC-77); CLAUDE.md (where things are, commands, conventions); docs/adr/0008-m5-distribution.md (rows and follow-ups); ADR 0026's image paragraph; ADR 0029 (new); the whole diff.patch (38 files in files.txt); for the neighbouring code: scripts/build.ts (TARGETS, main guard), scripts/plugins.ts (exports, main guard), src/store/meta.ts:158, the callers of stageBinary, other writers of `<data dir>/bin`, and how the CLI reads its version (`package.json` import in main.ts, sync.ts, share.ts, status, ui)

## Findings
- F-1 · advisory · docs/adr/0026-team-server.md:88 · The change adds "Since ADR 0029 `latest` is no longer tagged by this job" to the end of the paragraph, but leaves the earlier sentence in that same paragraph unchanged: "pushes it … tagged with the version and, for a plain release, `latest`". The paragraph now says two opposite things about the `docker` job. Reword the earlier clause, for example "tagged with the version (until ADR 0029, also `latest`)", so the amended ADR agrees with `release.yml:87-89` (rubric Q5/Q6; documents only, no boundary crossed).
- F-2 · advisory · docs/adr/0029-release-distribution.md:3 · The header says ADR 0029 supersedes only "the Homebrew row" of ADR 0008. The decision also changes the rule ADR 0008 records for its npm row (`0008-m5-distribution.md:13`, "fetches its version of the binary on first run") and its curl row (line 10). The shim and `install.sh` now replace only an older binary. Name all three rows in the header, or add one sentence saying the npm and curl rows' replacement rule is amended by "The staged binary only moves forward". AC-76 asks only for the Homebrew row, so this is a precision point, not drift.

The checks that found no drift:
- **Layers.** The pure decisions are in `scripts/release/lib.ts` and the commands sit beside it. The version order is a leaf in `src/util/` (next to `legacy.ts`). `stageBinary` stays in `src/install/binary.ts`. Nothing new is on a hook path.
- **Imports.** `lib.ts` imports only `src/util/version.ts` and `scripts/build.ts`. `build.ts` has an `import.meta.main` guard and uses only built-ins, which keeps the Design's rule of "Bun's and Node's built-ins only".
- **Contracts.** The `stageBinary` signature change reaches its one caller (`install.ts:223`) and its tests. The `--force` flag is added to `install`'s USAGE.
- **Generated files.** The `plugin/` and `plugins/` copies change only through `scripts/templates/` and `OLDER_JS` in `scripts/plugins.ts`, as ADR 0009 and CLAUDE.md require.
- **Data directory.** `defaultDataDir()` is used as ADR 0010 requires.
- **Version source.** `install.ts` reads `pkg.version` the way the neighbouring commands do.
- **Workflow text.** The one summary line written in workflow shell (`latest: not moved`) is held to `summaryLine` by `tests/unit/deploy-files.test.ts:276-278`.
- **Rendered formula.** No file references the deleted `packaging/homebrew/wizardingcode-mem.rb`.
- **Design placement.** `distribute.yml`'s jobs, environments, permissions, conditions and pins match the Design table. `release.yml`'s three changes are built where the Design puts them.

## Outside the change
- .github/workflows/release.yml:20 · `release.yml` pins its actions by major tag (`actions/checkout@v7`, `docker/*@v3`, `docker/build-push-action@v6`, lines 20 to 107), and its checkouts keep credentials. The publish job's checkout at line 104 is in a hunk this diff edits (`fetch-depth: 0`) and still has no `persist-credentials: false`. The Design applies the pinning and credential rules to `distribute.yml` only, so this is debt, not a defect of this item: release.yml runs from the tagged commit's own copy and holds `contents: write`.
- src/store/meta.ts:158 · The sync lease compares versions with `Bun.semver.order` directly. Since this change, `src/util/version.ts` (`olderThan`) is the project's one stated version order (CLAUDE.md, ADR 0029). This existing comparison does not go through it.
- docs/adr/0008-m5-distribution.md:41 · ADR 0008's follow-up "Automate the rest of a release" is now done by ADR 0029. ADR 0008 itself carries no pointer to its successor; the spec's Non-Goals deliberately leave it unrewritten.

## Not answerable
- Integrations (Q4), for the four external writes (npm trusted publishing, the two pushes, the ghcr retag) · The project has no adapter layer for GitHub or npm in scripts, so I judged against the Design. Whether the calls behave as the Design assumes can only be shown by the first real dispatch, as the spec's Risks say.
