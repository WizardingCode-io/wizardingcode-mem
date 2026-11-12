# security findings for 2026-11-12-001-release-080-version-080-in-packagejson-a
reviewer: review-security
read: 11 files (whole diff, plus scripts/templates/wizardingcode-mem.sh), risk areas: none recorded (route full because .env.example is a secrets path)

## Findings
none

Boundary: the diff accepts no input. All 11 changed lines are version strings, 0.7.0 → 0.8.0.
Secrets: `.env.example` changes only `WIZARDINGCODE_MEM_VERSION=0.8.0`. `SERVER_DOMAIN=team.example.com` is a placeholder. No credential, token or key appears in the diff, including in comments.
Fetch path: the shims (`plugin/`, `plugins/codex/`, `plugins/cursor/` `wizardingcode-mem.sh`, and `plugins/opencode/binary.js`) change only `VERSION`. The template still downloads the binary from `releases/download/v$VERSION` and checks it against that release's `checksums.txt` (lines 40-46). The URL base and the checksum check are unchanged.
Consistency: all 11 files move to the same version, which is what `bun run plugins` regenerates.

## Outside the change
- scripts/templates/wizardingcode-mem.sh:40 · The `WIZARDINGCODE_MEM_RELEASE_BASE` override changes where the binary comes from. `checksums.txt` is fetched from the same base, so the override can supply matching hashes. This is existing behaviour, not introduced here (advisory, debt).
- Release ordering (not code): the shims and the compose image tag point at v0.8.0. If the tag or the published binaries and `checksums.txt` are not in place before this merges, installs and `compose` will fail to fetch. That fails closed and is not a security defect.

## Not answerable
none
