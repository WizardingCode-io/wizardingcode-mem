# Brief

## Request

Sharing policy: per project local only, knowledge only, or knowledge and memory; per knowledge area private or shared; settings in the data directory's env file and in the viewer's Settings; one predicate every sync reads so what is private never reaches the server; ADR 0025.

## Goal

The person decides what may leave the machine, before any team server exists: for each project, nothing (`local`), its knowledge (`knowledge`), or its knowledge and its memories (`all`); for the workspace repository's knowledge, on or off; for each knowledge area, shared or private. One pure predicate in code (`src/sharing/policy.ts`) answers, for any entry or memory, whether the policy lets it leave; the team server and the sync client (parts 5 and 6) call it and nothing else decides. The settings live where the product's settings live (`<data dir>/env`, keys named like the environment variables) and in the viewer's Settings, with the per-project level beside each project in the viewer; `status` and `doctor` show what the policy lets out.

## Context

Parts 1 and 2 give knowledge repositories per scope (workspace, projects, shared) under the data directory and memories per project in the database. The user's brief of 2026-11-08 (Q-3): "I want to define what I share or not: there can be projects, knowledge and memory I do not want to send to the server"; the mission: "the user chooses what is shared, and projects, knowledge areas and memories can be kept off the server". Today nothing leaves the machine but a TypeSafe judgement when a key is set (ADR 0018 "Nothing leaves"), and the engine has no notion of sharing. ADR 0018's disabled projects (memory off) feed no other project; they should feed no server either.

## Constraints

- Nothing leaves the machine unless the person chose it: every default is "local"; the predicate is the one place that decides; the sync parts never bypass it.
- The settings follow `src/settings/settings.ts`: keys named like environment variables, validated by `RULES`, the environment wins over the file, secrets never shown in full.
- The hook path is untouched.
- Product text in English; the viewer follows the Sales OS pattern; the binary keeps its name.
- Clean room: nothing from claude-mem.

## Acceptance

- A project has a sharing level, `local` by default, settable to `knowledge` or `all` in the viewer and by `wizardingcode-mem share project <level>`; a disabled project (memory off) is always `local`.
- The workspace repository's knowledge is shared only when `WIZARDINGCODE_MEM_SHARE_WORKSPACE` is `on` (default `off`); the shared areas are the comma list `WIZARDINGCODE_MEM_SHARE_AREAS` (default empty: every area private).
- `mayShareEntry` and `mayShareMemory` answer from the policy alone: an entry leaves only when its repository's project (or the workspace, or the shared scope) is shared and its area is in the shared list; a memory leaves only when its project is `all`, is active, and is not one of the author's user rules; a proposal never leaves.
- The viewer's Settings has a Sharing card (workspace knowledge on or off, the areas as toggles from the taxonomies) and the Across projects view shows and sets each project's level; `status` and `doctor` print what the policy lets out.
- `docs/adr/0025-sharing-policy.md` records the decisions.

## Assumptions

- The team server and the sync (parts 5 and 6) are the only readers of the predicate; this part ships the policy and its settings with no network.
- The per-project level is stored with the project in the database (a column), since the project list lives there and the viewer edits rows; the workspace-level choices are settings in the env file.
