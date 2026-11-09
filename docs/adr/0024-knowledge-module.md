# ADR 0024 — The knowledge module: a versioned store beside memory

Date: 2026-11-09 · Status: **draft**. This is part 1 of the knowledge module (the store: files, repositories, index, versions, proposals), built and tested. The parts that give knowledge to an agent, show it in the viewer, share it and sync it are not built yet; each completes this ADR when it lands ([What the later parts add](#what-the-later-parts-add)). The eleven rulings below were taken on 2026-11-08 under their stated conservative defaults, with nobody present, and the author approved the specification that rests on them on 2026-11-09.

## Context

Memory records what happened in sessions: observed, local, shown to the agent as background it may doubt. A team also holds what it learned on purpose: strategies, personas, patterns, how it works. The WizardingCode team keeps that in Obsidian notes, which no agent is given, which nothing versions when an agent would change them, and which reach no new project.

A knowledge module was built once before as the engine's second module ([ADR 0020](0020-knowledge.md)) and withdrawn on 2026-10-13, when the author decided knowledge and personas would be a separate product. On 2026-11-08 the author reversed that: knowledge and personas are part of this engine ([ADR 0019](0019-one-engine.md)), the team shares them through a server, every change is versioned so that agents cannot disorganise them, and nothing is imported from Obsidian. The withdrawn code stays on the branch `archive/knowledge-module`; every file here was written against the current engine.

## Decision

Knowledge is Markdown files with frontmatter, one git repository per scope, under the data directory. The database holds an index rebuilt from the files and nothing else. Every write is one commit with its author, a person or an agent. An agent's write is a proposal file until a person accepts it. A write on a stale version is refused, never applied over the other. A file changed outside the engine is never swept into another author's commit: a person adopts it, as themselves.

## Rulings

| Ruling | Decision | Why | Cost if wrong |
| :- | :- | :- | :- |
| D-1 | A repository lives under the data directory (`knowledge/workspace`, `knowledge/shared`, `knowledge/projects/<folder>`), never inside a project's folder. | The engine's commits stay out of the user's repositories, a project's knowledge never leaves with the project's own push whatever the sharing policy says, and workspace and shared have no project to live in. | Knowledge does not travel with a clone of the project; the team server is what carries it. A later part can add an export. |
| D-2 | One git repository per scope, one commit per write; the entry's `version` number is the check against a stale write. | The author asked for a versioned repository, and git is a history a person can inspect. | A few git processes per write, about 50 ms measured (see [Write latency](#write-latency)). A store with its own version log would need a migration. |
| D-3 | An agent's proposal is a file in the repository, committed with the agent as author. Accepting writes the entry in a commit by the person that names the agent. | The index is rebuilt from the files, so a proposal kept only in the database would be lost by a rebuild. | Proposal files accumulate (D-10). |
| D-4 | Files are flat: `entries/<slug>.md`, the area and the rest in the frontmatter. | Renaming or moving an entry between areas changes a line and no path. | Browsing by area is the index's and the viewer's work, not the folder's. |
| D-5 | An entry is `active`, `draft` or `archived`. The engine never deletes one. | Memory never deletes either, and the history keeps every version. | Archived entries stay on disk. |
| D-6 | The taxonomy is `taxonomy.md`, in the same format as every entry, in the repository. | One format for the files a person reads. | None found. |
| D-7 | The person's author name is the `WIZARDINGCODE_MEM_AUTHOR` setting, else the global git `user.name`, else `you`. | Nothing new is asked of a person to start. | Commits by `you` until a name is set; `doctor` warns. The team server replaces this with the member's name. |
| D-8 | An entry's identity is an immutable UUID written at creation. `version` is a local counter beside a content hash. | A slug is a name; an id survives a rename, another machine and a sync. | None found; a rename can be added without a format change. |
| D-9 | An area has an immutable id and a label a person can change. The workspace repository holds a taxonomy, read by every project repository; the shared repository holds its own. | A rename then touches one file in one repository, and no commit spans repositories. | Two taxonomies to keep alike by hand until the team's taxonomy is synced. |
| D-10 | A decided proposal moves to `proposals/decided/` with the decision appended. It is never deleted. | The index answers what was decided without a git process. | Growth, bounded by the folder cap ([Growth](#growth)). |
| D-11 | A write whose target was changed outside the engine is refused, naming `wizardingcode-mem knowledge adopt`. | Sweeping a hand edit into the next write's commit would credit it to the wrong author. | One more command for a person who edits in an editor. |

Two clauses of the recorded answers were superseded by later rulings. D-3's "rejecting removes the file in a commit": by D-10 the file moves to `proposals/decided/`. D-6's "renaming an area rewrites every entry": by D-9 a rename changes a label and no entry.

## The file formats

An entry is `entries/<slug>.md`, UTF-8 with LF line endings:

```markdown
---
id: 7d0c2b8e-4f0a-4c2e-9a0b-1b2c3d4e5f60
title: "Discovery call script for agency clients"
kind: strategy
area: sales
context: "agency clients"
subject: "discovery call"
status: active
author: "André"
version: 3
created: 2026-11-08T23:10:00.000Z
updated: 2026-11-09T08:00:00.000Z
---
The body.
```

- `kind` is `knowledge`, `strategy`, `persona` or `pattern`. `area` is an area id of the root's taxonomy. `context` and `subject` are free text of at most 120 characters. `title` has 1 to 200 characters.
- `author` is a person's name, or `agent:<id>` with the host agent's id. A person's name never starts with `agent:`: the settings refuse it.
- The slug is lower-case letters, digits and hyphens, at most 80 characters, never a file name Windows reserves. A caller's slug is checked and refused when it fails, never normalised. With no slug, one is derived from the title.
- The frontmatter is a small YAML subset the module reads and writes itself, with no dependency: `key: value` lines, plain scalars, double-quoted strings, whole numbers, block lists. Keys this version does not know are kept, in order, when an entry is rewritten.

Parsing never throws. A file that cannot be read as an entry (no closing `---`, an unknown `kind` or `status`, a `version` that is not a whole number from 1, no title, no usable `id`, an `area` outside the taxonomy, more than 256 KiB) is indexed from its name with a `problem` and counted as a draft.

A proposal is `proposals/open/<proposal id>.md`: the proposed entry's fields and body, plus `entry` (the target's id, or the id a new entry will take), `slug`, `base_version` and `base_hash` (the target when the proposal was made; 0 and empty for a new entry), `proposed_by` and `proposed_at`. A decided one, under `proposals/decided/`, gains `decision`, `decided_by`, `decided_at` and, when accepted, `decided_version`.

`taxonomy.md` holds `version`, `updated` and `areas`, a list of `- id: Label` items. It starts with nine: code, management, marketing, sales, video, design, operations, finance, people.

## The repositories and the manifest

Each repository holds `knowledge.json` (its manifest), `.gitignore`, `entries/`, `proposals/open/` and `proposals/decided/`; the workspace and the shared ones also hold `taxonomy.md`. A repository is created at its first write, with one commit by the person whatever writer triggered it. Creating a project's repository creates the workspace's first, so the taxonomy exists to check against. Folders are created with mode 0700.

The manifest is `{"format": 1, "scope": …, "project": {"aliases": […]}, "createdAt": …}`. A project's repository is found by its manifest, not by its folder name: by the row the index holds for the project, else by a manifest whose `remote:` or `gitdir:` aliases are among the project's. A `path:` alias never matches, since a folder can be reused by another repository. A project that gains a remote therefore keeps its repository. When no manifest matches, a folder is created, named with 16 hex characters of the SHA-256 of the project's remote alias, or of its key when it has no remote.

A project that matches two manifests takes the one matched by a remote, else the newest. A manifest already mapped to one project is never taken by a second. `knowledge rebuild` prints both cases and `doctor` warns about them.

## git's isolation

Every git call goes through one runner (`runGit`): a synchronous process killed after 15 seconds, never on a hook path, with a command line and an environment built in one place.

- `--git-dir` and `--work-tree` are always explicit, and `GIT_CEILING_DIRECTORIES` is the knowledge folder: a data directory inside a parent git tree never commits into the parent.
- `GIT_CONFIG_GLOBAL` points at an empty file, `GIT_CONFIG_NOSYSTEM=1`, and `HOME` is not passed. `-c` settings turn off signing, hooks, fsmonitor, the untracked cache, the pager, external diff and the ssh command. Nothing of the person's git setup runs here. The one exception is the lookup of the person's global `user.name`.
- A repository's own `.git/config` is read as text before git is run in it. One that carries an `include`, `includeIf` or `filter` section, or a `hooksPath`, `fsmonitor` or `sshCommand` key, is refused: a folder dropped under `knowledge/` could carry a configuration that runs a program.
- git 2.32 or newer is required (`GIT_CONFIG_GLOBAL`). With no git, or an older one, writes are refused before any folder is created. Reading (`list`, `rebuild`) works without git, except the check for hand edits, which is then skipped and said.

## The lease and its renewal

Writes to one repository are serialised by the engine's leases (`knowledge.lease:<repository path>`, 60 seconds). A write takes the root's lease, then the repository's. The leases are renewed before every git call and every index transaction, and once per 500 files in a rebuild; a renewal that fails stops the operation before that step. A lease held by another live process refuses the operation, which is never queued. A lease whose owner process is gone is taken over at once. A store move, a restore and a compact wait for a write, since `anyLeaseActive` reads these leases too.

## The write and its failure rule

A person's write checks the fields, takes the leases, creates the repository when missing, refreshes the index, checks the area against the taxonomy, and checks the target: a regular file or nothing, indexed without a problem that makes it unusable, and as the last commit left it. A new entry is refused when the file exists. A change is refused when its base version is not the current one, and nothing changes. The file is written beside the target and renamed over it, staged by path and committed by path (`git commit --only`), then indexed.

Before its first change to the working tree an operation writes an intent record to `.git/wizardingcode-op.json`: the operation, the writer and the paths it changes. It removes the record after indexing. When the commit fails, every path is put back to what HEAD holds (a path HEAD does not hold is removed), the index and the recorded head are untouched, the error is logged, and the operation is refused. A process that died before its commit leaves the record behind: the next open of the repository puts the tree back by it. That revert is skipped while another process holds the repository's lease, since that operation is running, not interrupted. An operation whose commit landed before the process died has nothing to put back.

## Proposals and the quota

An agent's write never touches the entry. Its title, context, subject and body pass through `redact` first, since a proposal enters a history the engine never rewrites and a session's text may carry a secret; a person's write stays as written. A caller's slug that redaction would change is refused.

At most 5 open proposals wait for one target, and 200 in one repository. The quota is a ceiling on what an agent can pile up before a person looks, not a workflow.

Accepting requires an id that is a UUID (before any path is built), a proposal that is open and unchanged since its commit, an `entry` id that is a UUID and belongs to no other entry, valid fields, and a target at the proposal's base version. A target that moved makes the accept stale and the proposal stays open. A proposal for a new entry whose slug now exists is refused: a person decides between them. The entry, the decided file and the removal of the open file are one commit by the person, whose message names the agent. Rejecting moves the file with its decision. A proposal that names an unknown area can still be rejected.

## adopt

`wizardingcode-mem knowledge adopt` commits what a person changed outside the engine, as the person, in one commit that lists the paths. An entry file edited or added by hand gets an id when it has none, the next version (1 for a new file; otherwise one past the higher of HEAD's version and the number in the file), `updated` and the person as author; everything else stays as they left it. A file that is still not a valid entry is committed exactly as it is and returned with its problem. A file the person deleted is recorded as deleted. `taxonomy.md`, `knowledge.json` and proposal files are committed as they are.

Before rewriting anything, adopt keeps the files' bytes under `.git/`. When the commit fails, its paths are only unstaged and the bytes are written back: the person's work exists nowhere else, so it is never restored from HEAD.

## The taxonomy

Adding, renaming and removing an area are a person's writes, each one commit of `taxonomy.md` alone. Renaming changes the label and no entry. Removing takes the lease of every repository that reads the taxonomy, reads each of them again from its files, and is refused while an entry or an open proposal carries the area. An agent cannot change the taxonomy in this part.

## The index and the migration namespace

A module's tables are versioned apart from the core schema, in `module_migrations(module, version, name, applied_at)`. `openDb` applies them after the core migrations, through the same upgrade runner, and `PRAGMA user_version` stays 7: an older binary (0.6.0) opens the database and ignores the tables. This is the namespace ADR 0019's ruling F2 put off until a module needed it.

- The list `openDb` reads is `src/engine/module-schemas.ts`, which imports each module's migration list and no module code. A module's tables are created whether the module is on or not, so turning one on later never migrates on a hook.
- The first open after an upgrade creates the tables once, under the write lock, as a core migration does. That open is usually a hook. On a migrated database the module pass costs one query.
- A recorded module version newer than the binary's is left alone by `openDb`, so memory keeps working. The knowledge store refuses to read or write (`ModuleSchemaTooNewError`) and `doctor` names it.
- No knowledge table has a foreign key or a trigger on a core table.

Knowledge's first migration is **version 6**. Versions 1 to 5 of the module id `knowledge` belong to the withdrawn module of ADR 0020, and a store that ran it still holds those rows, for other tables. Migration 6 drops what the withdrawn module created where present, after a backup, and widens the two-column `module_migrations` table that module left. The index of project-folder knowledge such a store held is lost; no released version ever created it.

The tables are `knowledge_repos` (one row per repository: its path, HEAD, a fingerprint of its folders, the files the cap left out), `knowledge_entries` and `knowledge_proposals`. A rebuild lists the three folders in byte order, never follows a link, reads at most 5,000 names per folder and 256 KiB per file, and replaces the repository's rows in one transaction. No file fails it: one with no usable id is indexed under `file:<name>`, one that shares another's id under `dup:<name>`, and the first name in byte order keeps the id. A file git lists as changed is a draft with a problem until adopted. Before a write, the recorded HEAD and fingerprint are compared with the repository's, and the rows are rebuilt when either differs.

## The guarantee's boundary

For every write made through the engine, an agent's change reaches an entry only after a person accepts it. The store cannot tell a person from an agent: the entry point decides which writer it passes. The command line passes the person. The tools of the next part will pass the host's agent id, taken from the connection and never from a tool argument.

An agent with shell access to the data directory can write the files directly. Such an edit is a hand edit: the next write refuses it and `adopt` attributes it to the person. The guarantee does not cover it.

## Backups

`wizardingcode-mem backup` copies the database. It does not copy the knowledge repositories. The files under `<data dir>/knowledge/` are the truth, and until the team server holds a copy of what is shared, a person backs them up like any folder. The README says so.

## Growth

Decided proposals are never deleted, and each folder is indexed up to 5,000 names. `doctor` warns at 4,000, and `rebuild` prints how many files a folder left out. Archiving decided proposals is a later part's work.

## Known limits

- A project that is not a git repository is known by its folder path alone. A manifest is never matched by a path, so when the index rows of such a project are lost (a database restored from an older copy, a new database), its repository is reported as an orphan by `rebuild` and is not re-attached.
- When a project gains an alias, the manifest learns it at the project's next write, as an uncommitted change to `knowledge.json`. `doctor` then reports one change made outside the engine until `adopt` commits it.
- Only `.md` files in the three folders are knowledge. Other files there are ignored by the index, and committed as they are by `adopt`.
- An entry is not renamed and not moved between repositories in this part.

## Write latency

A write is three to eleven git calls (`status`, `add`, `commit`; `init`, `add`, `commit` for each of up to two repositories created; `--version` and the `user.name` lookup once per process), and the store blocks its own process for them. No hook calls the store.

Measured on 2026-11-09 on one machine (an Apple silicon Mac, git 2.54.0, a local SSD), 30 runs of each operation in a repository of about 30 entries, each entry about 400 bytes of body:

| Operation | p50 | p95 |
| :- | :- | :- |
| The first write, which creates the repository | 124 ms (one run) | |
| A person's new entry | 51 ms | 78 ms |
| A person's change | 49 ms | 67 ms |
| An agent's proposal | 48 ms | 66 ms |
| Accepting a proposal | 79 ms | 93 ms |
| Reading an entry | under 1 ms | under 1 ms |
| Rebuilding the index of 31 entries and 30 proposals | 17 ms (one run) | |

Not measured: a repository of thousands of entries, a slow or network disk, Linux, Windows. The next part runs one write per tool call and measures again before accepting the cost there.

## What the later parts add

- **Knowledge for the agent**: the module in the composer, the tools to search, read and propose, the judgements of duplicates and contradictions through the `Judge` interface, the full-text index, and the reversal of ADR 0019's note of 2026-10-13 in that ADR's text.
- **The viewer**: the Knowledge and Personas views, deciding proposals, editing the taxonomy.
- **The sharing policy** (ADR 0025, not written yet): what may leave the machine, per project and per area.
- **The team server and the sync** (ADR 0026, not written yet): members, devices, the server's copy of what is shared, and the author's name replaced by the member's.
