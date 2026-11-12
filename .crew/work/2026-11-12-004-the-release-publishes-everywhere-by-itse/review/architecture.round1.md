# architecture findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-architecture
read: the rubric; spec.md (Design, AC-57 to AC-77); CLAUDE.md (the worktree copy, with the diff's two new bullets); docs/adr/0008-m5-distribution.md (its Homebrew row and follow-up), docs/adr/0026-team-server.md (the image, the contract and skew, the follow-ups); the list of files in docs/adr/; scripts/build.ts (to check what lib.ts imports); src/cli/commands/install.ts (the run/hand-over path, cleanUpGemini); other callers of stageBinary and the `package.json` imports in src/; the full diff.patch (37 files in files.txt: both workflows, scripts/release/*, the generated plugin scripts and binary.js, the npm shim, install.sh, plugins.ts, the template, src/util/version.ts, src/install/binary.ts, install.ts, the four documents, tests).

## Findings
- F-1 · advisory · docs/adr/0029-release-distribution.md:3 · ADR 0029 says it supersedes only the Homebrew row of ADR 0008. But the change also reverses what ADR 0026 records. ADR 0026 line 88 says the `docker` job pushes the image "tagged with the version and, for a plain release, `latest`". Its follow-ups (line 119) list "the release's `docker` job pushes the version tag (and `latest`) before `publish` runs" as a known limit. After this diff `latest` comes from `distribute.yml` alone, last, and can be held. The Decision text does say release.yml no longer tags `latest`, so nothing breaks. Still, ADR 0029's header should name ADR 0026's image paragraph as amended, the same way it names ADR 0008's row, so someone reading 0026 is pointed to the new rule. This is rubric question 3 (the record of the image contract).
- F-2 · advisory · .github/workflows/distribute.yml:188 · The Design puts every summary text in one function: "`summaryLine(target, outcome)` in `scripts/release/lib.ts`, gives every line the run's summary carries, so the texts are fixed in one place". The `latest` job's first step writes `latest: not moved: $job did not succeed` as a literal in the YAML instead. `tests/unit/deploy-files.test.ts:273` checks that literal on its own, and nothing ties it to `summaryLine`, so lib.ts's `not-moved` case is never used at run time and the two copies can drift apart. Fix: have the step emit the line through lib.ts (setup-bun plus a call to it), or add a test that holds the YAML text equal to `summaryLine("latest", { kind: "not-moved", job: "$job" })`. This is rubric question 5 (a Design detail built elsewhere, no boundary crossed).
- F-3 · advisory · src/cli/commands/install.ts:174 · The Design says the hand-over happens "after the agents are known and before the first is installed ... so no step of the install runs in the older binary". When no agent is named, `cleanUpGemini(rest)` (which can prompt and remove an old Gemini CLI install) still runs in the older binary before `binaryOrHandOver` (line 182). The newer binary then runs the same offer again. It touches no store, so no boundary is crossed, but the order does not match the Design. Fix: call `binaryOrHandOver` before `cleanUpGemini`. Rubric question 5.

## Outside the change
- docs/adr/0026-team-server.md:88 · still says the release's `docker` job tags `latest` for a plain release. It is now stale and should get a pointer to ADR 0029 (see F-1). Debt, advisory.
- src/store/meta.ts:158 · compares versions with `Bun.semver.order` directly instead of the new `olderThan` in `src/util/version.ts`. The order is the same, but it is a second place outside the one version order the change sets up. Debt, advisory.

## Not answerable
- none

Checked and found consistent with the base:
- The scripts in `scripts/release/` import only node built-ins, `src/util/version.ts` and `scripts/build.ts`'s `TARGETS`. build.ts has no side effects on import (its body sits behind `import.meta.main`), so "no `bun install`" holds.
- The generated files (`plugin/`, `plugins/codex|cursor/*.sh`, `plugins/opencode/binary.js`) match their sources (`scripts/templates/wizardingcode-mem.sh`, `OLDER_JS` in `scripts/plugins.ts`), as ADR 0009 requires.
- The npm shim is a hand copy, held equal to `OLDER_JS` by a byte-for-byte test, as the Design says.
- `install.ts`'s `package.json` import follows its neighbours.
- `stageBinary`'s new signature has one caller.
- ADR 0029 supersedes ADR 0008's Homebrew row, and deleting the rendered formula matches that.
- The CLAUDE.md bullets (AC-77) and the team-server runbook line (AC-75) are present.
- The workflows have the shapes the Design table gives (environment, permissions, conditions, pins, `persist-credentials: false`, no `${{` in `run:`).
