mode: brainstorm

# structural findings for 2026-11-11-005-share-a-project-without-a-git-remote
reviewer: goldfish-structural
read: probes/concept.md; src/sharing/levels.ts; src/core/project.ts; src/modules/knowledge/resolve.ts (strong, aliasRank, matchProject, resolveRepo); grep of isHostLedAlias/remoteAlias/remote_alias/`remote:` across src (143 hits in 21 files); spot reads of src/team/contract.ts, src/sync/naming.ts, src/ui/api.ts, src/team/mirror.ts, src/sync/received.ts, src/modules/knowledge/index-store.ts. The three ADRs were named but I did not read them; my findings rest on the code.

## Findings (lens: long-term debt and maintenance)

- F-1 · Blocker · concept §10 / resolve.ts `strong` · A strong alias has to name one project for good. `resolveProject` keeps this rule for `remote:` ("A remote names one project for good", project.ts line 130). A `team:` name breaks it, because §2 and §3 let it be renamed. After a rename, the old `team:x` stays in the folder's manifest: `openRepo` adds aliases the project gains, and nothing I read removes the ones it loses. Once x is released, another local project can take it. `matchProject` then finds A's folder by a strong alias B owns, and either claims it or reports it as claimed. Either adding `team:` to `strong` makes names permanent locally (never released, never reused), or `team:` stays weak and §10's promise of finding the folder again after a rebuild is dropped. The concept cannot have both mutable names and strong names.

- F-2 · Major · §1, "the eight places" · Changing the predicate does not cover every place that assumes `remote:`. Some sites filter by text before any predicate runs, and the concept does not list them:
  - `src/ui/api.ts` line 92 filters with `WHERE alias LIKE 'remote:%'` before `isHostLedAlias`. A team-named project would never reach `isTeamAlias`.
  - `src/team/contract.ts` line 188 runs `alias.replace(/^remote:/, "")` to build `repoFolder`. §4 notes this one, but only as prose.
  - `resolve.ts` handles `byRemote`, `aliasRank` (`team:` falls through to last) and the folder name at line 258 (`remote ?? project.key`).
  - `src/sync/conflicts.ts` `projectByAlias` and the `index-store.ts` join `l.bound_alias = x.remote_alias` are outside the list.
  
  An implementer who follows the list ships a dock that never shows the field. This is the debt the column name creates: every one of these 143 sites reads "remote".

- F-3 · Major · §3 vs `resolveProject` · The concept forbids two identities only at `setLevel` time. The disk can still create them. Say a project is named `team:wizardingcode`, and then `git init` and `git remote add` run in that folder. `resolveProject` adds `remote:…` to the same project, as its docstring intends ("a project that gains a remote … stays one project"). The level stays bound to `team:` and `effectiveLevel` still reads it as allowed. The next time Nothing and then a level are set, `aliasToBind` picks the remote first. The identity changes silently: every item is withdrawn under the old name and comes back as new uids under the remote, and teammates bound to the name stop receiving. The ordering rule needs to be "the bound alias wins while bound", stated once. The dock also needs a state for "named, now has a remote".

- F-4 · Major · placement of the rule · There are three separate questions, and the concept answers them in two places:
  1. Can a team match this alias? Today `isHostLedAlias` in sharing/levels.ts.
  2. Does it tie a manifest? `strong` in resolve.ts.
  3. Does it name one project for good? The inline `alias === remoteAlias` in project.ts.
  
  The server's `contract.ts` already imports `sharing/levels.ts`, a client policy module, to get a grammar. Put one leaf module, `src/core/identity.ts`, with no imports: a table of alias kinds (`remote`, `team`, `gitdir`, `path`, `imported`), each with three flags: `travels`, `strong`, `permanent`. Add `aliasKind(alias)`, and one exported function `teamIdentityOf(aliases, bound?): string | null`, which returns the one alias that leaves. A workspace id, an organisation or `imported:` then becomes a new row in the table, not another pass over 21 files. `isHostLedAlias` stays a detail of the `remote` row.

- F-5 · Major · §4, columns and payload key · Keeping the pinned wire key `remoteAlias` is defensible for 0.7.0 clients. Keeping the columns named `remote_alias` is not. SQLite's `ALTER TABLE … RENAME COLUMN` is one statement per table. The cost is small now, and it grows with every reader added before the third identity form, when the rename becomes unavoidable. Rename the server's four columns and the client's `knowledge_received.remote_alias` to `project_alias` now. Keep `remoteAlias` only at the JSON boundary, documented in contract.ts as "the project's team alias, any form".

- F-6 · Major · `project_aliases` gaining a second writer · Until now every row in the table came from the disk, so the table was a cache of what the folders say. `setLevel` writing `team:` makes it partly user data. Rebuild, import, `disabled` handling and any later "forget project" have to know which rows they must never drop. Give the row a source: a column, or a separate `project_names` table keyed by project with `UNIQUE(name)`. A separate table also enforces "at most one team name" in the schema, not in code.

- F-7 · Major · the cleaner shape · Having the server mint a project id, with names as labels, would make rename a label change. It would avoid F-1 and F-3 and keep uids stable. It costs a server round trip at `setLevel` (offline sharing goes), a remote→id mapping for remote-named projects, and a contract bump. This is not worth doing in this item. Take the cheap part now: a server-side `names` table (name, first sender, created_at). It answers Q1 and is the seed of a minted id later. Also reserve room in the grammar for a qualifier, e.g. `team:<slug>` now and `team:<org>/<slug>` later, so an organisation is not a breaking change.

- F-8 · Nit · §1 slug · NFKD plus removing marks maps non-Latin names to an empty slug. The concept needs to say what happens then; the project-name default can be empty.

## The four questions, where this lens bears
- Two members both picking `docs`: listing names with their counts is not enough. Split create from join in the input: `as` creates a name, `join` binds to one picked from the list. The server refuses `as` on a name that already exists (needs F-7's names table). This is cheap now and a contract change later.
- Binding a folder to a picked `remote:` alias: this is not the same feature, and it is dangerous. It would make `setLevel` a writer of `remote:`, the one kind `resolveProject` treats as permanent and from the disk. A later real clone of that remote would quietly become the bound project (`INSERT OR IGNORE`, then lookup by remote). Keep it out, or handle it as a `team:`-style label pointing at a remote, never as a `remote:` row.
- Rename (Nothing first): this is right without minted ids. Moving items produces new uids plus tombstones on every member's machine. But the rule only holds if F-1 is settled: either released names are never reused locally, or `team:` is not strong.
- Imported memories: a separate item. D-19 is about where a memory came from, not about project identity. `imported:` belongs in F-4's table as a non-travelling kind, so the later item has one row to change.

## Not answerable
- ADR 0025/0026/0027 text · not read; my claims about D-16, D-19 and D-11 rest on the concept's quotes.
- Whether `openRepo` removes aliases from a manifest that the project has lost · not read; F-1 assumes it only adds them, as resolve.ts line 220 describes.
- Whether `/v1/health` returns `version` · not checked.
