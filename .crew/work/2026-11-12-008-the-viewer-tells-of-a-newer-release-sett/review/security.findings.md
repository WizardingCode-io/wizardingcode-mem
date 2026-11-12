

## Clarifications
- # security findings for 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett
  reviewer: review-security
  read: 6 files, risk areas: personal-data
  
  ## Findings
  - F-1 · advisory · src/ui/update.ts:209 · Both fields can carry home-directory paths, and so the user's name, to the page: `line` holds `firstLine(error)` when the report cannot be built, and `agents` (line 235) holds the staged binary's absolute path. The page now hides the agents line when a release is out and a staged copy exists (ui/src/update.ts:1351-1354 in the patch), but the route still returns `agents` in full. That is no wider audience than before: the route sits after the Host check and the token check (src/ui/server.ts:270, :286), the viewer is bound to the loopback only, and `status`/`doctor` already print the same lines to the same person.
  
  ## Outside the change
  - none
  
  ## Not answerable
  - none
  
  What round 2 changed:
  - **`failed` and `built`:** booleans computed on the server from the report's own fields (src/ui/update.ts:207-208, 226-233). They carry no personal data and nothing of the request.
  - **The `updateReport` option:** the option on `startUi` (src/ui/server.ts:103-104, 120) is a seam for code inside the process, not something a caller can reach. Nothing in the request sets it, and no command under src/cli passes it, so a caller cannot use it to swap the builder.
  
  Unchanged since round 1:
  - **Dismiss:** `POST /api/update/dismiss` still reads nothing from the request (src/ui/update.ts:248-252).
  - **The switch:** it still goes through the existing check in `PUT /api/settings`, which accepts only `check` or `off` (src/settings/settings.ts:346).
  - **Logs and network:** no new log line and no network send.
  - **Secrets:** none in the diff, the fixtures or the comments.
