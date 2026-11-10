# security findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-security
read: 4 files, risk areas: auth, personal-data, public-api, data-migration, infra

## Findings
none

The round-5 state still holds. Since round 5 the diff has changed in two places, and neither gives a caller a new path:
- **tests/unit/knowledge-git-host.test.ts (diff.patch:11704-11812):** biome only re-wrapped two calls in this file: the `runGit(... timeoutMs: 5000)` call at lines 52-56 and the `commitPaths(...)` call at lines 91-99. The arguments, assertions and fixture identities did not change. The names and emails in it are made-up test data on `.invalid` domains, and there is no token or key in the file, so the secrets gate is not missing anything here.
- **docs/real-use/findings.md (diff.patch:353-372):** these are documentation rows only. They record the advisories from rounds 1-5 as deferred: no `serve forget` to erase a member's name, the `audit` table is never pruned, the gaps in `serve status`, rollback, the release and image-pinning order, and the mismatched `.env.example` version. No source, route, schema or deployment file changed with them.

Nothing else in the diff changed, so the round-5 reading in .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/review/security.round5.md still applies:
- **Auth:** every route except `health` and `join` checks the device token, and invitations are admin-only.
- **Personal data:** no log line carries a payload, and erasure still works through `serve purge … --yes`.
- **Public API:** the error shapes are unchanged.
- **Data migration:** it creates a new database file, `team.db`.
- **Infra:** the image runs as user 10001 with a read-only root, no capabilities and no published port, behind Caddy.

## Outside the change
none

## Not answerable
none
