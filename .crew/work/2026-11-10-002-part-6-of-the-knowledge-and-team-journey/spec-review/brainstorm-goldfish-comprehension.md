mode: brainstorm

# comprehension findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: goldfish-comprehension
read: the concept in the prompt; .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/brief.md; docs/adr/0025-sharing-policy.md ("Storage" to "What parts 5 and 6 must do", which includes "The two settings", "The read-outs", "Changes, confirmation and the hand edit"); docs/adr/0026-team-server.md ("Rulings" to "Follow-ups", which includes "The API" and "What parts 6 and 7 must do"); src/cli/commands/share.ts; ui/src/components/settings/Sharing.vue; ui/src/components/ProjectsView.vue (the sharing parts, by search); src/modules/knowledge/store.ts (propose, proposalBase, acceptProposal, the proposal limits); CLAUDE.md (lines 1 to 49). Lens: usability and developer ergonomics, for the person and for the agents.

## Findings

- F-1 · Blocker · Per-server roots, areas and levels, and the CLI list · The concept says a person "chooses roots and areas per server" and binds a project to one server. But the CLI it ships is only `share server add | remove | list | status` and `sync --auto | --once`. The existing `share project | roots | areas | explain` take no server argument and are hard-wired to `TEAM_DESTINATION` (share.ts:132, 253, 287). The viewer's Sharing page and the project dock each show one set of switches and one level selector. Nothing names how a person picks the second server's roots, or which server a project is bound to. The env keys are migrated "to" something never named: the key names a person would hand-edit, and whether they hold an opaque serverId. Nor is it said how the environment-narrows rule applies per server. With two servers a person has no way to do what the concept promises, and an implementer would guess the flag, the key names and the UI.

- F-2 · Major · First run after `server add`, and migrating `team` to the first server · Every widening a person confirmed before part 6 was confirmed under the text "would leave for your team's server once one is configured. Nothing is sent now." (Sharing.vue:145, ProjectsView.vue:138, and USAGE in share.ts:51). The concept hands those levels, roots and areas to whatever server is added first and then "sends everything the policy allows" at once. A person who set levels months ago, or who first adds a loopback test server, has everything leave with no fresh question. An implementer following the concept would build no confirmation at join. At least three things are missing: a join that shows the would-leave counts for this server and asks (or starts paused); a `--yes` for scripts, as the widenings have; and a statement of what a non-interactive `share server add` does.

- F-3 · Major · Confirmation and statement texts that become false · Once a server exists, "Nothing is sent now", "Nothing is sent until a team server is configured", the Sharing card's description and "the next sync withdraws it" (Sharing.vue:22, 180) all become wrong or vague. The confirmation dialog is now the moment data leaves within seconds, and it does not name which server. The concept never lists the product texts that change, so a builder would leave the old sentences in place.

- F-4 · Major · "a proposal of kind sync conflict" · In the store, a proposal's `kind` already means the entry kind, and `checkFields` refuses anything but knowledge, strategy, persona or pattern (store.ts:121). `propose` takes only an `AgentWriter` and records `proposedBy: agent:<id>` (store.ts:467, 519). `acceptProposal` writes "Proposed by <agent>" into the commit. The proposal limits are 5 open per target and 200 per repository; past them `propose` throws "quota" (store.ts:95, 500). The concept says none of the following:
  - where "sync conflict" is stored, given that it cannot be `kind`;
  - which writer the sync process is;
  - what base version the conflict proposal carries;
  - what happens when the limit is hit, which breaks D-2's "never lost";
  - that accepting it pushes the local text over the teammate's revision, and that rejecting it keeps the teammate's.
  
  A builder would put "sync-conflict" in `kind` and fail validation, or drop text at the quota.

- F-5 · Major · How the person learns of a sync conflict · The local text in their file is replaced with the server's revision. CLAUDE.md says the knowledge module has no view yet, so the only way to find the proposal is `knowledge list` / `accept` from a shell. Nothing in `share server status`, the Servers card or session start is said to tell the person "your edit to <slug> lost to <member>'s; your text is proposal <id>". The person sees their edit silently undone. The agent that made the edit (as its own proposal) is not told either.

- F-6 · Major · "alive while a session or the viewer is active … exiting after a quiet quarter hour" and "right after each local change" · The concept leaves three things open, and an implementer must guess each:
  - **Session activity.** It never says how a detached process knows a session is active. No session-end signal or heartbeat is named; the session-start hook only spawns it.
  - **"Quiet".** It is not said what counts as quiet: no local change, no pull traffic, or no session. If it means no change, a long session with 15 quiet minutes loses its sync, and the next edit is not pushed until the next session start, which breaks the 5 s goal.
  - **Local changes.** It never says how the sync process learns of a change. Changes are made in other processes: MCP `knowledge_propose`, `knowledge write/accept`, the distill drain writing memories, the viewer. No mechanism is named: polling an index, a meta counter, a file watch, or a signal from the writer.
  
  The same holds for `sync --once` while `--auto` holds the lease: does it refuse, wait or run?

- F-7 · Major · Received workspace entries, and "a level is needed only to send" · ADR 0026 D-11: a device always pulls the shared entries and every member's workspace entries. The brief writes received entries "into the matching local repository (workspace, shared, the project's)". This raises several surprises the concept does not address:
  - Teammates' workspace entries land in *my* workspace repository, beside my own, with nothing said to tell them apart.
  - Their pins may take my 840-character session-start share.
  - Their text is injected into my agents' sessions as soon as I join, before I set any level.
  - If I or my agent edit one, the push is `refused not-owner` (D-12), which the concept calls final for that content. The edit is stuck, and nobody is told why.
  
  Joining therefore means receiving and injecting everything. The join should say so, and the concept should state where others' workspace entries live and how they are marked for the person and for `knowledge_search` / `knowledge_get` results.

- F-8 · Major · Applying a received entry to a local repository · The store's rule is that a person's write is a commit and an agent's is a proposal. A received write is neither, and the concept names no author or committer for it. It also never says what happens when the target file is dirty or has an open intent record. A person with an uncommitted edit to that file could lose it, or the apply could fail every pull. The ADR requires a clean `git status` to send; nothing equivalent is said for receiving.

- F-9 · Major · Entry `version` against server `revision` · "applies the server's revision to the file" does not say what the file's ADR 0024 `version` becomes. Nor does it say what base revision the next push carries, the file's version or the ledger's server revision. ADR 0026 only says to "record the local hash beside the server's". A builder would send the file's version as the base and get `stale` on every edit after the first received revision.

- F-10 · Major · `share server remove` · Nothing says what removal does:
  - to what this machine sent (withdraw first, or leave on the server);
  - to received entries now sitting in local repositories, and to received memories (`judge = team:<serverId>`), which still take part in retrieval;
  - to the `received` ledger rows.
  
  If those rows go, `decide` no longer answers `received-elsewhere`, and a teammate's entry could be sent on to the next server added, which breaks "a received item never travels on". The command also needs an argument to name the server by (serverId, URL, a name?); none is given. The brief's "alias" stored at join is ambiguous between the device alias of ADR 0026 and a project's `remote:` alias.

- F-11 · Major · 401 and re-join · Only an admin can mint an invitation (D-4, D-9), so "asks for a new invitation" must tell the person to ask an admin of <server name/URL>, and by what command they re-join. The concept also does not say:
  - the message for a 401 on a *known* instance (a revoked device or a disabled member), and whether the sync stops;
  - what a re-join does to the cursor, the ledger and memories sent under the old device id. The server scopes memory uids by device, so a naive re-send duplicates them; ADR 0026 notes the dedupe is part 6's.

- F-12 · Major · Token in "the person's own store file (0600)" · If the store file is the SQLite database, `wizardingcode-mem backup` copies it to the configured folder or bucket (CLAUDE.md line 34). The device token then travels into backups and buckets, and a restore brings back an old token. A person would not expect a live credential in a bucket. Say which file holds it and whether backups carry it.

- F-13 · Nit · `--code <wci1_…>` on the command line · The code lands in shell history and the process list. It is single-use and short-lived, but a prompt when `--code` is absent costs little. The https refusal should say what to do: "use https://; plain http is allowed only on loopback".

- F-14 · Nit · Undefined phrases · Each of these needs a sentence defining it: "takes up a project", "has the project", "the server knows its alias", "a quiet quarter hour", "the server's identity" (what `add` prints), "digest-free" (brief), and "contract" in the server list.

- F-15 · Nit · How errors read in `status` · The concept does not say which status line names each of these, or what it tells the person to do:
  - `refused secret` (the entry and the rule);
  - `refused storage` ("the server is short of space; tell its operator");
  - `rate` backoff;
  - the 409 ("this client speaks 1, the server accepts 2; upgrade wizardingcode-mem", or the reverse).
  
  "sync not running; it starts with the next session or `sync --once`" should also be a stated read-out.

- F-16 · Nit · `judge = team:<serverId>` and the viewer · A serverId is opaque. The viewer's "marked with its server" needs a human name for the server, and the concept does not say where it comes from (`/v1/me`? set by the person at `add`?).

## Not answerable
- Whether `/v1/me` or `/v1/join` returns a display name for the server · ADR 0026 defers the answer shapes to "the plan's route table", which I was not given.
- The full ProjectsView.vue · I read only its sharing lines, by search.
