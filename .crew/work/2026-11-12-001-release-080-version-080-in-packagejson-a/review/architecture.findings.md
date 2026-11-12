# architecture findings for 2026-11-12-001-release-080-version-080-in-packagejson-a
reviewer: review-architecture
read: the whole diff (11 files, one version string each, 0.7.0 → 0.8.0); CLAUDE.md (generated-files rule, `bun run plugins`, the deployment files); the "tag must match package.json" check in .github/workflows/release.yml; a repository-wide search for any other 0.7.0 string.

## Findings
none

The 11 files are consistent with the declared base:
- Version sources agree: package.json, npm/package.json and .env.example (`WIZARDINGCODE_MEM_VERSION`, which compose.yml reads as the release to run) all say 0.8.0. The release workflow's check that the tag matches package.json will pass for a v0.8.0 tag.
- Every generated file shows only the version line changed. These are `.claude-plugin/plugin.json`, `plugin/wizardingcode-mem.sh`, `plugins/codex/.codex-plugin/plugin.json`, `plugins/codex/wizardingcode-mem.sh`, `plugins/cursor/.cursor-plugin/plugin.json`, `plugins/cursor/wizardingcode-mem.sh`, `plugins/opencode/binary.js` and `plugins/opencode/package.json`. The three `.sh` copies are byte-identical (same index hash `e20196b`), which is what output from the one generator, scripts/plugins.ts, looks like. They carry no hand edit. No generated file still names 0.7.0.
- The diff touches no schema, contract or integration, so the base has nothing further to say about it. No migration, no change to the team contract, no source change.

## Outside the change
- packaging/homebrew/wizardingcode-mem.rb:8 · The Homebrew formula still names 0.7.0 with 0.7.0 URLs and checksums. This is not drift by the diff: the history (#31 release, then #32 "Homebrew formula: 0.7.0 with the release's checksums") shows the formula is updated after the release assets exist, since the checksums are not known earlier. It needs a follow-up once v0.8.0 is published. (advisory)

## Not answerable
none
