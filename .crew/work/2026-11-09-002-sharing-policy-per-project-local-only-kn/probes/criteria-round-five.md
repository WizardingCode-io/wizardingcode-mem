# Criteria of 2026-11-09-002-sharing-policy-per-project-local-only-kn

The text in force is the spec's criteria list; a superseded criterion is read through its replacement.

## AC-1 (behavior)

openDb on a fresh store leaves user_version at 7 and module_migrations holds ('sharing', 1, 'sharing_policy') beside knowledge's row; sharing_levels, sharing_ledger and sharing_changes exist with the spec's columns; a second open adds no row and no backup; moduleSchemaState(db, 'sharing', 1) is current; a store opened with moduleSchemas: [] has no sharing table and loadPolicy reads every default

## AC-2 (behavior)

loadSettings reads the two sharing keys as sorted, de-duplicated, lower-cased lists; none and an absent key are empty; an invalid token empties that key's list and records a problem naming its position and not its value; with the file workspace and the environment workspace,shared the roots are workspace and a problem says the environment was ignored; with the environment none the roots are empty and publicSettings says source env; with the environment wider than the file the source is file; validatePatch refuses Sales, sales and workspace: for areas and all for roots with the rules' messages, and accepts 'shared:marketing, workspace:sales' as shared:marketing,workspace:sales

## AC-3 (behavior)

loadPolicy gives every project the level local with no sharing_levels table, that is, a schema state of behind; a closed policy with a problem when the module row says version 2; the level local with reason disabled for a disabled project with a row; the level local with reason unbound-alias and a problem for a row whose bound_alias the project no longer has; the level local for a row whose project is gone; an inert id for an area not in its root's taxonomy and for a root with no taxonomy file; and a closed, logged policy when the database throws. decide on a closed policy is keep, policy-failed for every item

## AC-4 (behavior)

for entries, decide answers send for an active, problem-free entry whose root or project is shared and whose root-qualified area is shared; keep with problem, status, root-off, level-local, no-project for project 0 or an orphan, area-private, area-inert, unknown-destination in the cases the spec names; a project repository's area is checked against the workspace's list and the shared repository's against the shared list

## AC-5 (behavior)

for memories, decide answers send only at the level all for an active, non-stale, project-scoped, non-imported memory that is not a user rule, and keep with level-local, level-knowledge, status, stale, branch-scope, imported, user-rule otherwise; with a sent record of the same version and hash the answer is keep, already-sent; with a sent record of another version, send; with a sent record and a policy that no longer allows, withdraw with the reason; with that record withdrawn, keep; with a received record from this destination keep, received-same, from another keep, received-elsewhere; decide is pure: the same inputs give the same answer with no database

## AC-6 (behavior) — superseded by AC-20

setLevel refuses a project without a remote alias with no-remote, a disabled project with disabled, an unknown project with no-project and an unknown level with invalid; writes the row with the current directory's remote alias when it belongs to the project, else the first remote alias by name; logs project:<id> with the old and new levels and bumps sharing.epoch by one; reports widened true from local to knowledge and from knowledge to all, false the other way; the same level twice writes and logs nothing; the level local deletes the row; saveSharingSetting writes the file, logs roots or areas and bumps the epoch; resetLevels deletes every row, logs one levels change with source restore, returns the count, and does nothing with no row

## AC-7 (behavior) — superseded by AC-21

wouldLeave counts the entries and memories decide sends, per root, per area and per project, from the index as it is with fresh false and after ensureFresh of the roots and the project repositories above local with fresh true, never refreshing a local project's repository; the memory candidates come from one query over the projects at all that excludes user_memories; list true returns the items capped at 500 with more; with no knowledge tables the entry counts are 0 and nothing throws

## AC-8 (behavior)

share project knowledge --yes in a project folder with a remote prints sharing: <name> → Knowledge and the row exists; without --yes and without a TTY it exits 1 saying widening needs --yes; share project local lowers without asking; in a folder that is not a known project it exits 1 with the sentence; in a project without a remote it exits 1 with the sentence; share roots workspace --yes and share areas workspace:sales --yes write the file, log and bump the epoch; share areas Sales exits 64 with the rule's message; share status prints the six lines with the counts and --list the items; share explain workspace/<slug> and share explain memory <id> print the answer, the reason and its sentence; share nonsense exits 64 with the usage

## AC-9 (behavior)

GET /api/overview lists each project with sharing, remote and disabled; GET /api/sharing answers the policy, the taxonomies, the level counts and the report with the spec's counts; PUT /api/projects/<id>/sharing with level knowledge and no confirm is 400, with confirm true answers level, old and boundAlias and logs; the level local needs no confirm; a project without a remote is 409 with the sentence; PUT /api/settings with a sharing key logs the change and bumps the epoch, and the route stores what it is given while the viewer's save drops inert ids

## AC-10 (behavior)

the built viewer has the Sharing page in place of the Collaboration card, with the texts of the design and no soon mark; the SettingKey union holds the two keys; the Across projects dock has the Sharing section with the segmented control and the two disabled sentences; the row pill appears only above Nothing; the texts are pinned by a unit test over the Vue sources

## AC-11 (behavior)

status prints 'sharing   nothing leaves this machine (every default)' on a fresh store and the full line with the current project's label, the roots, the area count and the counts otherwise; status --json carries sharing; on a store whose sharing_levels table does not exist the line is the default one and nothing throws

## AC-12 (behavior)

doctor prints a sharing check: skip with no database, ok with the default sentence or the summary, warn naming an emptied key and the token's position, an ignored environment value, a project whose bound alias is gone, and an inert area id; restoreBackup of a copy with two levels resets them, logs one restore change, answers sharingReset 2, and backup --restore prints the sentence; a copy without the tables answers sharingReset 0 and prints nothing about sharing

## AC-14 (observed) — superseded by AC-18

docs/adr/0025-sharing-policy.md records D-1 to D-20 as rulings with the superseded clauses, the meaning of all, the predicate's contract (item types, reasons, ledger, epoch, redaction at the edge), what accompanies an item and what never leaves, the identity rule and its reused-folder limit, restore and move, the boundary of an agent with a shell, and what parts 5 and 6 must do with it; the README gains a Sharing subsection under Privacy and your data; CLAUDE.md gains a bullet naming src/sharing/, the sharing namespace and the share command

Recorded reason: (none)
Recorded command: grep -c '^| D-' docs/adr/0025-sharing-policy.md

## AC-15 (behavior) — superseded by AC-19

the contract is pinned: the key sets of a sample EntryItem and MemoryItem equal the fixed lists of the design and nothing else; REASONS and the keys of REASON_TEXT are the same set; NEVER_LEAVES equals the design's list; redactForSend of a private block is [PRIVATE] and a seeded key in the text is replaced; levelKey of 3 and team is 3@team

## AC-18 (observed)

`docs/adr/0025-sharing-policy.md` (status draft, part 4 of the journey) records D-1 to D-20 as rulings with the superseded clauses, the meaning of `all`, the predicate's contract (the input and payload types, the memory hash's fields, the reasons, the ledger, the derived epoch, the generation and the device token, redaction at the edge as the only text-level protection, the received item written with its record in one transaction, the unchanged received version never echoed, the roots and areas bound to the `team` destination), what accompanies an item and what never leaves, the identity rule, the system reconcile and the reused-folder limit, restore (levels reset before the swap, counter monotonic, generation renewed, baseline reset, the ledger left to part 6's reconciliation) and `moveStore`, the hand edit recorded as source `file`, the boundary, and what parts 5 and 6 must do with it; the README gains a "Sharing" subsection under "Privacy and your data" (the three choices, the two keys, `share`, that nothing is sent until a team server exists, that lowering recalls nothing); `CLAUDE.md` gains a bullet naming `src/sharing/`, the `sharing` namespace and the command.; the ADR also states that a project put at Nothing loses its bound alias with its row, so part 6 computes withdrawals from the ledger's uids and never from the live binding, and that six types are pinned (the four items, `LedgerRecord` and `Decision`); `CLAUDE.md`'s settings line names the two sharing keys as the exception to "the environment wins"; checked by `probes/check-docs.ts`, which exits 1 when any part is missing

Recorded reason: (none)
Recorded command: ./node_modules/.bin/bun .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-docs.ts /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab

## AC-19 (behavior)

the contract is pinned: the key sets of a sample `EntryItem`, `MemoryItem`, `OutgoingEntry` and `OutgoingMemory` equal the fixed lists of the design and nothing else; `memoryHash` is the SHA-256 prefix over `memoryKind`, `importance`, `status`, redacted `title`, redacted `body` in that order; `REASONS` and the keys of `REASON_TEXT` are the same set; `redactForSend("<private>x</private>", env)` is `[PRIVATE]` and a seeded key in the text is replaced; `levelKey(3, "team")` is `3@team`; `entryUid` gives the three forms and `memoryUid("ab12cd34", 7)` is `ab12cd34:7`.; the key sets of a sample `LedgerRecord` and a sample `Decision` equal `LEDGER_RECORD_KEYS` and `DECISION_KEYS` and nothing else

## AC-20 (behavior)

`setLevel` refuses a project without a `remote:` alias (`no-remote`), a disabled project (`disabled`), an unknown project (`no-project`), an unknown level (`invalid`) and a widening without `confirm` (`needs-confirm`), reading the stored row and the project's state inside its transaction so a stale caller is still refused; writes the row with the current directory's remote alias when it belongs to the project, else the first remote alias by name; logs `project:<id>` with the effective old and the new levels and adds one to the counter; `previewLevel` reports `widened` true from `local` to `knowledge` and from `knowledge` to `all`, false the other way; the same effective level twice writes and logs nothing, except a row whose alias is gone, which is rebound and logged; `local` deletes the row and answers an empty `boundAlias`; `applySettingsPatch` refuses a widening without `confirm`, writes the file, logs `roots` or `areas`, adds one to the counter once and sets the baseline to the file's lists in one transaction, and with a file write that throws leaves no row, no counter change and the file as it was; `previewSettingsPatch` compares against the file's lists; `reconcileSettings` reads the file and the baseline inside its transaction, logs a hand edit with source `file`, adds one to the counter and clears the problem, treats a missing baseline as empty lists, does nothing when the lists match, and logs nothing when two processes with different environments look at one file and one baseline; `reconcileLevels` reads the rows and the projects inside its transaction, removes a row whose downgrade still holds, keeps one set again meanwhile, logs with source `system` and adds one to the counter; `resetLevels` deletes every row when the table exists, logs one `levels` change with source `restore` when rows were deleted, sets the counter to `max(floor, copy) + 1`, renews the generation, sets the baseline to the lists given, returns the count, and runs on a copy without the sharing tables.; `setLevel` binds only a host-led remote alias (one whose normalized remote starts with a host name, as `github.com/x/y` does), so a project whose remotes are all local paths or `file://` URLs is refused with `no-remote` and no row is written, and for a project with a host-led remote beside a path remote the bound alias is the host-led one

## AC-21 (behavior)

`wouldLeave` counts the entries and memories `decide` sends, per root, per area and per project, from the index as it is with `fresh: false` and after `refresh` of the workspace, the shared and the project repositories above `local` (in that order, projects by id) with `fresh: true` (a repository of a `local` project is not refreshed; the refreshed set is asserted through an injected `refresh`; a `refresh` that throws is logged and the counts still answer); the memory candidates come from one query pre-filtered by the projects at `all` only, reading no title or body, and the counts equal `decide` over every memory of those projects; `ledgerRecords` scans the destination's rows of one kind and groups them by uid with no parameter list, so the 90,000-memory count runs with ledger rows present; the hash is computed only for candidates with a ledger record and for listed items, in chunks of 500 ids (checked through `memoryItems` and `withHashes`); `areaTotals` count every active problem-free entry per area whatever the area's state; `withChange` previews a level, roots and areas, alone or together, without writing; a count over 90,000 memories completes under 5,000 ms with the figure printed; `list: true` returns the items capped at 500 with `more`; with no knowledge tables the entry counts are 0 and nothing throws.; `readEntries` and `areaTotals` read the knowledge tables only when `moduleSchemaState(db, KNOWLEDGE_MODULE, KNOWLEDGE_SCHEMA_VERSION)` is `current`, and on a store whose knowledge module is behind or ahead the entry counts are 0, the area totals empty and nothing throws

## AC-22 (behavior)

`validatePatch` refuses a value holding `\r` or `\n` under any key, with one message (`a value on one line`), so no value can write a second line into the env file; `PUT /api/settings` with such a value under `TYPESAFE_API_KEY` or `WIZARDINGCODE_MEM_BACKUP_S3_REGION` and no `confirm` is 400, writes nothing, and leaves the sharing lists as they were (the probe `probes/newline-in-a-setting.md` as a test)

## AC-23 (behavior)

the viewer's Sharing page and the dock show a plain sentence when a save or a load fails (`Sharing not saved` with `The settings file could not be written.`; `Sharing could not be loaded.`; the dock's `Not changed` with `The level could not be saved.`), never the error's message or a path; the dock's level control shows its three labels in full at the dock's 320px, with no `truncate` (a vertical list or wrapping labels); the Save button is disabled while nothing changed; the five states the code reaches beyond the spec's earlier list are declared in the spec's state list and captured in `review/ui/` with a `manifest.json` row each (the problems alert, the load error, an inert-area row with Remove, the dock's `Not changed` toast, the row pill at Knowledge); pinned by the unit test over the Vue sources (the sentences present, `error.message` absent from the toasts, `truncate` absent from the level control)

## AC-24 (observed)

`tests/unit/hook-snapshots.test.ts` and `tests/unit/mcp-tools-list.test.ts` pass, and every snapshot the two snapshot files held at the item's base is byte for byte the same (snapshots another item adds beside them are allowed); `tests/perf/budgets.test.ts` keeps its budgets; part 1's module migration test expects the two rows and gains the sharing row's case, its other assertions unchanged; checked by `probes/check-preserve.ts`, which runs the four files and compares the base's snapshots with the files

Recorded reason: (none)
Recorded command: ./node_modules/.bin/bun .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/probes/check-preserve.ts /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab

## AC-25 (behavior)

A project's level refusal is what effectiveLevel gave, never rewritten: the ruling names the reason the level read local under (level-local, disabled, unbound-alias), and a row that reads local with reason allowed, a pair effectiveLevel never makes, is refused as a broken rule (decide throws, naming the project and the destination) instead of being read as Nothing.

## Removed (no record ever)

- AC-16 (observed): the hook snapshots in tests/unit/hook-snapshots.test.ts and the MCP tool list snapshots in tests/unit/mcp-tools-list.test.ts keep passing unchanged (21 snapshots), tests/unit/module-migrations.test.ts and tests/perf/budgets.test.ts keep passing; the engine could not record a baseline because the item's base commit predates part 1, so the run before the change was taken by hand (probes/baseline-before-the-change.md) and the run after is observed
- AC-13 (preserve): the hook snapshots in tests/unit/hook-snapshots.test.ts and the MCP tool list snapshots in tests/unit/mcp-tools-list.test.ts pass unchanged; tests/perf/budgets.test.ts keeps its budgets; part 1's module migration test is updated to expect the two rows and nothing else in it changes
- AC-17 (observed): `tests/unit/hook-snapshots.test.ts` and `tests/unit/mcp-tools-list.test.ts` pass with their snapshot files unchanged since the item's base; `tests/perf/budgets.test.ts` keeps its budgets; part 1's module migration test expects the two rows and gains the sharing row's case, its other assertions unchanged; checked by `probes/check-preserve.ts`, which runs the four files and compares the two snapshot files with the base

Risk areas: ["personal-data","data-migration","auth"]
