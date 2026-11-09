# ADR 0024 — The knowledge module: a versioned store beside memory

Date: 2026-11-09 · Status: **draft**. This is part 1 of the knowledge module (the store: files, repositories, index, versions, proposals), built and tested. The parts that give knowledge to an agent, show it in the viewer, share it and sync it are not built yet; each completes this ADR when it lands ([What the later parts add](#what-the-later-parts-add)). The eleven rulings below were taken on 2026-11-08 under their stated conservative defaults, with nobody present, and the author approved the specification that rests on them on 2026-11-09. Review of the code then changed details of the design (what a repository's configuration may hold, what a folder the store did not make is, how an interrupted operation is put back). Where this record and that specification differ, this record is the later one.

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

The manifest is `{"format": 1, "scope": …, "project": {"aliases": […]}, "createdAt": …}`. A project's repository is found by its manifest, not by its folder name: by the row the index holds for the project, else by a manifest whose `remote:` or `gitdir:` aliases are among the project's. The row comes first while anything is at the name it holds, whatever that is; a manifest is looked for only when nothing is there (see "Only a name with nothing at it is gone", below). A folder the row names that was emptied by hand gets its manifest again with the repository a write makes in it. A `path:` alias never matches, since a folder can be reused by another repository. A project that gains a remote therefore keeps its repository, and its manifest learns the new alias at the project's next write, in a commit of `knowledge.json` alone by the person. That commit is made under the repository's own lease, with a record like any write's: one that stops midway is put back at the next open, never left for `adopt` to credit to the person. While another process holds the lease, the alias waits for the next write. When no manifest matches, a folder is created, named with 16 hex characters of the SHA-256 of the project's remote alias, or of its key when it has no remote.

A project that matches two manifests takes the one matched by a remote, else the newest. A manifest already mapped to one project is never taken by a second. `knowledge rebuild` prints both cases and `doctor` warns about them.

## git's isolation

Every git call goes through one runner (`runGit`): a synchronous process killed after 15 seconds, never on a hook path, with a command line and an environment built in one place.

- `--git-dir` and `--work-tree` are always explicit, and `GIT_CEILING_DIRECTORIES` is the knowledge folder: a data directory inside a parent git tree never commits into the parent.
- `GIT_CONFIG_GLOBAL` is `/dev/null`, git's own name for no configuration file, `GIT_CONFIG_NOSYSTEM=1`, and `HOME` is not passed. `-c` settings turn off signing, fsmonitor, the untracked cache, the pager, external diff and the ssh command. Nothing of the person's git setup runs here. The one exception is the lookup of the person's global `user.name`.
- No hook runs. `core.hooksPath` is the repository's own `.git/config`, which is a file: nothing can be inside a file, so git finds no hook there, on any system. `git init` is given an empty template name, so it copies no template.
- The store keeps no file or folder of its own beside the repositories for git to be pointed at. An earlier version kept an empty hooks folder, an empty template and an empty configuration file under `knowledge/`, and whoever could drop a file there could fill them: a hook, a template's configuration and a filter each ran a program.
- A repository's own `.git/config` is read as text before git is run in it, and it may hold only the settings `git init` writes: `repositoryformatversion`, `filemode`, `bare`, `logallrefupdates`, `ignorecase`, `precomposeunicode` and `symlinks`, all under `core`. Any other setting is refused by its name, since a folder dropped under `knowledge/` could carry a configuration that runs a program (a filter, a hooks path, a diff driver) or reads another file (an include). The rule lists what is allowed because a list of what is refused would have to name every such setting, and the first two versions of this check, which listed refusals, each missed some.
- Each line of that file is read by git's own grammar: several section headers may share a line, a key may follow them, and a carriage return alone does not end a line. A line the store cannot read that way is refused, never skipped. Every line is read, also one that continues the value before it, so the store reads more lines as settings than git does, never fewer. The file itself must be a regular file of at most 256 KiB: a link, which git would follow to another file, is refused, and so is a larger file.
- git also reads a repository's configuration from the directory a `.git/commondir` file names, and from `.git/config.worktree` when `extensions.worktreeConfig` is set. Both files are refused, so the one file read is the one git reads. A `.git/objects/info/alternates` file, which has git read objects from another repository on the disk, is refused with them.
- A new repository is created with the object and ref formats the store reads (`init.defaultObjectFormat=sha1`, `init.defaultRefFormat=files`). git writes other formats to `.git/config` as extensions, which the rule above refuses.
- A folder the store did not make is refused before git runs and before anything is written: a repository folder that is a link, a `.git` that is a file or a link (a gitfile names another repository, and every commit would land there), an `entries` or `proposals` folder that is a link, a link where the store keeps `knowledge.json`, `taxonomy.md` or `.gitignore`, and a `.gitmodules` file.
- A `.git` that holds anything but regular files and folders is refused. git writes inside it: its commit message and a line of its log in place, objects and branches into its folders. Through a link there, git wrote into a file of the person's, and through linked `refs` and `objects` folders it committed into another repository. Every entry is read with its kind, at every depth, except the files inside the folders of `objects/`, which git reads, replaces whole or, in its own housekeeping, removes (Known limits says what that leaves open). A folder there that cannot be listed is refused as well, since git goes through it by name all the same and what it holds would go unchecked. One thing other than a file or a folder is let through: the socket `fsmonitor--daemon.ipc` at the top of `.git`, which a person's own git leaves there while its file monitor runs, and which the store's git never uses.
- `knowledge/` and `knowledge/projects/` must be folders themselves. Every repository is listed and created under them, and through a link at either a project's whole repository, with the person's name in it, was created in another folder. Both are checked before anything under them is listed or created. The data directory itself may be a link: that is the way to keep the knowledge on another disk. `WIZARDINGCODE_MEM_DATA_DIR`, which moves this product's data directory, and `WIZARDINGCODE_HOME`, which moves the brand's whole home, do it too, but each must then be set in the environment of every agent, since the settings file cannot hold what locates it (ADR 0010). The store directory of ADR 0010 does not carry the knowledge: only the database follows it, and the repositories stay under the data directory (D-1).
- Only a name with nothing at it is gone. Where the store decides whether a repository is there, or which entry and proposal files it holds, three things are never read as nothing:
  - What cannot be looked at. `knowledge/`, `knowledge/projects/`, a repository's folder, and a repository's `entries/` and `proposals/` folders: where one of them cannot be listed, or a name in it cannot be looked at (its permission bits are off, the disk fails), the command is refused with the path and the error's code named. For the two folders at the top the whole command is refused; for a repository, that repository is set aside by name and the others are done.
  - A link or a file put where a repository's folder was. It is refused by name where the repository is opened, and `rebuild`, `list` and `adopt` set it aside. A write never makes a second folder beside it.
  - A project's folder that no longer reads as the store left it: its manifest gone, or unreadable. The name the project's row holds is the project's while anything is at it.

  Inside a repository that has passed these checks, the store's older reads (`isDirectory`, `existsOnDisk`) still take any failure to look for "not there"; each sits behind one of the refusals above, and none decides whether a repository is there. The root's taxonomy is not read through a link either: with a link or a file at the workspace's or the shared repository's name, a project's rebuild and `doctor` check its entries against no taxonomy, and the root is refused by name in the same run.

  In each case the index rows stay as they were. Before these rules, `rebuild` forgot the rows of a repository it could not see, or whose folder a link had replaced, and a write gave the project a second, empty folder. For a project that is not a git repository the row is the only tie to its folder, so the folder put back was never the project's again. `doctor` lists the folders by the same rules, with and without a database, and does not count a repository the store refuses among the ones it read.

  `rebuild`, and only `rebuild`, has one more refusal. Under a data directory with no `knowledge/` folder at all, while the index holds repositories, the rows were written under another data directory that shares the database, or the folder was removed whole, and the store cannot tell which: `rebuild` refuses, forgets nothing, and says both. An empty `knowledge/` folder made by hand is the person's word that the repositories are gone, and `rebuild` then forgets them; for a project that is not a git repository that cannot be undone. A write is not refused in that state, and neither is any command once the folder exists: Known limits, "The index belongs to one data directory", says what a write does there.
- The store reads a repository's HEAD without git, and follows it only to a name under `refs/` that has no `..`, `\` or `:` in it. A HEAD that names a path out of the git directory is read as no commit.
- git never runs in a repository nested inside a knowledge repository. `git status` is always given `--ignore-submodules=all`, which wins over every setting. Without it, git runs a second `git status` inside the nested repository, under that repository's own configuration, which the store never checked. Every git call also carries `diff.ignoreSubmodules=all` and `submodule.recurse=false` as a second layer; a `.gitmodules` setting overrides those two, and only the flag wins over it. `adopt` refuses a folder that is a git repository of its own, and names it.
- A path is followed only through folders. Where a folder on the way to a file, inside the repository, is a link, the file beyond it is another folder's: the store does not read it as its own, restore it or remove it, whatever a record says.
- Paths are passed to git as literal paths (`GIT_LITERAL_PATHSPECS`): a file a person named with `*` or `[` never matches another.
- git 2.32 or newer is required (`GIT_CONFIG_GLOBAL`). With no git, or an older one, writes are refused before any folder is created. Reading (`list`, `rebuild`) works without git, except the check for hand edits, which is then skipped and said.

## The lease and its renewal

Writes to one repository are serialised by the engine's leases (`knowledge.lease:<repository path>`, 60 seconds). A write takes the root's lease, then the repository's. The leases are renewed before every git call and every index transaction, and once per 500 files in a rebuild; a renewal that fails stops the operation before that step. A lease held by another live process refuses the operation, which is never queued. A lease whose owner process is gone is taken over at once. A store move, a restore and a compact are refused while a write is under way, since `anyLeaseActive` reads these leases too.

## The write and its failure rule

A person's write checks the fields, takes the leases, creates the repository when missing, refreshes the index, checks the area against the taxonomy, and checks the target: a regular file or nothing, indexed without a problem that makes it unusable, and as the last commit left it. A new entry is refused when the file exists. A change is refused when its base version is not the current one, and nothing changes. The file is written beside the target and renamed over it, staged by path and committed by path (`git commit --only`), then indexed.

Before its first change to the working tree an operation writes an intent record to `.git/wizardingcode-op.json`: the operation, the writer, the paths it changes, and what it leaves at each path (the hash of the file it writes, or that it removes it). It removes the record after indexing. When the commit fails, every path is put back to what HEAD holds (a path HEAD does not hold is removed), the index and the recorded head are untouched, the error is logged, and the operation is refused.

A process that died before its commit leaves the record behind, and the next open of the repository acts on it, each path by itself. A path that is clean against HEAD needs nothing: its commit landed, or the operation never reached it. Of the others, only a path that is still as the engine left it is put back. A path that is not as the engine left it may be the person's work: it is taken out of the index and left for `adopt`, never restored from HEAD and never deleted. A record that does not say what was written puts nothing back. The revert is skipped while another process holds the repository's lease, since that operation is running, not interrupted. What the revert did is written to the log and, from the command line, to standard error.

The record sits in a folder that may have been dropped there, so it is acted on only when it is one the store could have written: a known operation, and no path but the manifest, the taxonomy and files under `entries/` and `proposals/`. A record that names any other path (`.git/config`, for one) is removed with the kept bytes it names, nothing is put back, and the person is told. Without this rule, the revert would write where the record says, after the configuration was checked. The record and the kept bytes are read as regular files, never through a link, and whole: an adopt writes them as large as the files it adopts, so a cap on reading them would lose what it kept.

## Proposals and the quota

An agent's write never touches the entry. Its title, context, subject and body pass through `redact` first, since a proposal enters a history the engine never rewrites and a session's text may carry a secret; a person's write stays as written. A caller's slug that redaction would change is refused.

At most 5 open proposals wait for one target, and 200 in one repository. The quota is a ceiling on what an agent can pile up before a person looks, not a workflow.

Accepting requires an id that is a UUID (before any path is built), a proposal that is open and unchanged since its commit, an `entry` id that is a UUID and belongs to no other entry, valid fields, and a target at the proposal's base version. A target that moved makes the accept stale and the proposal stays open. A proposal for a new entry whose slug now exists is refused: a person decides between them. The entry, the decided file and the removal of the open file are one commit by the person, whose message names the agent. Rejecting moves the file with its decision. A proposal that names an unknown area can still be rejected.

## adopt

`wizardingcode-mem knowledge adopt` commits what a person changed outside the engine, as the person, in one commit that lists the paths, one line each: a line break or another control character in a file's name is written as `?` there. An entry file edited or added by hand gets an id when it has none, the next version (1 for a new file; otherwise one past the higher of HEAD's version and the number in the file), `updated` and the person as author; everything else stays as they left it. A file that is still not a valid entry is committed exactly as it is and returned with its problem. A file the person deleted is recorded as deleted. `taxonomy.md`, `knowledge.json` and proposal files are committed as they are.

Before rewriting anything, adopt writes its record and then keeps the bytes of the entry files under `.git/`, under the name the record gives, so that no kept bytes are left without a record to remove them. When the commit fails, its paths are only unstaged and the bytes are written back: the person's work exists nowhere else, so it is never restored from HEAD. An adopt that was interrupted gives the kept bytes back at the next open, and only for a file the person did not go on editing: a later edit wins over the older bytes. Kept bytes are written back only to a file directly under `entries/`. The adopt's record says what it leaves at every path, a removal included, so an interrupted adopt is undone path by path.

## The taxonomy

Adding, renaming and removing an area are a person's writes, each one commit of `taxonomy.md` alone. Renaming changes the label and no entry. Removing takes the lease of every repository that reads the taxonomy, reads each of them again from its files, and is refused while an entry or an open proposal carries the area. An agent cannot change the taxonomy in this part.

## The index and the migration namespace

A module's tables are versioned apart from the core schema, in `module_migrations(module, version, name, applied_at)`. `openDb` applies them after the core migrations, through the same upgrade runner, and `PRAGMA user_version` stays 7: an older binary (0.6.0) opens the database and ignores the tables. This is the namespace ADR 0019's ruling F2 put off until a module needed it.

- The list `openDb` reads is `src/engine/module-schemas.ts`, which imports each module's migration list and no module code. A module's tables are created whether the module is on or not, so turning one on later never migrates on a hook.
- The first open after an upgrade creates the tables once, under the write lock, as a core migration does. That open is usually a hook. On a migrated database the module pass costs one query.
- A recorded module version newer than the binary's is left alone by `openDb`, so memory keeps working. The knowledge store refuses to read or write (`ModuleSchemaTooNewError`), a rebuild and a listing included since both write rows, and `doctor` names it.
- No knowledge table has a foreign key or a trigger on a core table.

Knowledge's first migration is **version 6**. Versions 1 to 5 of the module id `knowledge` belong to the withdrawn module of ADR 0020, and a store that ran it still holds those rows, for other tables. Migration 6 drops what the withdrawn module created where present, after a backup, and widens the two-column `module_migrations` table that module left. It also deletes the three rows that module's promotion pass kept in the core table `meta`, which nothing reads now. The index of project-folder knowledge such a store held is lost; no released version ever created it.

The tables are `knowledge_repos` (one row per repository: its path, HEAD, a fingerprint of its folders, the files the cap left out), `knowledge_entries` and `knowledge_proposals`. A rebuild lists the three folders in byte order, never follows a link, reads at most 5,000 names per folder and 256 KiB per file, and replaces the repository's rows in one transaction. No file fails it: one with no usable id is indexed under `file:<name>`, one that shares another's id under `dup:<name>`, and the first name in byte order keeps the id. For a proposal the name carries its folder (`file:open/<file>`, `dup:decided/<file>`), since the same file name can sit under both; a file under `proposals/decided/` that says nothing of its decision is listed with that problem. A file git lists as changed is a draft with a problem until adopted.

Before a write, the recorded HEAD and fingerprint are compared with the repository's, and the rows are rebuilt when either differs. A rebuild takes the HEAD and the fingerprint before it reads the files, and a write records a fingerprint only when the folders were as the index knew them when it began: a file a person adds while the engine works then shows as a fingerprint the index does not hold, and the next refresh reads the repository again.

## The guarantee's boundary

For every write made through the engine, an agent's change reaches an entry only after a person accepts it. The store cannot tell a person from an agent: the entry point decides which writer it passes. The command line passes the person. The tools of the next part will pass the host's agent id, taken from the connection and never from a tool argument.

An agent with shell access to the data directory can write the files directly. Such an edit is a hand edit: the next write refuses it and `adopt` attributes it to the person. The guarantee does not cover it.

## Personal data: what is kept, for how long, and how it is erased

The only personal data this part holds is the person's author name (the `WIZARDINGCODE_MEM_AUTHOR` setting, else the global git `user.name`). It is written in three places, all inside the person's own data directory, and nothing leaves the machine in this part:

- the `author` line of an entry and the `decided_by` line of a decided proposal;
- the author and the committer of each commit, with an address derived from the name at `.invalid`, a reserved domain that never routes;
- the index columns `knowledge_entries.author`, `knowledge_proposals.proposed_by` and `knowledge_proposals.decided_by`.

**Retention.** As long as the repository's history. The engine never rewrites a commit and never deletes an entry, so a name written once stays until a person removes it. This differs from memory, where `compact` prunes old records.

**Erasure.** There is no command for it in this part. A new name applies to what is written from then on: change the setting. To remove a name already written from one repository, a person rewrites that repository's history with git (the author and committer of its commits, and the `author` and `decided_by` lines in its files), then runs `wizardingcode-mem knowledge rebuild`, which replaces the index rows from the files. Deleting a repository's folder and running `rebuild` removes everything it held, the index rows included. A command that erases a name is a later part's work, and is needed before knowledge is shared with a team, where a name leaves the machine.

A repository the store refuses is not rebuilt: its rows, the name among them, stay as they were last indexed until it is accepted again or its folder is removed.

`wizardingcode-mem backup` copies the database, and the database now holds the index: the text of entries and the names above go wherever backups are configured to go (a folder, or a bucket).

## Backups

`wizardingcode-mem backup` copies the database. It does not copy the knowledge repositories. The files under `<data dir>/knowledge/` are the truth, and until the team server holds a copy of what is shared, a person backs them up like any folder. The README says so.

## Growth

Decided proposals are never deleted, and each folder is indexed up to 5,000 names. `doctor` warns at 4,000, and `rebuild` prints how many files a folder left out. Archiving decided proposals is a later part's work.

## Known limits

- A project that is not a git repository is known by its folder path alone. A manifest is never matched by a path, so when the index rows of such a project are lost (a database restored from an older copy, a new database), its repository is reported as an orphan by `rebuild` and is not re-attached.
- The index belongs to one data directory: its rows name folders by their path under it. One database shared by two data directories (`WIZARDINGCODE_MEM_STORE_DIR` set for both) is not supported for knowledge. `rebuild` refuses in the one case it can see, a data directory with no `knowledge/` folder. A write is not refused there: under the second data directory it makes `knowledge/`, gives the project a second folder (`<name>-2`) under it, points the project's row at that folder and drops the project's rows from the index. After that write `rebuild` there is no longer refused, and until it `doctor` there says only "no knowledge repository yet". Where the second data directory has a `knowledge/` folder of its own, a write does the same, and `rebuild` there forgets the rows of the first one's repositories. The files of the first are never touched, and a project that is not a git repository then finds its folder again only as an orphan (the limit above). Only the shell command writes in this part. The part that lets an agent's tool write must refuse a write in the state `rebuild` refuses, before it does anything else.
- A project's folder that is still there and holds no repository (emptied by hand, or its `.git` deleted) keeps its rows as they were last indexed: `rebuild` prints `not a repository` for it and exits 0, `doctor` warns, and the next write makes the repository again in the same folder and replaces the rows. Nothing reads the index in this part; a part that does must not show those rows as current.
- A name under `knowledge/projects/` that is not a folder and does not start with a dot (a file an operating system or a tool leaves there) is reported: an orphan in `rebuild`, a warning in `doctor`, until it is removed. It blocks nothing.
- The workspace's and the shared repository's manifest, when missing, is written back by the next write even into a repository that has commits, and is left uncommitted for `adopt`; a project's is written only into a folder with no commit. The difference has no reason of its own: the line for the two fixed scopes is older than the rule, and was left as it was.
- Only `.md` files in the three folders are knowledge. Other files there are ignored by the index, and committed as they are by `adopt`.
- An entry is not renamed and not moved between repositories in this part.
- A file a person adds by hand while a write is under way is recorded in the fingerprint without being read. The window opens when the write has checked the folders and closes when it has indexed its commit: the time of its git calls, about 40 ms on the machine measured below. The file is still listed by git as untracked, so `doctor` reports it and `adopt` commits and indexes it.
- A knowledge repository's `.git/config` holds only what `git init` writes. A setting a person adds there (a remote, a local user name) makes every command on that repository refuse it, naming the setting, until the person removes it. `list`, `rebuild` and `adopt` go on with the other repositories, say the refused one on standard error and exit with 1. A refused workspace repository still stops every project's write, since a project's areas are checked against the workspace's taxonomy.
- `/dev/null` as the global configuration, a file as the hooks path and an empty template name were run on macOS with git 2.54.0. They were not run on Windows, where the binary is also built.
- The files inside the folders of `.git/objects/` are not checked. A linked object or pack there has git read another repository's objects, as an `alternates` file would. A link there may also be a way to delete or write: the store does not turn off git's own housekeeping (`gc.auto`, `maintenance.auto`), and an automatic gc that a commit starts removes and rewrites files below `objects/`, for one under `objects/info/commit-graphs`, through such a link. That was read from git's source by a reviewer and not reproduced: the one run made, with git 2.54.0, started no gc (the item's probe `auto-gc.md` says what it does not show). Such a link can only be put there by a process of the person's own user, which could delete those files itself. Listing those folders on every open was measured at 4 ms with 500 loose objects and 8 ms with 6,700, against 0.3 ms without, and every read would pay it. Nothing leaves the machine and no repository arrives from outside in this part. The sync part closes both, the unchecked files and the housekeeping settings, before a repository is sent anywhere or accepted from anywhere.
- A person's own git, set up with `core.fsmonitor`, leaves a socket in `.git/` while its daemon runs. That one socket is let through. Anything else a tool leaves there that is neither a file nor a folder makes the store refuse the repository, naming it, until it is removed. Which tools do so was not surveyed.
- A file that is hard-linked to another is not told from any other file. A hard link to a file outside the repository can only be made by a process of the person's own user on the same disk, which could write that file itself.
- The two format settings were run with git 2.54.0, where they leave `.git/config` as `git init` writes it by default. With the other formats named, the same git writes `extensions.objectformat` and `extensions.refstorage`. No git that defaults to those formats existed to run them against.
- A module migration that fails makes `openDb` fail, so memory stops until the cause is fixed, over a module no hook reads in this part. Containing the failure would need a rule for not repeating the attempt, and its backup, on every open; that is not built.
- On a store that ran the withdrawn module, the one backup taken before migration 6 drops its tables is kept among the two most recent upgrade backups, and two later upgrades rotate it away.

## Write latency

A write is three to eleven git calls (`status`, `add`, `commit`; `init`, `add`, `commit` for each of up to two repositories created; `--version` and the `user.name` lookup once per process), and the store blocks its own process for them. No hook calls the store.

Measured on 2026-11-09 on one machine (an Apple silicon Mac, git 2.54.0, a local SSD), 30 runs of each operation in a repository of about 30 entries, each entry about 400 bytes of body. These are the figures of the code as it stands, with every check on the repository and on its `.git` in place:

| Operation | p50 | p95 |
| :- | :- | :- |
| The first write, which creates the repository | 100 ms (one run) | |
| A person's new entry | 39 ms | 43 ms |
| A person's change | 39 ms | 44 ms |
| An agent's proposal | 40 ms | 45 ms |
| Accepting a proposal | 57 ms | 68 ms |
| Reading an entry | under 1 ms | 1 ms |
| Rebuilding the index of 31 entries and 30 proposals | 13 ms (one run) | |

Not measured: a repository of thousands of entries, a slow or network disk, Linux, Windows. The next part runs one write per tool call and measures again before accepting the cost there.

## What the later parts add

- **Knowledge for the agent**: the module in the composer, the tools to search, read and propose, the judgements of duplicates and contradictions through the `Judge` interface, the full-text index, and the reversal of ADR 0019's note of 2026-10-13 in that ADR's text.
- **The viewer**: the Knowledge and Personas views, deciding proposals, editing the taxonomy.
- **The sharing policy** (ADR 0025, not written yet): what may leave the machine, per project and per area.
- **The team server and the sync** (ADR 0026, not written yet): members, devices, the server's copy of what is shared, and the author's name replaced by the member's. If the sync writes a setting into a repository's `.git/config` (a remote, a branch), it adds that setting to the list of allowed ones in the same release: a binary without it refuses the repository. The same holds for a new operation that leaves a record: a binary that does not know its name removes the record, and the kept bytes it names, without putting anything back.
