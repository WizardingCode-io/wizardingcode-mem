# Concept: share a project without a git remote

Mode: brainstorm. The hypothesis the lenses attack.

## The problem

A team server (ADR 0026) and its sync (ADR 0027) share a project's knowledge entries and memories between the members' machines. Two machines land on the same project by one name: the project's git remote on a host, as the alias `remote:<host>/<path>` (ADR 0025, D-16; ADR 0026, "The alias"; ADR 0027, D-9). A project without such a remote cannot be set above Nothing: `setLevel` refuses `no-remote` (`src/sharing/store.ts`), the dock disables the levels and says "This project has no git remote. A team can only match projects by their remote" (`ui/src/components/ProjectsView.vue`), and ADR 0025 lists it as a known limit "until part 5 has another identity for it". Part 5 did not.

The author's own machine, read on 2026-11-11: 158 projects, 149 of them without a `remote:` alias. Most are `imported:<name>` projects from the claude-mem import; the one the author named, `wizardingcode` at `~/Projects/wizardingcode`, has a `path:` alias only (not a git repository), 61 active memories, and holds the work done in Claude Desktop and Cowork: skills, strategies, brand systems. The author's requirement, in their words: "não é preciso um remote host, tem que deixar partilhar mesmo sem remote host … tudo é partilhado". A second fact of the same read: of the machine's active memories, most are `imported`, and ADR 0025 D-19 keeps imported memories off the wire ("Imported memories stay") whatever the level; the wizardingcode project's own split is in the brief.

## The hypothesis

A project is shared under a **team name**. The name is an alias of the project, `team:<name>`, beside the remote aliases; the server accepts it wherever it accepts `remote:<host>/<path>`; a member on another machine binds a project of theirs to the same name and receives the team's copy.

1. **The name.** `<name>` is a slug: lower-case ASCII letters, digits and single hyphens, 1 to 63 characters, made from the text the person types by NFKD and the removal of marks (`Estratégia de marca` becomes `estrategia-de-marca`), the project's own name by default. One grammar, in `src/sharing/levels.ts` beside `isHostLedAlias`: `isTeamName(alias)` for `team:<slug>`, and `isTeamAlias(alias)` for "a name a team knows a project by", true of a host-led remote alias or a team name. The eight places that today ask `isHostLedAlias` to mean "a team can match it" ask `isTeamAlias` instead: `effectiveLevel` and `setLevel` (sharing), `entryAliases` in `report.ts`, `listProjects` in `src/ui/api.ts`, the entry uid grammar and `parseEntryUid` in `src/team/contract.ts`, the memory payload check in `src/team/validate.ts`, `parsePullQuery` in `src/team/feed.ts`, and `receivedFolder` in `src/sync/naming.ts`. `isHostLedAlias` stays for what is a remote and nothing else.

2. **How a project gets the name.** Never from the disk: `resolveProject` (`src/core/project.ts`) keeps producing `remote:`, `gitdir:` and `path:` aliases and nothing else. The name is written by `setLevel`, which gains the input `as: <name>`: inside its write transaction, after `disabled` and before the widening, it records `team:<slug>` in `project_aliases` for the project (`INSERT`, refused as `name-taken` when the alias is another local project's, since the table's primary key is the alias and two local projects under one team name would be one project to the server) and binds the level to it. A project carries at most one team name; a second `as` with a different name while a level is bound is refused (`renamed`: set Nothing first, which withdraws what was sent under the old name, then set the level under the new one). Setting Nothing keeps the alias row: the name is the project's until the person gives another, so a later level needs no new question.

3. **Which alias the level binds to.** `aliasToBind` reads the candidates in order: the host-led remotes, then the team name. A project with a remote binds by its remote, as today, byte for byte; `as` on such a project is refused (`has-remote`: "this project is matched by its git remote"), so a real project has one identity on the server, never two. A project with no remote binds by the name given now, else by the name it already carries; with neither, `no-remote` becomes `no-name`: "this project has no git remote; give it a team name".

4. **The server.** The uid grammar becomes `project:(remote:<…>|team:<slug>):<uuid>`; the `remote_alias` columns of `entries`, `entry_revisions`, `memories` and `changes` keep their names and hold either form (a rename of four columns is a migration with nothing to show for it; ADR 0026 says so). The payload key `remoteAlias` keeps its name for the same reason: it is a pinned key of the contract and 0.7.0 clients send it. The mirror's folder (`repoFolder`) strips `remote:` or `team:` before the slug: `repos/projects/wizardingcode-<8 hex of the alias>`. The pull's `projects=` accepts both forms. Additive: a 0.7.0 client never names a team alias, so it never receives one (project items arrive only for the aliases a pull names, ADR 0026 D-11), and the shared and workspace scopes are untouched; no contract bump.

5. **An older server.** A 0.8 client against a 0.7.0 server gets 400 `projects` on a pull that names a team alias, and `shape` on a push of an item under one. The sync reads the server's version from `/v1/health` (it answers `version` today; to confirm) and, below the first version that knows team names, keeps the team aliases out of the pull and the items under them out of the push, and `status`, `doctor` and the Servers page say "the server is 0.7.0; team names need 0.8".

6. **Picking from the names the server knows.** New `GET /v1/projects` (any member): the distinct project aliases with a current item on the server, each with the counts of entries and memories, the number of members who sent under it, and the last change's time; built from `changes` where `current = 1`, with the index `changes_scope`. Remote-named projects are listed too, marked by their form. The viewer proxies it as `GET /api/servers/<id>/projects`, asked when the dock's name field opens, never on a hook; the CLI gains `share projects [--server <id>]`, read-only.

7. **The viewer.** The dock's Sharing section, for a project without a remote: a "Team name" field (a combobox: type, or pick a name the server knows, each shown with its counts) prefilled with the slug of the project's name, and the levels enabled; the sentence about the remote goes. Once bound: "Known to the team as `wizardingcode`." and the field read-only, with the rule in one sentence (set Nothing to rename). A remote-named project's section is unchanged. `PUT /api/projects/<id>/sharing` takes `as`. The refusals `name-taken`, `renamed` and `no-name` have their sentences.

8. **The CLI.** `share project <level> [--as <name>] [--server <id>] [--yes]`; `--as` on a remote project refuses with `has-remote`; `share status` and `status`'s sharing line show the bound name; `share explain` names the alias as it does a remote.

9. **The other machine.** A member types or picks `wizardingcode` on a project of theirs (any folder; a remote of their own is no obstacle if that project has none that is host-led): the alias is recorded, the next pull names it, the entries land under `knowledge/received/<serverId>/projects/wizardingcode-<8 hex>/`, `projectIdOf` maps them to the member's project, and their sessions in that project read them as they read any received entry; received memories become `imported` rows of that project with judge `team:<serverId>`, as today.

10. **The knowledge repository.** `src/modules/knowledge/resolve.ts` counts `remote:` and `gitdir:` as the strong aliases a manifest ties a folder by; `team:` joins them, so a project with a path alias alone, once named, finds its folder again after a rebuild by its manifest and not by its row only (the limit ADR 0024 and ADR 0025 record).

11. **Documents.** ADR 0025 (Identity of a project, the known limit, D-16 and D-19 amended: what leaves names the project's team alias, remote or name; `path:` and `gitdir:` still never leave), ADR 0026 (The alias, the new route), ADR 0027 (what a pull names), the README's sentence "A project needs a git remote on a host … to be set above Nothing", the runbook's mirror section, CLAUDE.md. A new ADR records the rulings of this item.

## What stays as it is

- The levels, the roots, the areas, the confirmation of a widening, the ledger, the redaction at the edge: the policy decides what leaves; this item changes only which projects can be named.
- A project with a host-led remote: matched by it, as before; its dock and its CLI unchanged.
- What never leaves (ADR 0025 D-19): the `path:` and `gitdir:` aliases, the project key, the local paths. The team name leaves: the person chose it for the team.
- The alias filter of a pull is minimisation, not a permission (ADR 0026 D-11): any member may name any alias, and the new list shows what any member could already read.
- `resolveProject` and the hooks: no hook reads the policy, and no hook writes a team name.

## Decisions already taken that this touches

- ADR 0025 D-16 (2026-11-09, validator, stated default): "A level above local needs the project's remote alias and is bound to it." This item widens "remote alias" to "team alias: a host-led remote or a team name the person gave". A decision changed is a new decision: it goes to the author.
- ADR 0025 D-19: what accompanies an allowed item is "the project's remote alias"; here, its team alias.
- ADR 0026 D-11, D-12: the alias filter and the ownership rules; unchanged in substance, the alias form widened.
- ADR 0027 D-5 and D-9: a pull names only the projects bound to that server; a team-named project is bound once its level is set, as a remote one is.

## Constraints

- One session per data directory writes the store under `withWrite`; `setLevel` is already the one transaction a level is set in.
- The server's `validate.ts` is the one place a push's shape is judged; `feed.ts` the one place a pull's query is; `contract.ts` the shared grammar: the grammar changes once and both sides read it.
- Every path component the server supplies is checked before it reaches a path (`src/sync/naming.ts`): a team name reaches a folder only as `<slug>-<8 hex>`.
- Hooks fail open and never exit 2; nothing new runs on a hook path.
- Repository documents in English; the crew's gates and the seven reviewers on the full route.

## Files the hypothesis touches

`src/sharing/levels.ts`, `store.ts`, `types.ts`, `report.ts`, `policy.ts`; `src/team/contract.ts`, `validate.ts`, `feed.ts`, `routes.ts`, `store.ts` (the new read), `status.ts`; `src/sync/naming.ts`, `client.ts`, `inbound.ts`, `outbound.ts` (the older-server rule), `state.ts`, `report.ts`; `src/modules/knowledge/resolve.ts`; `src/ui/api.ts`, `ui/src/api.ts`, `ui/src/components/ProjectsView.vue`, `ui/src/sharing-text.ts`; `src/cli/commands/share.ts`, `src/status/report.ts`, `src/doctor/checks.ts`; `docs/adr/0025`, `0026`, `0027`, a new ADR, `README.md`, `docs/runbooks/team-server.md`, `CLAUDE.md`; tests beside each.

## Questions the lenses should answer

- Is a name typed by two members for two unrelated projects (both call theirs `docs`) a merge nobody wanted, and is the list with counts enough warning, or does the server need to refuse a name whose first sender is another member unless picked from the list?
- A member who has no clone of a remote-named project but wants its knowledge: is binding a folder of theirs to a `remote:` alias picked from the list the same feature, and does `resolveProject`'s "a remote names one project for good" make it safe or dangerous?
- Is the rename rule (Nothing first) right, or should a rename move the items on the server (a move changes the uid of every entry, which the server treats as a new entry and a tombstone)?
- The imported memories: with "Knowledge and memories" they stay (D-19). For the author's requirement, is that a second item, or a decision of this one?
