# Concepts brief: the knowledge store

## Overview

wizardingcode-mem gains the storage of its second module, knowledge: Markdown entries with frontmatter in one git repository per scope under the data directory, an index in the engine's database rebuilt from the files, one commit per write with its author, and an agent's write held as a proposal file until a person accepts it. This part is storage, index and versioning; the tools and the composer (part 2), the viewer (part 3), the sharing policy (part 4) and the team server and sync (parts 5 and 6) build on it. The concept (`concept.md`) went to six reviewers with no context in brainstorm mode; their answers are under `spec-review/`. This brief is the concept after them.

## Analysis

What the six lenses found, merged; each point says what the design now does.

**Identity.** An entry had no identity but its slug, so a rename, a sync or two machines creating the same slug would collide (structural, design). Every entry and every proposal now carries an `id` (a UUID written at creation, never changed); the index keys on it and the slug is a name that may change.

**The project folder was not stable.** `projects.key` is set once when a project is first seen and never updated, so two clones, or a project that gains a remote later, hash to different folders; the hash cannot be reversed (zoom-out, design, readiness, codebase, structural). The repository now holds a manifest (`knowledge.json`: format version, scope, the project's aliases). A project's repository is found through the manifest's aliases first; the folder name comes from the `remote:` alias when there is one, else the project's key. A rebuild maps folders back to projects through the manifest and lists the orphans.

**The version counter.** A counter alone cannot tell a hand edit from an engine write and will conflict on sync (zoom-out, structural, design). The user asked for versions, so `version` stays as the counter people see and as the local stale check; the index also records the content `hash` of each file, and a proposal records `base_hash`, which the later merge view and sync use. The ADR says the counter is local.

**Hand edits and dirty trees.** The team edits files by hand today; a write that sweeps uncommitted changes into its own commit misattributes them (comprehension, design, codebase, structural). A write now commits only its own path (`git add -- <path>`, `git commit -- <path>`), refuses when its target path has uncommitted changes, and `wizardingcode-mem knowledge adopt` commits hand edits as the person, normalising the frontmatter. A rebuild indexes the working tree and flags a dirty file as a problem until it is adopted.

**The taxonomy across repositories.** One commit cannot span repositories, and a shared entry validated against one person's workspace taxonomy is valid on one machine and not on another (comprehension, design, structural). Areas now have an immutable `id` and a renamable `label`, so a rename rewrites no entry; the workspace and the shared repositories each hold their own `taxonomy.md`; project repositories use the workspace's; removal is refused while an entry in any local repository carries the id.

**The order of a write.** The concept raised the version after the commit and said nothing about a failure between the rename and the commit (design, readiness, codebase). The order is now fixed: lease, clean-path check, render with the new version, temp file and rename, add and commit by path, index, release; a git failure restores the path from HEAD and refuses with git's stderr, logged under `knowledge.write`; an index failure after a commit is healed by the head comparison.

**The lock.** An age-only lock file can be stolen from a live writer and is swept by `git add -A` (zoom-out, design, codebase, structural). The engine's leases (`src/store/meta.ts`, owner-alive check) are used instead: one lease per repository, 60 s, a git call killed after 15 s. A stale `.git/index.lock` is named by `doctor`.

**git isolation.** The user's global and system configuration (hooks, signing, fsmonitor, templates, `autocrlf`) must not run or leak, and a repository under a parent git tree must never be committed into (design, codebase, structural). Every git call runs with `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CEILING_DIRECTORIES`, an explicit `--git-dir` and `--work-tree`, and `-c` settings for the default branch, hooks path, signing and `autocrlf`; git 2.32 or newer is required and checked.

**The module migration namespace.** Core `migrate()` returns before the lock when `user_version` is current, so module migrations need their own pass; a newer module version has no `SchemaTooNewError`; the archived module used the same module id and versions 1 to 5 with other tables (readiness, codebase, structural). The pass runs after the core's, under its own `BEGIN IMMEDIATE`, re-reading under the lock; knowledge commands refuse when the recorded module version is newer than the binary's; the first migration of this module is version 6, named for the store, and drops what the archived versions 1 to 5 created where they exist. The first open after an upgrade creates the tables, possibly from a hook: a one-time DDL, said in the ADR.

**Proposals.** Ids must be globally unique, the base must be recoverable, decided proposals must stay findable without `git log`, and nothing bounded how many an agent could file (comprehension, design, structural). Ids are UUIDs; a proposal records `base_version` and `base_hash`; a decision moves the file from `proposals/open/` to `proposals/decided/` with the decision appended, so the history and the index both keep it; at most 5 open proposals per target and 200 per repository.

**Who is a person.** The store cannot tell a caller's nature by itself (comprehension, design). The channel decides and the store takes a typed `Writer`: the MCP tools of part 2 always pass the host's agent id (never a tool argument), the viewer and the CLI pass the person. The ADR states this as the guarantee's boundary: an agent with shell access to the data directory is outside it.

**Backups and moves.** Backups copy the database only; the files are the truth (readiness, codebase, design). The spec and the ADR say so plainly; the repository paths in the index are relative to the data directory; a database restore invalidates the index, which the head comparison repairs.

**Smaller points taken.** Timestamps, not dates, in `created` and `updated`; an `agent:<id>` is the host agent's id; the commit e-mail is derived from the author, not the entry; `supersedes` reserved as an optional field; a disabled project (memory off) still has a repository, and the later parts decide what it is shown; the FTS table waits for part 2, which searches; user rules and knowledge are an open question for part 2; `--scope project` means every project repository.

**Not taken, with the reason.** Deferring the shared scope (zoom-out): the mission names it for this part, and with its own taxonomy and an index keyed by repository id, its later layout is a folder change. Dropping the version counter for a hash alone (zoom-out, structural): the user asked for versions; both are kept. Porting the archived branch's code (zoom-out): the mission says every file is written fresh against the current engine; its read-safety limits (file caps, `O_NOFOLLOW`, strict slugs) are taken as requirements.

## Goals vs. Non-Goals

Goals: the entry format with `id`; three scopes as git repositories under the data directory with a manifest; module-owned tables and the migration pass; writes by path with author, version and hash; proposals open and decided; the taxonomy with ids and labels per root repository; `knowledge rebuild`, `knowledge adopt`, `knowledge list`; a `knowledge` line in `doctor`; ADR 0024 as a draft.

Non-goals: context for the agent, tools, viewer, sharing, sync, server, semantic judgement, an FTS index, imports, deletion of entries, the binary's rename, a backup of the repositories.

## Alternatives Weighed

- Files inside each project (`.wizardingcode/knowledge/`, ADR 0020): rejected; the engine's commits would land in the user's repositories, a project's knowledge would leave with the project's push, and workspace and shared have no project to live in.
- An own version log instead of git: rejected; a second history to keep right and nothing a person can inspect with git.
- A content hash alone, no version counter: rejected; the user asked for versions, and a counter is what a person reads; the hash is kept beside it.
- Proposals as database rows: rejected; the index is rebuilt from the files, so the proposal would be lost.
- Proposals as git branches: rejected for this part; a branch per proposal needs `git log` and merges to list and decide, which the viewer and the tools would pay for on every read; a file is listed by the index.
- Folders by area: rejected; a rename would move files.
- Deleting decided proposals: rejected; a decision is knowledge about the knowledge, and the index should find it without a process.
- A lock file in the repository: rejected; the engine's leases know whether the owner is alive and never enter the tree.
- Holding the SQLite write lock through the commit: rejected; hooks would wait on a process.
- Area rename by rewriting entries: rejected; one commit cannot span repositories and a rename should not touch content.
- Reusing module versions 1 to 5: rejected; stores that ran the archived module hold them for other tables.
- A JSON taxonomy: rejected; one format for every file.

## Key Decisions

D-1 to D-7 as recorded in the item (data directory, git per scope, proposals as files, flat layout, statuses without deletion, the taxonomy file, the author rule), and four more the lenses forced:

- D-8: every entry and proposal has an immutable `id`; `version` is a local counter beside a content `hash`.
- D-9: areas have an immutable `id` and a renamable `label`; the workspace and the shared repository each hold a taxonomy.
- D-10: a decided proposal is moved to `proposals/decided/`, never deleted.
- D-11: a write refuses a target path with uncommitted changes; `knowledge adopt` commits hand edits as the person.
