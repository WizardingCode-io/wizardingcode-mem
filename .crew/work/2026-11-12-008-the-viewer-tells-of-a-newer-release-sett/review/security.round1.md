# security findings for 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett
reviewer: review-security
read: 5 files, risk areas: personal-data

## Findings
- F-1 · advisory · src/ui/update.ts:185 · When the report cannot be built, `GET /api/update` returns the first line of the error, and `agents` (line 203) returns the staged binary's absolute path. Both can hold home-directory paths, so the user's name. The audience is unchanged: the route sits after the Host check and the token check (src/ui/server.ts:270, :286) on the loopback-only server, and `status`/`doctor` already print the same lines to the same person. This is not a broader exposure. The `line` field is shown as plain Vue text and never as HTML.

## Outside the change
- none

## Not answerable
- none

Rubric answers. Boundary: `POST /api/update/dismiss` reads nothing from the request. It keeps only the `latest` that `update.json` names (src/ui/update.ts:216-220), and tests/integration/ui-update.test.ts covers a forged body. The switch goes through the existing `PUT /api/settings`, whose check (src/settings/settings.ts:346) accepts only `check` or `off`. Secrets: none in the diff, fixtures or comments. Personal-data: no new log line, export or network send. tests/unit/update-boundary.test.ts holds the rule that src/ui never imports check.ts, the one file that makes a request. The only new stored value is the release string in `meta` (`update.dismissed`), which is not personal data. Both new routes are behind the token (shown by the 401 test).
