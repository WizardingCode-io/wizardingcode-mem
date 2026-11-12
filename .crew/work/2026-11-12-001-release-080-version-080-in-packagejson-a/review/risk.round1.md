# risk findings for 2026-11-12-001-release-080-version-080-in-packagejson-a
reviewer: review-risk
read: diff, release.yml, risk rubric (no spec or plan exists for this item), 11 files

## Findings
- F-1 · advisory · .env.example:4 · Once this merges to main and before the v0.8.0 tag's image job finishes, an operator who copies `.env.example` gets `WIZARDINGCODE_MEM_VERSION=0.8.0` and `compose pull` fails on a missing image. The failure is loud (pull error) and nothing is written. The same window affects the `VERSION="0.8.0"` in `plugin/wizardingcode-mem.sh` (and the codex and cursor copies) and in `plugins/opencode/binary.js:7`, which fetch the v0.8.0 release binary: those fail open (hooks exit 0), but the hooks do nothing until the release exists. Tag immediately after merge, and let the marketplace bump and Homebrew formula follow only after the release is published (the brief already says they follow).
- F-2 · advisory · .github/workflows/release.yml:23 · The tag and package.json check guards a tag that does not match the version, which stops a wrong image or binary name. It cannot undo a published `0.8.0` image, because ghcr tags are mutable only by hand. A bad 0.8.0 is therefore rolled back by pinning `WIZARDINGCODE_MEM_VERSION=0.7.0`, and the team schema 2 and store version 8 bring their own rollback limits. Those rollbacks are documented in ADR 0028 "The schemas and the rollbacks", but my search found no `## Upgrade` or `## Rollback` heading in `docs/runbooks/team-server.md` (the headings may be worded differently, e.g. "Upgrading"). Confirm the runbook sections the brief cites exist, because operators will look there first when 0.8.0 misbehaves.

## Outside the change
- packaging/homebrew/wizardingcode-mem.rb:8 · The formula stays at 0.7.0 with 0.7.0 checksums until its own step. This is intended and harmless (brew users stay on 0.7.0), but it must be bumped with the real 0.8.0 checksums and not before the release exists.

## Not answerable
- Question 2 (rollback of the schema migrations: team schema 2, store version 8, contract 2) · the item has no spec or plan, and the migrations are not in this diff. I judged only the version strings. ADR 0028 carries the stated rollbacks.
- Question 6 (hands at deploy) · no plan names the order (merge, tag, image, formula, marketplace) or the owner. The brief may; I read only the diff and the workflow.
