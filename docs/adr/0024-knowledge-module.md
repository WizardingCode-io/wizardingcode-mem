# ADR 0024 — The knowledge module: a versioned store beside memory

Date: 2026-11-09 · Status: **draft**. Part 1 of the knowledge module (the store: files, repositories, index, versions, proposals) and part 2 (knowledge for the agent: the module in the composer, the three tools, the judge; [Part 2](#part-2-knowledge-for-the-agent)) are built and tested. The parts that show knowledge in the viewer, share it and sync it are not built yet; each completes this ADR when it lands ([What the later parts add](#what-the-later-parts-add)). The eleven rulings below were taken on 2026-11-08 under their stated conservative defaults, with nobody present, and the author approved the specification that rests on them on 2026-11-09. Review of the code then changed details of the design (what a repository's configuration may hold, what a folder the store did not make is, how an interrupted operation is put back). Where this record and that specification differ, this record is the later one.

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

For every write made through the engine, an agent's change reaches an entry only after a person accepts it. The store cannot tell a person from an agent: the entry point decides which writer it passes. The command line passes the person. The tools of part 2 pass the host's agent id, taken from the connection and never from a tool argument ([The agent id and its boundary](#the-agent-id-and-its-boundary)).

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
- A module migration that fails makes `openDb` fail, so memory stops until the cause is fixed. Part 1 said this was over a module no hook reads; since part 2 the hooks read the module and migration 7 (an FTS5 table and `ALTER TABLE`s) runs on the first open after an upgrade, so a failure there stops memory for every project until it is fixed, with the pre-upgrade backup `openDb` takes as the way back. Containing the failure would need a rule for not repeating the attempt, and its backup, on every open; that is not built.
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

## Part 2: knowledge for the agent

Date: 2026-11-09 · Status: **draft**, built and tested. The knowledge module is in the engine's composer, offers three MCP tools, and judges an agent's proposal against what the team already wrote. Fifteen of the specification's sixteen decisions took their recorded defaults on 2026-11-09 with nobody present; the sixteenth, D-9, was put to the person and confirmed by them the same day. The specification is `.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md`. Where this record and that specification differ, this record is the later one, and the differences are said where they fall.

Part 2's decisions are numbered in its own specification, D-1 to D-16, a series apart from part 1's D-1 to D-11 above. In this part they are written "D-9 (part 2)".

### The reversal of ADR 0019's note of 2026-10-13

[ADR 0019](0019-one-engine.md) ends with a note of 2026-10-13: knowledge and personas are a separate product, memory is the engine's only module, and how the two products avoid injecting the same context twice is that product's design. The author reversed it on 2026-11-08 ([Context](#context)), and part 2 is the reversal in code: knowledge is in `BUILT_IN` beside memory, and `WIZARDINGCODE_MODULES` defaults to `memory,knowledge`.

It holds because the engine took a second module with three small additions to its contract and no other change: the composer's rule F5′ (below), an optional `globalInstructions` string per module, and an optional `agentId` on the engine's `ToolCall`. The question the note left to a separate product, two products putting the same context in front of the agent, does not arise: one composer measures both modules against one budget per moment, and every module keys its data by the engine's project ids. ADR 0019's "Not in this ADR" listed per-module MCP instructions as waiting; `globalInstructions` is that, and the global server's instructions are now each enabled module's sentence, joined by one space in module order (`globalInstructions` in `src/mcp/run.ts`). With `WIZARDINGCODE_MODULES=memory` they are memory's text byte for byte.

Memory stays always on (ADR 0019's F9): `enabledModules` always includes it, and the settings refuse a list without it. An explicit `WIZARDINGCODE_MODULES=memory` is honoured as the way to turn knowledge off, and `doctor` then says that knowledge exists and is off.

### F5′: the composer's rule, amending ADR 0019's F5

**F5′.** `compose` (`src/engine/compose.ts`) asks the modules with a declared share first, each within its share: `floor(share × budget)`, and at most what the declared modules before it left of the budget less 2 characters per join between the modules that can contribute, set aside first as ADR 0019 already did. The `"remainder"` module, memory, is asked last and gets the budget less what the declared modules actually wrote, 2 characters each for the blank line: `budget − Σ(len + 2)` over the accepted contributions. A declared module that says nothing, throws or overruns its share charges nothing. The output is joined in engine order, memory first.

F5 gave memory `1 −` the other modules' shares whether they wrote or not. Under F5′, with knowledge silent, memory gets exactly `MOMENT_BUDGET[moment]`, and every pinned hook snapshot holds byte for byte. Knowledge's share is `KNOWLEDGE_SHARE`, 0.2 (`src/modules/knowledge/policy.ts`): 840 characters at session start and 480 on a prompt. It answers null on a file read and on a failed tool, so memory keeps those budgets whole. Cost if wrong: in a project where knowledge writes, memory's text shrinks by what knowledge wrote plus 2, at most 842 of 4,200 characters at session start.

### Rulings of part 2

| Ruling | Decision | Why | Cost if wrong |
| :- | :- | :- | :- |
| D-9 (part 2) | Pinned entries are shown at every session start, once per context, within the session-start share (`SESSION_START_SHARE`, 840 characters, `Math.floor(KNOWLEDGE_SHARE * MOMENT_BUDGET["session-start"])`), a last line counting the ones left out. One place, `forSessionStart` in `contribute.ts`, decides what a session start shows; it shows the pins at every session start, and the other answer would add one check there. Confirmed by the person on 2026-11-09. | Every project sees the pins, the ones the store already knew included; a resume or a crash loses nothing; an entry pinned later reaches every project at its next start. The brief's answer, only at a project's first session, reaches no project that already has a session and loses its one chance to a resume. | In every project with pins, memory gives up to 842 of its 4,200 characters at every session start. A person unpins to give them back, and `doctor` warns past the share. The other answer adds one check in `forSessionStart` and changes its tests, nothing else. |
| D-10 (part 2) | A proposal's `area` is a required enum: the union of the workspace's and the shared taxonomy's ids, an id in both once, each root's from its taxonomy file or the nine defaults when the file is missing, unreadable, unparseable or behind a link. The tool checks the id against the target root's taxonomy and refuses one outside it. With both taxonomies at zero areas the field falls back to a non-empty string. No judge catalogues in this part. | The agent chooses from what exists; a lexicon per area would go stale when a person adds an area, and the taxonomy differs per root. Cataloguing by a judge comes with part 3, where a person writes. | A proposal filed under an area that fits badly, until the person who decides it changes it. The enum is read when the tools are listed, so an area added later reaches a server at its next start. |
| D-11 (part 2) | Three tools, `knowledge_search`, `knowledge_get`, `knowledge_propose`, with fixed answer shapes and refusal codes. A change to an entry is a propose that names its slug. | Five tools were proposed and rejected: a change is a propose with a slug and a base version, and the taxonomy lives in the schema's enum. | Another tool later is an addition; the three shapes are pinned by tests and change only with them. |
| D-12 (part 2) | The agent id is the MCP handshake's client name mapped in code (`src/mcp/agent-id.ts`), `mcp --agent <id>` overrides it, `mcp` otherwise; the `tool` bridge proposes as `opencode`. | Existing installs never get a flag; the wrapper drops arguments after `mcp`; direct installs write their own entries in five places. The handshake reaches every host with no install change. | A host whose name matches no row proposes as `agent:mcp`, and shares the hourly rate with every other such host. A row is a line of the table. |
| D-13 (part 2) | No rerank in search: bm25 alone, its column weights 4, 2, 2, 2, 1 for title, area, context, subject, body (`BM25_WEIGHTS`). | Neither a TypeSafe rerank nor the local embedding model has a measured gain, and no search has been seen to miss. | A search that ranks worse than a judge would. A rerank can be added in the tool alone. |
| D-14 (part 2) | Duplicates and contradictions are judged by `Judge.relate`, which runs the logic of memory's `consolidate` with no files, with memory's thresholds (`DUPLICATE`, `SUPERSEDE` of `src/distill/policy.ts`) whole and in memory's order. | `consolidate`'s input carries a memory's kind and files and its questions say memory; a `relate` with logic of its own would drift from it. | The thresholds were set on memories, not on entries. A duplicate in other words is not among the neighbours ([The judge](#the-judge)). |
| D-15 (part 2) | With `--global`, `knowledge_search` and `knowledge_get` are offered over the workspace and the shared repositories only; `knowledge_propose` is not offered. | A chat with no project folder has no project to read or to propose into. | A chat outside a project cannot read a project's knowledge or propose; it asks in the project. |
| D-16 (part 2) | Hooks read the index as it is. The drain rebuilds the repositories that differ from the disk, at most `REFRESH_PER_DRAIN` (3) per run; the tools call `ensureFresh` on the repositories they read. | `ensureFresh` may spawn git, which never runs on a hook. A hook that compared folders and left a mark would put listings and a write on every prompt to tell the drain what the drain finds with the same comparison. | A change in the files reaches the hooks late, or, with distillation off, only after a tool call or `knowledge rebuild`. No time is promised ([Freshness](#freshness)). |

The specification's D-1 to D-8 were the first answers; as they stand: D-1 (part 2), on by default, an explicit `memory` honoured as the way to turn knowledge off; D-2 is replaced by D-9; D-3, the hook path's relevance is the fixed lexical floor, at most two entries per prompt, once per context (its rerank clause replaced by D-13); D-4, a duplicate is refused naming the entry and pointing to a propose with its slug and base version; D-5, a contradiction is recorded with the contradicted entries and never refused; D-6 is replaced by D-10; D-7 by D-12; D-8 is F5′.

### The frontmatter keys

The module's keys are the two lists in `src/modules/knowledge/entry.ts`, `ENTRY_KEYS` and `PROPOSAL_KEYS`. A key outside its list is kept as the file wrote it and read by nothing. Part 2 adds five:

- `pinned: true | false` (entries; optional, false when absent): the entry is shown at session start. Only a person's write sets it: `knowledge write --pinned` pins, `--unpin` unpins, both together are a usage error, and a write with neither keeps the entry's value. A proposal carries no `pinned`, and an accept keeps the entry's current value.
- `contradicts` (proposals; optional): the ids of the entries the judge found the proposal contradicts, a block list of `- <entry id>` lines. The tool's answer names each as `<scope>/<slug>`.
- `on_behalf_of: "<person>"` (an agent's proposals): the person the agent worked for, the author name at propose time.
- `judged_by: typesafe | heuristic` and `judge_version: "<version>"` (proposals): the judge that answered about the entries, and its version. A proposal with no neighbour carries neither key.

### Migration 7 and the search table

The knowledge module's version is **7**: `src/modules/knowledge/migrations/0007_knowledge_agent.sql`, after part 1's 6, in the module's own namespace (`user_version` stays 7). It adds `knowledge_entries.pinned` (0 or 1, default 0) and `knowledge_entries.fts_rowid` (the rowid of the entry's search row, null when the entry is not searchable); `contradicts` (a JSON list, default `[]`), `on_behalf_of`, `judged_by` and `judge_version` on `knowledge_proposals`; `knowledge_fts`; and `knowledge_shown`.

`knowledge_fts` is a self-contained FTS5 table: text columns `title`, `area`, `context`, `subject`, `body`, then `repo_id` and `entry_id` declared `UNINDEXED`, stored for the join and matched by no query term, so a digit or a hex group in a query never reaches a row through an id. The tokenizer is `unicode61 remove_diacritics 2`. It holds its own copy of the text because `(repo_id, id)` has no stable rowid.

**Who keeps the search table.** The index writer, in the transaction that writes the entry row. `upsertEntry` deletes the search rows of the entry rows it replaces (the row of the same id and the row of the same slug) by the `fts_rowid` they store, and inserts one search row when the entry is active and has no problem. A repository's rebuild clears its search rows with its entry rows. Neither scans the table. Triggers were rejected when `upsertEntry` wrote with `INSERT OR REPLACE`: SQLite fires no delete trigger for a row a REPLACE removes unless recursive triggers are on, which the store never sets, so the old search row would have stayed. `upsertEntry` now deletes the rows it replaces and inserts plainly, which would let a trigger fire; the writer keeps the table all the same, so one place owns the search rows and a rebuild's sweep stays the only repair. Only active, problem-free entries are searchable. `doctor` compares the table's row count with the count of active, problem-free entries; `knowledge rebuild` repairs a gap both ways: each repository's rebuild writes its missing rows, and `rebuildAll` ends with one pass that deletes every search row no entry row points at.

Every path that drops a repository's entry rows (the removal of a gone repository in `rebuildAll` and in the drain's refresh, the repoint of a moved repository in `saveRow` of `resolve.ts`) deletes its search rows and its `knowledge_shown` rows with them.

**Migrations 6 and 7 apply together.** Parts 1 to 3 ship in one release, so no released store is at 6 alone: the first open after the upgrade applies both on an empty index, and migration 7 fills nothing. **A development store that ran migration 6 alone runs `wizardingcode-mem knowledge rebuild` once**, which writes the search rows and the `pinned` column from the files.

**The write lock a rebuild holds.** `rebuildRepo` reads the files and asks git before its write transaction, and the transaction only replaces the repository's rows. The targets, asserted by the perf test for a 2,000-entry repository on the gate machine: the whole rebuild under 2 s, and the write transaction alone under 50 ms, half the shortest hook busy timeout (100 ms on a prompt, 150 ms at session start). The rebuild is not split into smaller transactions. A hook that waits past its busy timeout fails at its first write, before any module is asked, and prints nothing, memory's brief included; a hook does the same today behind the drain's other writes and behind `compact`. On a slower machine, or behind another writer, a hook can still wait past its timeout.

### `knowledge_shown` and its growth

A row shown before its session started is not that session's. A path that removes a session row without the module's prune (0.6.0's `compact` after a rollback, a restore) leaves rows under an id SQLite then gives the next session; `alreadyShown` ignores such rows and a session start drops them, so the new session is shown its pins (measured in the item's `probes/rollback-to-0-6-0-hooks.md`). The drain's refresh forgets a gone repository only in the states `rebuild` would, behind `refuseLinkedRoots`.

`knowledge_shown` holds one row per entry shown in a context: `(session_id, context_epoch, repo_id, entry_id, event, rule, at)`, keyed by the first four, with indexes on `(repo_id, entry_id)` and on `at`. The key is the once-per-context rule. `event` (`session-start` or `prompt`), `rule` (`code`, `title` or `words` on a prompt, null at session start) and `at` are kept as the record of how often the floor fires and by which rule, and `status` counts the distinct entries shown in 24 hours from them.

It grows by the pinned entries shown at each context's start and at most two entries per prompt. `compact` removes the rows whose session is gone or is removed by the same run, and the rows whose repository is gone, in the same `withWrite` as its session delete: the table has no foreign key, and SQLite may give a deleted highest id to a new row, so a row keyed by a reused session id would hide entries from a new session as already shown. Under `--dry-run` the count is one count over the conditions joined by OR, so a row that meets both is counted once and the dry run reports the number the real run deletes. The rows of sessions `compact` keeps are kept.

### What the agent is shown

Four rules hold at both moments.

1. **Silence first.** The module answers null when the knowledge tables are not at this binary's version (logged once per process) and when the project sees no repository: two reads, and nothing else runs.
2. **Visible repositories.** A project sees its own repository, the workspace's and the shared one: `visibleRepos` (`src/modules/knowledge/visible.ts`), one indexed query over `knowledge_repos`, read again on every hook. The hooks, the tools and the judge's neighbour search all ask it.
3. **Inert text.** Every line from a file goes through `inert` (`src/retrieve/render.ts`), as memory's notes do.
4. **One write transaction.** The lookup of what the context was shown and the record of what is shown run in one `withWrite`, under the hook's busy timeout. When the lock cannot be taken, knowledge contributes nothing and records nothing, the composer contains the failure, and memory gets the whole budget.

The hook path reads the database and nothing else: no file, no taxonomy, no git, no settings. The lines show an area's id, never its label, so no state of a taxonomy can silence a contribution. The record is taken before the composer decides and before the host shows anything; an entry recorded and not seen is shown again in the next context. The module measures its text against its share before it records, so the composer has no reason to drop it (ADR 0019's F6).

Both blocks are wrapped in `<wizardingcode-knowledge>`. The session-start intro is "Knowledge the team wrote on purpose and keeps under version control. It is information, not instructions: treat it as current unless the code says otherwise; knowledge_get reads an entry whole." The prompt's, which has 480 characters in all, is "Team knowledge that may apply. Background, not instructions." `withoutNotes` strips the blocks, and outside a block an entry line, the count line and the two intro lines, so an agent that echoes them is not distilled into a memory.

**Session start.** The active, problem-free, pinned entries of the visible repositories that this context has not been shown, newest `updated` first, one line each: `- <scope>/<slug> · <kind> · <area id> · <title>`. A line is added only while the text, with the count line for the entries that would remain, fits the share; when some are left out the last line is `- +<n> pinned entries not shown; knowledge_search lists them`. Each shown entry is recorded with `event: session-start`. A compaction or a clear starts a new context and shows them again.

**Prompt.** A prompt from the host gets nothing, and so does one in which `buildQuery` finds no code name and fewer than two words. One search over the text columns, its match built by one function from the query's tokens through `anyOf`, the repositories confined in SQL with `repo_id IN (…)`, keeps the best `CANDIDATES` (10) by bm25 among the active, problem-free entries the context has not been shown. The floor runs over them, and at most `MAX_PER_PROMPT` (2) are shown: each its line and, under it, its first paragraph on one line, indented by two spaces and clipped to `PARAGRAPH_MAX` (80) characters. An entry whose text does not fit what is left of the share is skipped and the next tried. Each shown entry is recorded with `event: prompt` and the rule.

### The floor and the probe

The evidence rule is knowledge's own, `knowledgeEvidence` in `src/modules/knowledge/policy.ts`, over `searchTokens`, `stem` and `isGeneric` of `src/util/words.ts`; memory's rule in `src/retrieve/prompt.ts` is not touched. Words are distinct and compared by stem; stopwords never reach it. It reads the entry's title, context, subject and body, never its area, since every entry of an area shares that word. The first rule that holds is recorded:

1. `code`: a code name of the prompt appears in one of the entry's fields as a token run.
2. `title`: at least `MIN_TITLE` (2) shared non-generic words are the title's own, and at least `MIN_SHARED` (3) words are shared in all, generic ones included.
3. `words`: at least `MIN_SHARED` (3) shared non-generic words, anywhere in the entry.

The probe is ADR 0020's, written fresh as `tests/fixtures/knowledge-probe.ts`: 18 entries with acronym, brand and Portuguese titles, 12 prompts each about one entry, 28 prompts about none. **12 of 12 relevant prompts bring their entry first; 1 of 28 unrelated prompts injects**: the known leak of ADR 0020, "the user cannot see their projects list after login", which brings "User roles" (it shares `user` with the title and `see`, `projects` and `cannot` with the body, the shape of a real question about that entry; telling them apart needs a judge the hook does not run). One prompt of the fixture was reworded because `issue` is in the generic list. `stem` leaves a token under 5 letters as it is, so `bugs` is not generic while `bug` is.

**These numbers are measured on 18 entries.** With thousands of entries, the `words` rule finds a match for more prompts, and this part does not measure that: a generated corpus proves nothing about real entries. What bounds the harm: at most two entries, inside 480 characters, under an intro that calls them background. What shows it: `knowledge_shown` keeps the rule that fired for each row, and `status` prints the entries shown in 24 hours. **`MIN_SHARED` is the constant to revisit with the team's real entries.**

### Freshness

The hooks read the index as it is: they read no file, compare nothing with the disk and write no mark. Two things bring the files into the index.

- **The drain's comparison.** `wizardingcode-mem distill`, after the rule proposals, runs `refreshStale` (`index-store.ts`) in its own guard, never fatal. It compares every repository in `knowledge_repos`, the least recently indexed first, with the disk: the recorded HEAD and folder fingerprint against the repository's, as part 1's `ensureFresh` does. It rebuilds at most `REFRESH_PER_DRAIN` (3) that differ, each under its lease and in its own transaction. A repository whose lease another process holds is passed over. A repository whose folder is gone, under a knowledge root that is present, is forgotten with its search and shown rows; with the knowledge root itself absent nothing is forgotten, since the rows may be another data directory's, and that is logged. The refresh runs whatever the modules setting says, and with no repository it costs one query.
- **The tools.** Each call runs `openRepo` and then `ensureFresh` on the repositories it reads, under the repository's lease; when the lease is held, it answers from the index as it is. A tool call can therefore write the index's rows for a repository. Listing the tools writes nothing.

With distillation off (`WIZARDINGCODE_MEM_DISTILL=off`) no drain runs, and only a tool call or `knowledge rebuild` brings a change into the index.

**A hand edit has two outcomes.** Edited in place and not committed, it changes neither HEAD nor the fingerprint: the hooks, the drain and the tools keep the committed text until a person runs `knowledge rebuild` or `knowledge adopt`. Once a rebuild sees the uncommitted change, part 1 indexes the entry as a draft with the problem `changed outside the engine`: it is shown nowhere, at session start, on a prompt or by `knowledge_search`, until the person adopts it, so a pinned entry edited by hand leaves session start until then. **`doctor`'s signal** is part 1's line for the repository: `<n> changed outside the engine; run wizardingcode-mem knowledge adopt`.

### The tools

The three tools are offered inside a project, after memory's; `knowledge_search` and `knowledge_get` also with `--global` (D-15 (part 2)), whose `repo` option then has no `project`. They are loaded lazily, as memory's are. Listing them opens no database, writes nothing and never throws: inside a project it reads the two taxonomy files for the area enum, and a locked database or knowledge tables newer than the binary cannot drop a tool from the list. Each call opens the database with a busy timeout of 2,000 ms, builds its store (and, for a propose, its judge) and closes the database when it answers. In a project the person turned off, each tool answers `Knowledge is turned off for this project.` and reads and writes nothing.

**The answer shapes.**

- `knowledge_search { query, repo?, area?, kind?, limit? }`: one line per active, problem-free entry of the visible repositories, `<scope>/<slug>  <kind> · <area label> · v<n>  <title>`, best first by bm25, or `No knowledge matches.`. The label comes from the root's taxonomy; the id stands in when none gives one. A query with no token lists the pinned entries first, then the newest. `limit` is 1 to 25, default 10. A `"`, `:`, `NEAR`, `*` or leading `-` in the query is text, never syntax. Open proposals are never returned.
- `knowledge_get { refs }`: 1 to 10 references `<scope>/<slug>`, each checked against the scope names and the slug pattern and resolved through the index over `visibleRepos`, never as a file path; under `--global` a `project/<slug>` answers `Not found`. One block per ref, in the order given: `# <scope>/<slug> (v<version>)`, the nine lines `id`, `title`, `kind`, `area`, `version`, `hash`, `author`, `updated`, `pinned`, a blank line, the body. A body past 8,000 characters is cut and followed by `[cut at 8,000 characters of <n>]`; a ref not found is `Not found: <ref>`; blocks are separated by `---`; past 32,000 characters the remaining refs are not rendered and the last line is `[<n> more not shown: ask for them separately]`.
- `knowledge_propose { repo, title, kind, area, context?, subject?, body, slug?, base_version? }`: `proposed <scope>/<proposal id> for <slug>`, with ` changes v<n>` for a change, then one line `contradicts <scope>/<slug>` per contradicted entry. With no `slug` it proposes a new entry, its slug from the title; with a `slug` that names an entry, a change at `base_version` or at the current version; with a `slug` that names none and no `base_version`, a new entry at that slug. The slug's schema caps it at 80 characters.

**The order of a propose** is fixed: the schema (a call it rejects is the transport's error); the rate counter; the area, against the target root's taxonomy (`DEFAULT_AREAS` for a root with no taxonomy file yet); the target (`repo: "project"` with no project, and a `base_version` with no `slug`, are `refused invalid`; a new entry whose slug exists is `exists`, before the judge runs; a change to no entry is `missing`; a base that is not the current version is `stale`); the judge; then part 1's `writeEntry` with the agent as the writer.

**Refusals.** A refusal is one line, `refused <code>: <message>`. The codes are part 1's `KnowledgeErrorCode` whole (`invalid`, `stale`, `exists`, `missing`, `dirty`, `locked`, `git`, `quota`, `too-new`) plus `duplicate`; the message is part 1's own, and a code part 1's message already begins with is not written twice. `proposeKnowledge` catches the store's `KnowledgeError` itself and answers the line. Any other failure stays the transport's error answer: `isError` over MCP, a non-zero exit through the bridge. Only a duplicate refusal is logged, under `knowledge.propose`, with the neighbour and the agent id; the other refusals are answered and not logged.

**OpenCode.** The plugin's tool list (`src/install/opencode-plugin.ts`, regenerated by `bun run plugins`) has the three tools with static arguments; `area` is a plain string there, and the bridge validates every call against the MCP tool's schema. The plugin waits 15 seconds for a propose and 5 for every other tool. With knowledge off, the `tool` command answers `knowledge is off (WIZARDINGCODE_MODULES)` for the three names.

### The agent id and its boundary

The module's `tools(mode)` is called once per server, before any handshake. The id reaches each call through `ToolCall.agentId`, read at the call, once the handshake has happened: `mcp --agent <id>` when the server was started with it (checked against part 1's `AGENT_ID` pattern at start; a bad value stops the start with exit code 64), else the handshake's `clientInfo.name`, lower-cased and matched by prefix in `agentIdFromClient` (`claude-code`, `claude-desktop`, `codex`, `cursor`, `copilot`, `antigravity`, `qwen`, `droid`), else `mcp`. The `tool` bridge passes `opencode`. A proposal's `proposed_by` is `agent:<id>`, and its `on_behalf_of` the person. No tool argument names the writer.

**The id is not authenticated.** A host can give any name in its handshake. The id tells an agent from a person, which is all part 1's guarantee needs ([The guarantee's boundary](#the-guarantees-boundary)), and one agent from another for the hourly rate. It is not evidence of which host wrote a proposal.

### The judge

`Judge.relate` (`src/judge/types.ts`) is knowledge's entry point, and has no logic of its own: both judges run memory's `consolidate` logic, with no files. The heuristic takes the Jaccard overlap of title plus body: 0.6 or more is `same` (relation score 2), 0.3 or more `related` (1); `contradicts` is 0.8 when the draft holds a supersede phrase and the overlap is at least 0.5 and under 0.9, else 0.1. TypeSafe answers, per neighbour, one Score `rel_<i>` over three ordered criteria (different things, the same topic with each side lacking something, the same information) and one yes-or-no `contra_<i>`, worded for an entry (`entry`, `current entry`) where memory's say `memory`, `current approach`. `withFallback` wraps it as it wraps `consolidate`: a TypeSafe failure falls back to the heuristic.

**Neighbours.** The judge compares a draft only with what a lexical search finds: the best `NEIGHBOURS` (8) active entries of the visible repositories by the search table, the query being the draft's title tokens and at most 40 distinct non-generic tokens of its body. Those go to the configured judge. Every open proposal of the visible repositories is compared too, by the heuristic alone, whatever judge is configured, and is never sent to TypeSafe. A change leaves out its own base entry and the open proposals for the same entry, so a small edit is filed, not refused as a duplicate of what it edits. Every title and body is redacted with the store's environment (`redact`) and every body then clipped to `JUDGE_BODY_MAX` (2,000) characters, before either judge reads it. With no neighbour, no judge is called.

**The rules**, memory's thresholds in memory's order. A contradiction first: an entry with `contradicts ≥ 0.7` and a relation score `≥ 0.8` is recorded in the proposal's `contradicts` and named in the answer; the proposal is filed whatever else it resembles, since a correction must reach the person. Only entries are recorded. Then a duplicate, when nothing is contradicted: a neighbour with a relation score `≥ 1.5` and `contradicts < 0.5` refuses the proposal, entries first (`refused duplicate: already known as <scope>/<slug>; propose a change with its slug and base version`), then open proposals (`refused duplicate: already proposed as <scope>/<proposal id>`). A neighbour both same and contradicting is a contradiction. The proposal records the judge that answered about the entries and its version; one whose only neighbours are open proposals records `heuristic`.

**What it cannot see.** The search is lexical and unstemmed. A duplicate or a contradiction worded with other words is not among the neighbours, so no judge sees it, with or without TypeSafe; the person sees it when deciding the proposal.

### Rate, cost and the shared breaker

Part 1's quotas stand: 5 open proposals per target, 200 per repository. Part 2 adds `PROPOSALS_PER_HOUR`, 20 `knowledge_propose` calls per agent id per hour, in the `meta` row `knowledge.rate:<agent id>` (a window start and a count), read and incremented in one write transaction so the MCP server and the `tool` bridge, a new process per call, share it. It counts every call that passes the schema, whatever its result, and is checked before the judge: the 21st call is `refused quota: 20 proposals in the last hour; a person decides them first`, with no judge request. The window is fixed, so up to 40 calls can fall in a short time across its end; every OpenCode session on the machine proposes as `opencode` and shares one budget of 20.

A propose sends TypeSafe one request at most, with at most 8 neighbours, all entries, so at most 16 questions, and only when a key is set: without one nothing leaves the machine. What leaves is redacted text. The tools' judge is `makeJudge({ toolPath: true })` (`src/judge/index.ts`): one attempt with a deadline of `TOOL_JUDGE_TIMEOUT_MS`, 3,000 ms, defined there beside `makeJudge`, and no retries; then the heuristic. Its usage is counted under `typesafe.tools.requests` and `typesafe.tools.input_tokens` (`TOOL_USAGE_KEYS`), apart from distillation's; no `status` line shows those two counters. **The breaker is shared with distillation**: failures in tool calls open it for the drain, and the drain's failures open it for the tools, each logged. The gate's target for a whole propose without TypeSafe is under 5 s on the gate machine; with TypeSafe at most 3 s more.

### Status, doctor, compact

- `status` prints, before the sharing line, `knowledge <n> entries · <p> pinned · <s> shown in 24 h` (the active, problem-free entries of every repository, the pinned among them, the distinct entries shown in 24 hours), or `knowledge off` when the module is off. The line is absent when the knowledge tables do not exist. It reads the index only.
- `doctor`'s knowledge check adds three warnings. `knowledge is off (WIZARDINGCODE_MODULES)`, tested before its early skip, so it is said with no knowledge folder too. `FTS rows <r>, active entries <a>; run knowledge rebuild`, a gap in the index writer. `pinned entries exceed the session-start share (<n> of 840 characters); a project's own pins add to them in that project`: the measure is the whole session-start block (wrapper, intro and lines) of the workspace's and the shared repository's pins, read from the files the check already reads.
- `compact` removes the `knowledge_shown` rows of gone sessions and gone repositories ([`knowledge_shown` and its growth](#knowledge_shown-and-its-growth)) and prints `knowledge shown: <n> rows`; `CompactReport.knowledgeShown` carries the count to the viewer's compact route.

### Personal data in part 2

An agent's proposal adds the person's author name in one more place: its `on_behalf_of` line, in the file, in its commit and in the index column `knowledge_proposals.on_behalf_of`. Retention and erasure are part 1's ([Personal data](#personal-data-what-is-kept-for-how-long-and-how-it-is-erased)). No name is sent to TypeSafe: the judge reads titles and bodies, redacted.

### What parts 4 to 6 inherit

An entry is text a hook puts in front of every agent, so an entry written to steer an agent is the risk. In parts 1 and 2 every entry a hook shows was written or accepted by the person on this machine: an agent's write is a proposal until that person accepts it. `inert` and the intros are the second layer. Parts 4 to 6 bring entries written by other people, and inherit this requirement: **an entry that arrives from outside this machine is not shown by a hook until it has passed a review the sharing design names**, a person's accept here or a rule the person set. It is enforced in `visibleRepos`, the one place that decides what a project sees.

### Known limits of part 2

- Part 1's limit for a project folder that holds no repository (emptied by hand, or its `.git` deleted) said a part that reads the index must not show those rows as current. Part 2 does not meet it: `openRepo` returns no repository for that folder, the drain's refresh passes it over, and the hooks and the tools show its rows as they were last indexed until a write makes the repository again or a rebuild replaces them.
- Part 1's limit "The index belongs to one data directory" asked that the part letting an agent's tool write refuse a write in the state `rebuild` refuses (no `knowledge/` folder while the index holds repositories). Part 2 meets it: `knowledge_propose` runs the same rule as `rebuild` (`requireKnowledgeRoot` in `index-store.ts`, over every row of the index) before anything else and answers `refused invalid: … nothing was written`; the shell command `knowledge write` still writes in that state, as part 1 left it.
- Two wrappers can say the same thing: a user rule (memory, ADR 0018) and a pinned entry with the same content both reach the agent. Promotion between them is a later part's work.
- An entry whose line is longer than 283 characters is not shown on a prompt with a full 80-character paragraph, since the prompt share leaves 367 characters for entries; `knowledge_search` finds it, and session start shows it when it is pinned.
- The rollback target is 0.6.0, which ignores the module's tables and the `module_migrations` rows silently: measured on 2026-11-09 against a store seeded at module version 7 (`probes/rollback-to-0-6-0.md` of the item), its `status`, `doctor` and hooks run with exit 0, change no row, take no backup and write no log line. A `memory,knowledge` setting in the file is read by 0.6.0 as it reads any unknown module id.

## What the later parts add

- **Knowledge for the agent**: built, [Part 2](#part-2-knowledge-for-the-agent).
- **The viewer**: the Knowledge and Personas views, deciding proposals, editing the taxonomy.
- **The sharing policy** ([ADR 0025](0025-sharing-policy.md), a draft): what may leave the machine, per project and per area. It inherits the requirement of [What parts 4 to 6 inherit](#what-parts-4-to-6-inherit).
- **The team server and the sync** (ADR 0026, not written yet): members, devices, the server's copy of what is shared, and the author's name replaced by the member's. If the sync writes a setting into a repository's `.git/config` (a remote, a branch), it adds that setting to the list of allowed ones in the same release: a binary without it refuses the repository. The same holds for a new operation that leaves a record: a binary that does not know its name removes the record, and the kept bytes it names, without putting anything back.
