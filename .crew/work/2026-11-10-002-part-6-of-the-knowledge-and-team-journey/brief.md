# Brief

## Request

Part 6 of the knowledge and team journey, the sync client: wizardingcode-mem keeps a list of team servers (https URL, serverId, device token, contract) and joins one with an invitation code from the CLI and the viewer; binds a project to one server at most and chooses roots and areas per server; keys the sharing ledger and the policy by serverId, migrating part 4's ledger; syncs in the background, never on a hook path: pushes what the policy allows right after each local change and keeps one pull open per server with wait while a session or the viewer is active, applying received entries and memories to the local store with their received records, handling stale, refused, purged, rate and storage answers, instance changes, 410 and moves as ADR 0026 states; ADR 0027.

## Goal

A person on one machine joins a team server with an invitation code, chooses what leaves (the sharing policy of part 4, now per server), and from then on what the policy allows reaches the server within seconds of a local change, and what the team shares reaches this machine within seconds of a pull, with no hook ever waiting on the network and nothing ever leaving that the policy did not allow.

## Context

Part 4 (ADR 0025) built the policy and the contract the sync reads: `decide` answers `send`, `withdraw` or `keep` with a reason and the epoch; the payload types `OutgoingEntry` and `OutgoingMemory` are pinned; `redactForSend` runs in the sending process; `sharing_ledger` holds what was sent and received per destination, keyed by the one destination `team`. Part 5 (ADR 0026) built the server: `POST /v1/join`, `GET /v1/me`, `POST /v1/push` (per-item `applied`, `stale` with `current` and `appliedAs`, `refused` with a reason, `withdrawn`), `GET /v1/pull?since=&wait=&projects=` (a feed of `upsert`, `withdraw`, `move` and `purge` rows with `serverId`, `instance` and a snapshot flag), the contract header and the 409 with the accepted list, 410 for a cursor ahead of the server, the memory uid grammar and the device-scoped keys. Nothing is sent yet: no client exists. The knowledge store (part 1) keeps entries as Markdown in one git repository per scope and writes an agent's change as a proposal; the viewer has a Settings → Sharing page and a project dock with the level selector; the session-start hook starts background work with `spawnDetached` (`distill`, `ui --auto`) and returns.

## Constraints

- Never on a hook path: no hook waits on the network; the hook only starts the sync process and returns.
- Every payload built from part 4's pinned types; every text through `redactForSend` in the sending process; `decide` called for every item and every server and nothing else decides.
- A project is bound to one server at most; a second server is a second destination with its own roots and areas and every level `local` until set.
- The device token is stored in the person's own store file (0600), shown once, never in the env file, the logs or a URL; `https://` is required outside loopback.
- A received item never travels on to another server; a received memory is `imported` with `judge = 'team:<serverId>'`; `history replace-imports` must not archive received memories.
- Nothing is sent after a restore under the old generation: the old generation's items are withdrawn.
- Clean room: nothing from claude-mem. Product text in English. No change to the server's contract (`CONTRACT` 1) in this part.

## Acceptance

- `share server add <url> --code <wci1_…>` (and the viewer's Servers card) joins the server, stores its `serverId`, URL, device id, alias, token digest-free (the token itself, in the store) and the contract, and prints the server's identity; `share server list | remove | status` read and change the list; the join refuses a non-https URL outside loopback.
- The policy and the ledger are keyed by `serverId`: the levels, roots and areas rows of the destination `team` written before any server existed belong to the first server added (a migration of `sharing_levels`, `sharing_ledger` and the env keys); `decide` is unchanged in shape.
- `wizardingcode-mem sync --auto` runs one sync process per data directory (a lease), started by the session-start hook and by the viewer, alive while a session or the viewer is active and exiting after a quiet quarter hour; `sync --once` runs one pass and exits; `status` and the viewer show per server the last push, the last pull, the cursor, the counts and the last error.
- A push runs right after each local change the policy allows: `applied` records `sent` with the server's revision and hash; `stale` with `appliedAs` is an earlier success; `stale` without it on an entry applies the server's revision to the file and keeps the local text as a proposal of kind sync conflict; `refused` is final for that content (`purged` drops the copy and the ledger forgets it); `rate` and `storage` retry later with backoff.
- One pull per server stays open with `wait` while the process is alive: received entries are written into the matching local repository (workspace, shared, the project's) with a `received` ledger row in one transaction; received memories become `imported` rows with `judge = 'team:<serverId>'`; `withdraw`, `move` and `purge` rows are applied; a new `instance`, a 410 or a project taken up on this machine opens a snapshot; a tombstone whose `movedTo` names a range this machine does not read drops the copy.
- A 401 on a server whose `instance` the client does not know asks for a new invitation; a 409 on the contract stops that server's sync with a status line naming the versions.
- The first run after a server is added sends everything the policy allows in batches of at most 200 items under the server's limits, resumable across restarts, and nothing while every level is Nothing.
- `docs/adr/0027-sync-client.md` records the decisions; the hook snapshots, the MCP tools list, the perf budgets and the server's tests pass unchanged.

## Assumptions

- D-1 (accepted): the sync is its own detached process, `wizardingcode-mem sync --auto`, started by the session-start hook and the viewer, one per data directory by a lease, never on a hook path.
- D-2 (accepted): on a stale push of an entry, the server's revision is applied to the file and the local text is kept as a proposal of kind sync conflict, never lost and never sent until the person accepts it.
- D-3 (accepted): the CLI and the viewer's Servers card both ship; the viewer's part stays minimal.
- D-4 (accepted): the first run sends everything the policy allows, batched, resumable, shown by status.
- The levels, roots and areas set under the destination `team` before any server exists belong to the first server added.
- `https://` is required outside loopback; no certificate pinning.
- A received memory takes part in retrieval like an imported one, marked with its server in the viewer.
