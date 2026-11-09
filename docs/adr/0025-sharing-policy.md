# ADR 0025 — The sharing policy: what may leave this machine

Date: 2026-11-09 · Status: **draft**. This is part 4 of the knowledge and team journey (2026-11-08-001): the policy that says what may leave this machine for a team server, built and tested. The team server (part 5) and the sync client (part 6) are not built; nothing in this part opens the network, and nothing is sent. The twenty rulings below were recorded on 2026-11-09 under their stated conservative defaults by the crew's validator, with nobody present; the specification that carried them was approved by the author later that day, before the build. Building the code changed details of the design (which list changes a `roots` or `areas` row, the order of `setLevel`'s refusals, which ledger rows a count reads); where this record and the specification differ, this record is the later one.

## Context

Parts 5 and 6 will move knowledge entries ([ADR 0024](0024-knowledge-module.md)) and memories to a team server. The author asked that some projects, knowledge and memories never reach it. Before this part the engine had no notion of leaving: the only text that left the machine was a TypeSafe judgement, and the viewer's Collaboration card promised a per-project opt-in that nothing implemented. A policy written after the sync would let the first sync send what nobody chose, and a level stored with no destination would send a project to every server a later part configures.

## Decision

One pure function, `decide` in `src/sharing/policy.ts`, answers `send`, `withdraw` or `keep`, with a reason code and the policy's epoch, for one destination, one item (an entry or a memory) and that item's ledger records. Parts 5 and 6 call it and nothing else decides. The person makes three choices: a level per project and destination (`local`, `knowledge`, `all`, shown as Nothing, Knowledge, Knowledge and memories), stored in the database; the roots whose knowledge may leave; and the knowledge areas that may leave. The roots and the areas are two keys of the env file. Every default is `local` and empty, so a fresh or upgraded store lets nothing out.

## Rulings

| Ruling | Decision | Why | Cost if wrong |
| :- | :- | :- | :- |
| D-1 | A project's level lives in the database, beside the project; the two workspace-level choices (roots and areas) in the env file. | The project list is in the database and the viewer edits rows; the mission puts the sharing settings in `<data dir>/env` and the viewer's Settings. | Two stores, one audit step between them (the baseline, [Changes](#changes-confirmation-and-the-hand-edit)). Moving the lists into the database is a migration of two keys. |
| D-2 | Every default is local: every project Nothing, no root, no area. | Nothing leaves until the person chooses. | A team member must opt in project by project; nothing is lost by it. |
| D-3 | Areas are an allow list: an area leaves only when named; a new area starts private. | A new area holds what nobody has looked at yet. | A person who wanted everything names each area. |
| D-4 | The author's own rules never leave in this part. | A rule is personal (ADR 0018) and can carry private habits. | Sharing them later is a new choice, not a change of meaning. |
| D-5 | The shared repository is subject to the area list: a private area never leaves, even from the shared repository. | One rule for every repository. | A person names the shared repository's areas as well. |
| D-6 | At `all`, a project's memories leave: the fixed set of D-15, which is never a user rule. | The person chose to share the project's memories. | See D-15. |
| D-7 | A selector per project in Across projects; the workspace-level choices in Settings. | Each choice is made where its object is shown. | Two places to look; the Sharing page's projects line links the other. |
| D-8 | The tables are the `sharing` schema namespace in `module_migrations`; `user_version` stays 7; no foreign key; a missing row is `local`; levels are checked in code. | A core migration 8 would make every 0.6.0 binary refuse the store on every hook; a `CHECK` on the level could only be widened by rebuilding a table. | A level string this version does not know reads `local` and is reported; nothing enforces the values in SQLite. |
| D-9 | One level per `(project, destination)`. One destination, `team`, exists; the roots and areas apply to it; an unknown destination answers `keep`. | One choice must not reach every server a later part adds, and a predicate with no destination argument cannot be corrected once data has left. | A second destination needs its own roots and areas keys, a later part's work. |
| D-10 | An allowed entry leaves as the current content of one item: never a repository, git history, proposals, drafts or archived entries. The sync reads the bytes after `ensureFresh` and a clean status. | History and decided proposals would carry past private text past the predicate. | The server sees no history of an entry; it has the versions it was sent. |
| D-11 | `decide` answers `send`, `withdraw` or `keep` with a reason and the epoch, reading the item's ledger records. `sharing_ledger` is created here and written by parts 5 and 6. A received item never goes to another destination; its unchanged received version is never echoed back; a version this machine wrote since may go back as an update. A memory's uid is its row id scoped by the store's generation and, on the server, by part 5's device token; an entry's uid is its UUID scoped by its repository. | The sync must tell "never shared" from "shared, now withdrawn", and a person asks why. | A boolean predicate would need a second function and a second call site. |
| D-12 | Area ids are root-qualified (`workspace:sales`, `shared:sales`); the workspace's ids govern the workspace and every project repository; a roots list, empty by default. | The workspace and the shared repository have separate taxonomies (ADR 0024, D-9), so one flat id would switch two meanings. | A person names `sales` twice to share it from both roots. |
| D-13 | The file is the policy; an environment value for a sharing key is honoured only when it narrows; `doctor` warns when one was ignored. | One stray variable must not widen sharing from one process, and the viewer's switch must be able to turn it off. | The settings rule "the environment wins" does not hold for two keys; the Settings footer says so. |
| D-14 | Loading fails closed: any failure means nothing leaves; one invalid token empties its whole list; an id in no taxonomy is inert and dropped at the viewer's next save; lists are trimmed, lower-cased and de-duplicated. | A typo must mean "not shared", never a wider list. | A typo shares nothing until fixed; `doctor` names the key and the token's position. |
| D-15 | `all` means: status `active`, `stale = 0`, `scope = 'project'`, `origin` not `imported`, not a user rule. A different set is a new level name. | The meaning of a level must not change under data that has left. | A person who wants imported memories shared waits for a new level. |
| D-16 | A level above `local` needs the project's `remote:` alias and is bound to it. A lost alias or a disabled project reads `local`, and the row is removed and logged the next time the viewer, the CLI or the sync looks. Project 0, an orphan folder and an ambiguous manifest answer `local`. A restore resets every level and logs it. `moveStore` keeps them. A folder reused without a remote keeps the old id, a stated limit. | A team matches projects across machines by their remote. | A repository with no remote cannot be shared until part 5 has another identity for it. |
| D-17 | Every change is in `sharing_changes` with its source; the epoch changes with every change; the viewer confirms a widening with the counts it releases; the CLI asks on a terminal or needs `--yes`; a hand edit of the env file moves the epoch at once and is recorded with source `file` the next time the viewer or the CLI looks. | A person can see what changed, when and from where, and is never surprised by a widening. | A widening by hand edit cannot be confirmed after the fact ([The boundary](#the-boundary)). |
| D-18 | The Collaboration card becomes the Sharing page (roots, areas with counts, locked when the environment narrowed, projects per level, the statements); no part numbers in product text; Across projects shows the level and the dock sets it with the confirmation. | The card promised what nothing did. | None found. |
| D-19 | Fixed lists of what accompanies an item and what never leaves, pinned by a contract test; every text that leaves passes `redactForSend`, a required step of the contract. | The sync must have nothing to decide about content. | A payload built outside the pinned types is not covered by the test; part 6 must build from them. |
| D-20 | A `status` line for the current project, `GET /api/sharing`, `share` with `project`, `roots`, `areas`, `status [--list]`, `explain`; counts never on the hook path; `doctor` warns for every problem the loader can raise, and for nothing else. | A person can ask what is shared and why, from a shell and from the viewer. | No warning for sharing configured with no team: it would be a permanent badge with no fix. |

Four clauses of the recorded answers were superseded by later rulings. D-1's "a column on projects (core migration 8)": by D-8, a table in the `sharing` namespace. D-5's "the shared scope always": by D-12, the shared repository leaves only when named in the roots. D-6's "every active memory": by D-15, the fixed set. D-7's "a Sharing card beside the others": by D-18, the Collaboration card becomes the Sharing page.

## Storage: the `sharing` namespace

`src/sharing/migrations.ts` declares the schema `sharing`, version 1 (`sharing_policy`), listed after knowledge's in `src/engine/module-schemas.ts`. It is not an engine module: it has no contribution and no tools, and the schema list is the one place that knows it. The first `openDb` after the upgrade runs it once under the write lock and takes no backup, since the backup is decided per schema by that schema's own recorded version.

| Table | Holds | Key |
| :- | :- | :- |
| `sharing_levels` | A project's level for one destination, the `remote:` alias it is bound to, when and from where it was set (`viewer` or `cli`). | `(project_id, destination)`, `WITHOUT ROWID` |
| `sharing_ledger` | What was sent to or received from a destination: version, hash, the epoch it was sent under, `withdrawn_at`. Written by parts 5 and 6; this part writes no row. | `(destination, item_kind, item_uid, direction)`, `WITHOUT ROWID` |
| `sharing_changes` | Every change: when, the source (`viewer`, `cli`, `restore`, `file`, `system`), what (`project:<id>`, `roots`, `areas`, `levels`), old and new. | `id`, indexed by `at` |

No table has a foreign key or a trigger on a core table. Three `meta` keys complete it:

- `sharing.counter`: the number of changes made through the viewer, the CLI, a restore or the system reconcile, added to inside the same transaction as the change.
- `sharing.settings_seen`: the baseline, the env file's own lists as last recorded. It exists for the audit only: a file that differs from it was edited by hand since.
- `sharing.generation`: eight random hex characters, minted by the migration, renewed by every restore and by nothing else.

**Rollback.** Parts 1 to 4 ship in one release; the rollback target is 0.6.0, which opens the store (`user_version` 7) and ignores the `sharing_*` tables and the new `module_migrations` row. `renderEnvFile` keeps keys it does not know, so a 0.6.0 viewer that saves settings keeps the two sharing keys; a later re-upgrade reads them again.

## The two settings

`WIZARDINGCODE_MEM_SHARE_ROOTS` is a comma list of `workspace` and `shared`; `WIZARDINGCODE_MEM_SHARE_AREAS` a comma list of root-qualified area ids (`SHARE_AREA`, `^(workspace|shared):([a-z0-9][a-z0-9-]{0,39})$`, whose id part is ADR 0024's area id). `none` and an absent key are the empty list. Lists are trimmed, lower-cased, de-duplicated and sorted.

**Narrow-only.** For these two keys the file's list and the environment's are read apart. With the environment unset (an empty variable counts as unset), the file's list is in force; with it set, the intersection. The key's source is `env` when the environment removes at least one of the file's ids, `file` when the file holds the key and the environment removes nothing, `default` otherwise. An environment that only adds ids changes nothing; the loader reports "the environment's <key> names <n> more than the file; ignored".

**Fail closed.** A token that does not parse empties the key's whole list and records a problem that names the token's position, never its value ("<key>: token 3 is not a root-qualified area id; the list was emptied"). An invalid token in the environment empties the environment's list, which narrows everything. An area id listed and not in its root's `taxonomy.md` is inert: it allows nothing, the loader reports it, and the viewer's next save drops it. Any error while loading gives a closed policy: epoch 0, nothing in it, the error as its one problem, logged once per process under `sharing`.

Two stores is the cost of putting the settings where the mission puts them: the levels belong with the project rows, the lists with the other settings. The baseline is what keeps the two honest.

## The predicate's contract

`decide(policy, destination, item, records)` is pure: the same inputs give the same answer, and it reads no database. In order:

1. A closed policy keeps everything: `policy-failed`.
2. A destination that is not configured keeps everything, whatever the roots and areas say: `unknown-destination`.
3. A `received` record from another destination: `received-elsewhere`, whatever the hash. From this destination with the item's hash: `received-same`, so the unchanged received version is never echoed back. With another hash, the item goes on: a version this machine wrote since may go back as an update.
4. Whether the policy allows the item. An entry: no problem (`problem`), active (`status`); a workspace or shared entry needs its root (`root-off`), a project entry needs its project at `knowledge` or `all` (its level's reason, or `level-local`); then `<root>:<area>` must be allowed, with the root `workspace` for workspace and project entries and `shared` for shared ones (`area-inert` for an inert id, else `area-private`). A memory: its project at `all` (`level-knowledge` at `knowledge`, else the level's reason), then the set of D-15 (`status`, `stale`, `branch-scope`, `imported`, `user-rule`).
5. Against this destination's `sent` record that is not withdrawn: allowed with the same hash is `keep`, `already-sent`; allowed otherwise `send`, `allowed`; not allowed with such a record `withdraw` with the reason; not allowed otherwise `keep` with the reason. A record's version is informational; the hash decides, and a memory hash that was not computed (null) counts as changed.

**The input and payload types** are in `src/sharing/types.ts`, and their sorted key lists are pinned by `tests/unit/sharing-contract.test.ts`:

| Type | Keys |
| :- | :- |
| `EntryItem` | `area`, `hash`, `kind`, `problem`, `projectId`, `scope`, `status`, `uid`, `version` |
| `MemoryItem` | `hash`, `isUserRule`, `kind`, `origin`, `projectId`, `scope`, `stale`, `status`, `uid`, `version` |
| `OutgoingEntry` | `body`, `frontmatter`, `hash`, `kind`, `remoteAlias`, `scope`, `slug`, `uid`, `version` |
| `OutgoingMemory` | `body`, `createdAt`, `hash`, `importance`, `kind`, `memoryKind`, `remoteAlias`, `status`, `title`, `uid`, `updatedAt`, `version` |
| `LedgerRecord` | `destination`, `direction`, `hash`, `version`, `withdrawnAt` |
| `Decision` | `answer`, `epoch`, `reason` |

Six types are pinned: the four items above, and the ledger's record and the predicate's answer through `LEDGER_RECORD_KEYS` and `DECISION_KEYS`. A field added to any of the six fails the test until the lists and this record change together. A payload built outside these types is not covered: part 6 must build its payloads from them.

**The memory's hash** is the first 16 hex characters of the SHA-256 over `MEMORY_HASH_FIELDS` (`memoryKind`, `importance`, `status`, the redacted `title`, the redacted `body`) joined by newlines in that order. A rejudge changes it; a use count does not. A memory's `version` is its `updated_at`, informational. An entry's `version` and `hash` are ADR 0024's.

**The reasons** are the fixed list `REASONS`, each with one sentence in `REASON_TEXT` that `share explain` and the viewer print:

| Reason | Sentence |
| :- | :- |
| `allowed` | The policy lets it leave. |
| `already-sent` | The server already has this version. |
| `policy-failed` | The policy could not be loaded; nothing leaves. |
| `unknown-destination` | This destination is not configured. |
| `received-same` | It came from this destination and has not changed since. |
| `received-elsewhere` | It came from another destination and never travels on. |
| `problem` | The entry has a problem; run knowledge adopt. |
| `status` | Only active items leave. |
| `root-off` | Its repository is not allowed to leave. |
| `level-local` | This project shares nothing. |
| `level-knowledge` | This project shares knowledge only; memories stay. |
| `disabled` | Memory is off for this project. |
| `unbound-alias` | The level was set under a git remote this project no longer has. |
| `no-project` | No project owns it. |
| `area-private` | Its area is not allowed. |
| `area-inert` | Its area is listed but not in the taxonomy. |
| `stale` | Stale memories stay. |
| `branch-scope` | Branch-bound memories stay. |
| `imported` | Imported memories stay. |
| `user-rule` | Your own rules stay. |

**The ledger.** One row per destination, item kind, item uid and direction. A count reads the rows of one kind that belong to the destination or were received (`ledgerRecords`), in one scan grouped by uid in memory, never a parameter list: SQLite binds at most 32,766 parameters and a store has 90,000 memories. A memory's hash is computed only for the candidates that have a record, in chunks of 500 ids.

**Provenance.** A memory received from a destination is stored as a new local row with `origin = 'imported'`, which step 4 keeps, and `judge = 'team:<destination>'`, the marker that tells it from a claude-mem import; its `item_uid` is `remote:<the server's uid>`. A received entry keeps its scoped uid. Part 6 writes a received item and its `received` record in one transaction (the file write before it), so no received item exists without its record; a received memory never leaves again even if its record is lost, because it is `imported`.

**The epoch** is derived, never stored: `counter × 2^20 + hash20(roots|areas)`, where `hash20` is a 20-bit FNV-1a over the lists in force (the areas after the taxonomy filter). A hand edit of the env file moves it with no write, and so does an area added to a taxonomy that brings a listed id into force; the counter keeps two policies with the same lists apart over time. `decide` returns it, the ledger records it, and part 6 re-reads the policy at every batch and stops the run when the epoch differs from the one it started with. A preview (`withChange`) computes its own epoch with the counter one higher, so it never carries the stored policy's.

**Identity of an item.** An entry's uid is `workspace:<uuid>`, `shared:<uuid>` or `project:<remote alias>:<uuid>`, so one file copied into two repositories is two items. A project entry's alias is the one its level is bound to, also after the project lost it, so that what was sent under it can still be withdrawn. A memory's uid is `<generation>:<row id>`. Memories are never deleted, so a row id is stable on this machine until a restore, which brings back an older copy whose later ids go to other memories; the restore renews the generation, so every memory then has a new uid, and the old generation's items on the server are part 6's to withdraw. A store file copied to another machine keeps its generation; part 5's device token scopes every uid on the server (device, then generation, then row id), so two machines never collide.

**Redaction at the edge.** `redactForSend(text, env)` in `src/sharing/edge.ts` calls `redact` with the store's environment; every text that leaves passes it in the process that sends it. It is the only protection at the level of the text: an entry's body is sent as written apart from what `redact` recognises (a `<private>` block, a credential of a known shape, a sensitive environment value), so a person must not write a secret into an entry.

## The meaning of `all`

A project at Knowledge and memories sends its active memories that are not stale, are bound to the project and not a branch, were not imported (from claude-mem or from a team) and are not one of the person's rules. Nothing else. Memories have no area: the area list governs knowledge only. A level that sends another set is a new name in `LEVELS`, and `LEVEL_LABELS` grows with it.

## What leaves with an item, and what never does

An allowed entry leaves as its current frontmatter and body as the file holds them, its scope, its slug, its uid, version and hash, and its project's bound `remote:` alias (null for the workspace and the shared repository). The sync reads the file after `ensureFresh` and a clean `git status` for that path and passes `decide` the parsed values, never an index row: a dirty file or one with a problem never leaves. An allowed memory leaves as its redacted title and body, its kind, importance, status, created and updated times, uid, version, hash and the project's `remote:` alias.

Never: `turns`, `sessions`, the history index, `hook_runs`, `injections`, `memory_files`, `terms`, `branch`, `commit_sha`, `transcript_path`, `path:` and `gitdir:` aliases, the project `key`, commit e-mails, git history, proposals, drafts, archived entries, decided proposals, `user_memories`. This list is prose; the guard in code is the payload types' key sets.

## Identity of a project

`setLevel` refuses, in this order, a level that is not one of the three (`invalid`), a project that does not exist (`no-project`), and above `local` a disabled project (`disabled`) and one without a host-led `remote:` alias (`no-remote`); only then a widening without `confirm` (`needs-confirm`), so nobody confirms a widening that is then refused. It reads the stored row and the project inside its own transaction, never from a policy the caller loaded. The alias bound is the current folder's when it is the project's, else the one the row is already bound to while the project still has it (a change from the viewer never moves the binding, and with it every project entry's uid), else the project's first remote alias by name. Only a host-led alias is ever bound (`isHostLedAlias` in `src/sharing/levels.ts`): one whose normalized remote begins with a host name of dotted labels, with a port or without, as `remote:github.com/acme/site` does. A remote that is a local path or a `file://` origin, which `normalizeRemote` leaves as the path, names a folder on this machine and never a project a team shares, so a project whose remotes are all such paths is refused with `no-remote`, and beside a host-led remote the host-led one is bound. The rule reaches every reader: a row bound to a path alias (one written before the rule) reads as `unbound-alias`, and a project's entries are never named by a path alias, bound or first by name. Its one blind spot: a `file://` origin with a host (`file://host.example.com/share`) normalizes to `host.example.com/share`, since `normalizeRemote` drops the scheme, and passes as host-led; such a remote names a share a team could reach, and is accepted. `local` deletes the row, also one that only reads `local`, so an explicit Nothing does not come back when memory is turned on again or the alias returns.

The loader reads a level whose project is disabled, or whose bound alias the project no longer carries, as `local`, with a problem naming the project. `reconcileLevels` removes such a row and logs it with source `system`, adding one to the counter; it runs when `GET /api/sharing` answers, before every `share` subcommand acts, and at every batch of the sync. So re-enabling a project or a returning alias never brings a level back without a new choice. `status` and `doctor` open the store read-only and report the row as pending.

**The window.** Between a downgrade and the next look, the row stays and reads `local`. No production path disables a project or removes a `remote:` alias today (`resolveProject` only adds aliases); a later part that adds one must call `reconcileLevels` in the same transaction.

**Nothing drops the binding.** A project put at Nothing loses its bound alias with its row: `setLevel(..., "local")` and `reconcileLevels` delete the row, and the binding is in no other place. Its entries' uids then fall back to the project's first remote alias by name, or the empty alias, so they may no longer match the uids the ledger holds for what was sent, and `decide`, given the new uid and no record, answers `keep` where a withdrawal is owed. Part 6 therefore computes withdrawals from the ledger's uids and never from the live binding: every `sent` record not withdrawn whose item no longer leaves under the uid it was sent under is withdrawn.

**A reused folder.** `resolveProject` keeps the id of a repository without a remote found at a known path (ADR 0018), and so the old project's level, if it had a remote then. The person's recourse is to set the project to Nothing or to disable it.

A project repository whose `project_id` is 0, a folder no project owns and an ambiguous manifest have no project: `no-project`.

## Restore and moving the store

`restoreBackup` resets the copy before it replaces anything: after the copy is checked, the live store frozen (`BEGIN IMMEDIATE` on it) and before the first rename, it reads the live store's counter as a floor and the env file's current lists, opens the unpacked copy with a raw connection in journal mode `DELETE` (never `openDb`, which would migrate a temporary file), and runs `resetLevels` in one transaction: every stored level deleted, one `levels` change with source `restore` when there was one, the counter set to `max(floor, the copy's) + 1` so an epoch never comes back, the generation renewed, the baseline set to the current file's lists so the restore is not read as a hand edit. A copy that never ran the sharing schema gets its counter, generation and baseline all the same. A reset that throws fails the restore with nothing renamed. `backup --restore` prints `backup: sharing levels reset to Nothing (<n> projects); set them again`, and the viewer's restore toast says the same. The roots and areas are in the env file, not in the backup, and keep their current values. The copy's `sharing_ledger` rows are left as they are; reconciling them with the server is part 6's.

`moveStore` carries the database whole: levels, ledger, changes, counter and generation are unchanged.

## Changes, confirmation and the hand edit

A widening is a level later than the one in force (`previewLevel`), or a root or an area added to the file's list (`previewSettingsPatch`). Every path checks before it asks or writes, and `setLevel` and `applySettingsPatch` refuse a widening without `confirm` all the same: the server, not the viewer, is where confirmation is required. The viewer asks with a dialog that shows the counts the change releases (counted under the proposed policy, from the index as it is); the CLI asks on a terminal through `askYesNo` (`src/cli/prompt.ts`, shared with `install`) and, with no terminal, refuses without `--yes`. Lowering asks nothing.

`applySettingsPatch` is the one path that writes the env file when a patch holds a sharing key, for `share roots`, `share areas` and the viewer's `PUT /api/settings` alike. In one transaction it records a hand edit found first, refuses an unconfirmed widening, logs one row per list the patch changes, moves the counter once, writes the file last and sets the baseline. A key the patch repeats as the file holds it writes no row and leaves the counter. A file write that throws rolls everything back; a crash between the file write and the commit leaves the file written and no row, which the next reconcile records with source `file`.

A hand edit of the env file moves the epoch at once. `reconcileSettings` records it with source `file` the next time the viewer, the CLI or the sync looks, reading the file's own lists (never narrowed by an environment, so two processes agree) against the baseline. Until then the loader reports "the sharing settings changed outside the viewer and the CLI; open the Sharing page or run share status to record it", and `doctor` warns.

## The read-outs

- `status`: `sharing   nothing leaves this machine (every default)` only when that is true of the machine: no root and no area in force, no project anywhere above Nothing, no problem (`isDefault`), and no list narrowed by the environment. Otherwise `sharing   this project: <label> · roots: <list> · <n> allowed areas · would leave: <e> entries, <m> memories (index as it is)`, a narrowed list followed by ` (set by the environment)`, then ` · <n> other projects share` when projects other than this one are above Nothing (`1 other project shares`), and ` · <p> problems; see doctor` when there are any. The counts are the current project's own repository and memories, or the machine's when the folder is no project, from the index as it is. `status --json` carries the same figures, with `default` and `othersSharing`.
- `doctor`: a `sharing` check after `knowledge`. `skip` with no database; `ok` with the default sentence, or `roots: <list> · <n> allowed areas · knowledge: <k> projects · knowledge and memories: <a> projects · epoch <n>`; `warn` with every problem the loader raised, joined by ` · `.
- `wizardingcode-mem share project | roots | areas | status [--list] | explain`: loads the policy, runs both reconciles and loads again before it acts; a closed policy refuses the writes and still answers `status` and `explain`.
- The viewer: the Settings → Sharing page, the Sharing section of a project's dock in Across projects, `GET /api/sharing` (reconciles, refreshes the repositories that can release entries, then counts), `POST /api/sharing/preview` (writes nothing, no git) and `PUT /api/projects/<id>/sharing`, all behind the viewer's token and Host check.

No hook reads the policy; counts never run on a hook.

## The boundary

The policy protects what leaves this account's machine, not the account from itself. Any process the local user account runs can edit the env file, run `share project all --yes`, or open the database. A widening by hand edit cannot be confirmed after the fact, because a process with write access to the file is already past the boundary, as an agent with a shell is. What the policy guarantees inside the boundary: a widening through the viewer or the CLI is confirmed, every change is logged with its source and `share status` shows the last one, and the environment never widens.

## Known limits

- A repository with no git remote cannot be set above Nothing until part 5 has another identity for it.
- An entry's body leaves as written apart from what `redact` recognises.
- The counts in `status` and in the dialogs read the index as it is; the sync reads the bytes it sends.
- A downgrade's row stays until the next look ([Identity of a project](#identity-of-a-project)).
- A reused folder without a remote keeps the old project's level.
- A store file copied to another machine keeps its generation until part 5's device token scopes it.
- The loader's target is 20 ms with ninety projects, measured by the gate and pinned by no test; a count over 90,000 memories has a 1,000 ms target and a 5,000 ms test bound.

## What parts 5 and 6 must do

- Call `decide` for every item and every destination, and nothing else; send on `send`, withdraw on `withdraw`.
- Bind the destination `team` to the configured server. A second server is a second destination: it starts with every level `local`, and needs its own roots and areas keys before anything leaves for it.
- Build every payload from `OutgoingEntry` and `OutgoingMemory`, and pass every text through `redactForSend` in the sending process.
- Read an entry's file after `ensureFresh` and a clean `git status` for that path, and pass `decide` the parsed values.
- Compute withdrawals from the ledger's uids and never from the live binding: a project put at Nothing loses its bound alias with its row, so the uid an entry has now may not be the one it was sent under.
- Write `sharing_ledger`: a `sent` row with the epoch after a send, `withdrawn_at` after a withdrawal, and a received item with its `received` row in one transaction.
- Re-read the policy at every batch, run `reconcileSettings` and `reconcileLevels`, and stop when the epoch differs from the one the run started with.
- Store a received memory with `origin = 'imported'` and `judge = 'team:<destination>'`, and before any memory is received narrow `history replace-imports` (`src/backfill/replace.ts`, which today selects `origin = 'imported'` alone and would archive received memories) to rows whose `judge` is not `team:…`. `rejudge` (`src/judge/rejudge.ts`) already selects only `judge = 'claude-mem'`; it must stay so.
- Scope every memory uid on the server by the device token, and withdraw a store generation's items when a restore has replaced it.
- Any part that disables a project or removes a `remote:` alias calls `reconcileLevels` in the same transaction.
