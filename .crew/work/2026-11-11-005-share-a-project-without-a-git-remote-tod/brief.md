# Brief

## Request

Share a project without a git remote. Today a project can be set above Nothing only when it has a host-led git remote (ADR 0025, part 6's D-9): the team matches projects by that remote, so two machines land on the same one. The author's work in Claude Desktop (skills, strategies, brand systems, the wizardingcode project at ~/Projects/wizardingcode with 61 memories) has no remote and often no folder, and must be shared whole: in the author's words, 'não é preciso um remote host, tem que deixar partilhar mesmo sem remote host; tudo é partilhado'. A project is shared under a team name: when a person sets a level on a project with no host-led remote, the dock asks for the name the team will know it by (the project's name by default, a slug), the level binds the project to the server under the alias team:<slug>, and the server accepts that alias beside remote:<host>/<path>; another member binds their own project, with a folder or without, a remote or without, to a team project by picking it from the list the server knows, or by typing the same name; a project with a host-led remote keeps matching by it, and may also carry a team name. The viewer, the CLI (share project … --as <name>), the server's validation and feed, the sync's pull scopes, the received store's folders and the runbook follow. Nothing changes for what leaves: the levels, the roots and the areas stay the policy.

## Assumptions

Confirmed by the person on 2026-11-11 ("sim força"), with D-1 to D-7 answered by their defaults (`crew decisions`):

- A project with no host-led git remote is shared under a name the person gives, stored as the alias `name:<slug>` beside the project's other aliases, and a level above Nothing binds to it (D-1). ADR 0025 D-16 is amended by the new ADR.
- The alias prefix is `name:`, not `team:` (the received memories' judge is `team:<serverId>`); the viewer says "shared name" and "Shared as `x`".
- The server holds a registry of names: created once by one member, joined by the others from the list; a push under a name the server does not hold is refused (D-2).
- The contract moves to 2 with 1 accepted; the client holds names out of its pulls and pushes while `/v1/me` answers 1, says so in `status` and on the Servers page; the server is upgraded first (D-3).
- Team schema 2 renames the four `remote_alias` columns `project_alias` and adds the registry; a 0.7.0 image refuses the database; the wire key `remoteAlias` keeps its name (D-4).
- The client's store moves to version 8 (migration 8: one name per project), so a 0.7.0 binary refuses the store (D-5).
- Imported memories stay (ADR 0025 D-19 kept); the dock and the preview show how many stay (D-6).
- A teammate binds an existing project of theirs; a project with no folder created from the viewer is out (D-7).
- The bound alias wins while the project carries it; a project with a host-led remote and no bound name binds by the remote, and `--as` is refused there (`has-remote`); a local-path or `file://` remote is no remote.
- A rename is "leave this name" (Nothing, which withdraws) and a new name; Nothing keeps the name; a project at Nothing can forget its name (the dock, `share name forget`).
- The slug is `slugify`'s (NFKD, marks removed, 80 characters); a text that leaves no letter or digit is refused; the received folder stays `projects/<slug>-<8 hex of the alias>`.
- CLI: `share project <level> [--as <name>] [--server <id>] [--yes]`, `share names [--server <id>]`, `share name forget`; viewer: the dock's field and its two states, `GET /api/servers/<id>/names`, `as` on `PUT /api/projects/<id>/sharing`.
- The list of names shows names only (never remotes), paged, under the pull's rate bucket; entries and memories are counted by two indexes schema 2 adds; the members seen are counted on the client from the received rows.
- The identity rule lives in one leaf, `src/core/identity.ts`, applied by every reader, the five SQL prefilters included.
- Out: binding a folder to a `remote:` alias from a list; a server move as a rename; `name:` as a strong alias of the knowledge manifest; a server-minted project id; an admin's deletion of a name.
