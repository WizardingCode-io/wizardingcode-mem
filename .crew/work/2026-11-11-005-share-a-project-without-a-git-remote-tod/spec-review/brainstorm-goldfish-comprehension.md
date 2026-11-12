mode: brainstorm

# comprehension findings for 2026-11-11-005 (share a project without a git remote)
reviewer: goldfish-comprehension
read: probes/concept.md (whole); ui/src/components/ProjectsView.vue (sharing section); src/cli/commands/share.ts (USAGE, `project`); src/sharing/store.ts (refusal sentences); README.md "Sharing"; ADR 0025 D-15/D-19 and ADR 0027 by search

## Findings

**Paraphrase, five lines, as a newcomer.** Today a project can be shared with the team server only if it has a git remote on a host, because the remote is how two machines recognise the same project. The concept lets a project with no remote be shared under a typed "team name" (a slug, stored as the alias `team:<slug>`). A teammate types or picks the same name on one of their own projects and receives what was sent under it. A project that has a remote keeps using the remote and cannot take a name. Changing the name means setting the level to Nothing and then setting it again under the new name.

- F-1 · Blocker · "The author's own machine…" and Question 4 · The author's requirement is "tudo é partilhado". The concept leaves the imported-memory split to "the brief", and D-15/D-19 keep imported memories off the wire. Of the author's 149 remote-less projects, most are `imported:<name>`, and their memories are probably all imported. The author would name them, set "Knowledge and memories", and the preview would show close to zero. Nothing in the dock says why. The CLI can't reach those projects at all, because `share project` acts on `process.cwd()` and an `imported:` project has no folder. So the feature would look broken on the exact machine it is built for. Answer to Q4: this belongs to this item. At the very least, the dock must say in one sentence "N imported memories never leave", and the concept must state whether `imported:` projects get the name field at all.

- F-2 · Major · §9 "A member types or picks `wizardingcode` on a project of theirs (any folder…)" · The teammate needs an existing project to bind. `store.ts` refuses with "this folder is not a known project; start a session here first", and the dock only lists known projects. A Cowork/Desktop teammate who has never run a session in a folder has nothing to pick. Nothing in the workflow covers this setup step. This is where a teammate gets stuck first.

- F-3 · Major · §2 `renamed`, §7 "set Nothing to rename" · This is not a rename. Setting Nothing only withdraws *my* items. Teammates stay bound to the old name, keep their items there, and get no notice. "Rename" makes a person expect a team-wide change, and what actually happens is "I leave A and join B". The concept also relies on Nothing withdrawing what was sent. README "Sharing" says "Lowering a level recalls nothing already sent", while ADR 0027 describes the sweep withdrawing. A reader of the README would think Nothing-first loses nothing and changes nothing on the server. Answer to Q3: keep Nothing-first, but word it as "leave this name" and fix the README sentence.

- F-4 · Major · §1 "the project's own name by default" + §7 combobox, Q1 · Prefilling the project's own name makes collisions more likely, not less: `docs`, `website` and `notes` will match. The concept never says what the dock shows when the typed text equals a name the server already knows. Answer to Q1: counts alone won't stop anyone. The field needs two visibly different states, "joins `docs`, used by 2 members, 14 entries" and "new name". Reaching an existing name should take an explicit pick, enforced in the UI and not refused by the server, so typing alone can't merge two projects silently.

- F-5 · Major · refusal sentences · `name-taken` reads as "a teammate has it", but it means *another project on this machine* holds the name. The sentence should say that and name the other project. `has-remote` ("this project is matched by its git remote") states a fact without saying what to do: no action is needed, and the teammate should add the same remote. It also misses a trap: a `file://` or local-path remote counts as no remote (README), so a person who can see a remote in git gets a name field and no explanation. `no-name` is good. `renamed` should name the bound name and the exact step.

- F-6 · Major · term "team name" · People will read it as the name of the team, not of the project. The prefix `team:` is also overloaded: the alias is `team:<slug>`, and the judge of received memories is `team:<serverId>` (§9). Together with `isTeamName` vs `isTeamAlias`, a developer will mix them up. Suggest "shared name" in the UI, and something like `named:` for the alias.

- F-7 · Major · §8 CLI · `share project` (writes the level locally) and `share projects` (reads the server's list) differ by one letter. Something like `share names` would avoid that. `--as` looks like a one-off option, but it is stored permanently. There is no command to see the current name except `share status`, and none to clear a name or to name a project without sharing it.

- F-8 · Nit · undefined or assumed terms · "host-led", "bind/bound", "dock", "Nothing" as a level label (it reads as an English word), "part 5", "the brief", "8 hex", "mirror". The concept uses all of them without defining them.

- F-9 · Nit · §5 "(it answers `version` today; to confirm)" · An unchecked premise in the older-server path.

**The author, step by step.** They work in Desktop/Cowork, not the terminal:
1. Open the viewer. The concept doesn't say how they reach it from Desktop; that is already assumed.
2. Settings → Servers, paste the invitation code.
3. Across projects → `wizardingcode` → Sharing. The name is prefilled `wizardingcode`.
4. Choose Knowledge and memories, then confirm the preview.
- **Stuck 1:** the preview count. Most memories are imported, so little leaves and nothing explains why (F-1).
- **Stuck 2:** the other 140-odd `imported:` projects. Nothing says whether they can be named or would send anything.
- **Stuck 3:** telling a teammate how to join. The teammate needs a known project first (F-2).

**Q2 (binding a folder to a `remote:` alias picked from the list).** In use it is the same gesture. It is dangerous here because `resolveProject` treats a remote as naming one project for good. If the folder later gets a real `git remote`, it then has two identities, which is exactly what `has-remote` exists to stop. Make it a separate item.

## Not answerable
- How the author opens the viewer from Claude Desktop/Cowork · no document I read says.
- The wizardingcode project's imported/own memory split · it is "in the brief", which I was not given.
