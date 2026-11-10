# Conclave: the knowledge store

Checklist read: `migration-or-restore` (the change adds module-owned tables through a new migration namespace). The change is not an endpoint, a login, a payment, an upload, a sync with a third party, a redirect, a deletion, a merge or a screen.

## Assumed by good practice

- Writes to one repository are serialised by the engine's lease; a loser is refused with a message that says to retry, never queued (AC-8).
- Every git call runs isolated from the person's configuration (no hooks, templates, signing, includes), with an explicit git directory and work tree and a ceiling directory, so a data directory inside a parent repository is never committed into (AC-2).
- A failed git call after the file was renamed restores the path from HEAD, and the write is refused with git's message (AC-4).
- Reads cap the file size (256 KiB) and the file count (5,000), open regular files only, never follow a symlink; writes refuse a symlinked target; the knowledge folders are created with mode 0700; every refused git call is logged under a `knowledge.*` scope with the repository path and git's stderr clipped; nothing leaves the machine (AC-13).
- The module's tables are created whether the module is on or not, after the core migrations, under their own write lock, with a backup first when a module already had a version; the core schema version does not move, so 0.6.0 still opens the database (AC-3; the checklist's "reversible, or the reason written in the spec": the spec's Risks and rollback says what a rollback leaves and that no down migration exists).
- `wizardingcode-mem backup` keeps copying the database only; the repositories are the truth and the ADR and the README say they are not in that backup (AC-12).
- A database restored from a backup brings an older index; the head and fingerprint comparison rebuilds it from the files before a read (the checklist's "a restore re-creates the schema; it brings back data only where a backup exists": the files are the data, and they were never in the database).

## Decisions only the user can make

Recorded on the item with their conservative defaults; where nobody watches, the validator applies the stated default under `stated-default`:

- D-1: where a project's repository lives (default: the data directory).
- D-2: how every change is versioned (default: a git repository per scope, one commit per write).
- D-3: what an agent's proposal is (default: a file in the repository, committed by the agent).
- D-4: the file layout (default: flat `entries/<slug>.md`).
- D-5: statuses and deletion (default: active, draft, archived; no deletion).
- D-6: the taxonomy file (default: `taxonomy.md`, the same format as entries).
- D-7: the person's author name (default: the setting, then the global git name, then `you`).
- D-8: an entry's identity (default: an immutable id; the version a counter beside a content hash).
- D-9: the taxonomy across repositories (default: immutable ids with labels, a taxonomy per root repository).
- D-10: a decided proposal (default: moved to `proposals/decided/`, never deleted).
- D-11: a hand edit on a write's target (default: refused, with `knowledge adopt` as the way out).

## Proposals

- Include the repositories in `wizardingcode-mem backup` (a tarball of `<data dir>/knowledge/` beside the database copy): a later item, once the sharing policy says which repositories may leave the machine.
- A `knowledge export <folder>` that writes the entries as plain Markdown for an editor such as Obsidian: a later item.
- A `knowledge doctor --fix` that removes a stale `.git/index.lock` after confirming no git process holds it: a later item; this part names it.

## Warnings

- Migration 6 begins by dropping the withdrawn module's tables and its two indexes on `injections` where a store still holds them (ADR 0020, versions 1 to 5 of the module id `knowledge`). On such a store the old index of project-folder knowledge is lost; the new module does not read those folders. The module never shipped, so only a development store can hold them, and the migration pass takes a backup first when a module already had a version. Recorded as an advisory objection.
