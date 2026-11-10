# security findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-security
read: 7 files, risk areas: auth, personal-data, public-api, data-migration, infra

## Findings
none

I checked each change in commit 982ac11 and none of them opens a path a caller could take:
- **Purge debt (personal-data):** `noteOwed` (src/team/mirror.ts:396-407) adds this purge's folders to the folders an earlier purge still owed. It writes the note in the same transaction as the erasure and the audit row (mirror.ts:682-696). `replayOwed` then replays every folder owed, and clears the note only when the replay added no failure (mirror.ts:579-588).
  - A second purge therefore no longer drops the first purge's debt, so a purged text cannot be left behind in a repository.
- **Unreadable note (personal-data):** `owedReplay` returns `"all"` for a note it cannot parse (mirror.ts:385-393). Both `noteOwed` (line 402) and `runMirror` (line 465) then turn that into a full rebuild. This fails closed for erasure.
  - The note holds only folder names and repository metadata, and only the server writes it.
- **WAL reporting:** `wal` is `truncated` when either checkpoint cut the log (mirror.ts:698 and 717). The server's hourly tick runs `checkpointWal` only while no export child runs (src/team/server.ts:217).
  - So a `busy` purge is finished without the operator, and the checkpoint never races the child's reads.
- **Run failures in `meta.mirror.last` (personal-data / public-api):** a throw outside the per-revision blocks is now recorded as a `(run)` failure (mirror.ts:433-442), and refusals (`HttpError`) are left out.
  - The message can name a path under the data directory. It is shown only by the operator's `serve status` (src/team/status.ts:92, 122-124).
  - `GET /v1/health`, the only unauthenticated read, returns only `ok` and `low disk` (src/team/routes.ts:205-211). No member route reads `mirror.last`.
  - So no caller sees a path they could not see before.
- **One 404 builder (public-api / auth):** `unknownItem` (src/team/errors.ts:55) returns the same body as before, `404 {error:"unknown"}`. Every call site in push.ts, mirror.ts and routes.ts keeps its earlier check order.
  - `withdrawByAdmin` and `reinstateByAdmin` (src/team/push.ts:598-643) still answer only behind the admin routes. The error shape is unchanged, so the contract does not move.
- **One device-alias lookup:** `deviceAlias` (push.ts:153-154) only reads the alias and is used to build the feed uid. It changes nothing about who may read or write an item.

I also re-checked the rest of the change, and the round-3 conclusions still hold:
- **Auth:** every route but `health` and `join` goes through `withCaller`, and the admin routes pass the admin flag. Demoting or revoking a member revokes their invitations.
- **Personal data:** log lines carry no payload, and a refused uid in a log line is cut to 256 characters. The device id appears only in an admin's view of the feed.
- **Data migration:** the migration is new, on a new database file.
- **Infra:** the image runs as user 10001 with a read-only root, no capabilities and no published port.

## Outside the change
none

## Not answerable
none
