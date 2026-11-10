# Concept: the sharing policy (part 4)

Mode: brainstorm

## Hypothesis

Before any team server exists, the person decides what may leave the machine: a level per project (`local`, `knowledge`, `all`), a switch for the workspace repository's knowledge, and a list of shared knowledge areas; one pure predicate in `src/sharing/policy.ts` answers for any entry or memory, and parts 5 and 6 call it and nothing else. The per-project level is a column on `projects`; the workspace switch and the area list are settings in `<data dir>/env`; the viewer shows and sets all three; `status` and `doctor` print what the policy lets out. Every default is local.

## What exists today (facts from the repository)

- `src/settings/settings.ts`: `SETTING_KEYS` (fixed list), `RULES` per key, `loadSettings`, `validatePatch`, `publicSettings`; the environment wins over the file; `src/settings/env-file.ts` writes the file atomically at 0600. The viewer's Settings page (`ui/src/components/Settings.vue`, cards under `ui/src/components/settings/`, state in `ui/src/settings.ts`) reads `GET /api/settings` and writes `PUT /api/settings` (`src/ui/server.ts`).
- `projects(id, key, name, disabled, created_at)` in `src/store/migrations/0001_init.sql`; `disabled` is the per-project "memory off"; ADR 0018: a disabled project feeds no other project (`visibleProjects`), its user rules are not read.
- Core migrations 1 to 7 (`src/store/db.ts`); a column added to `projects` is a core migration 8.
- `user_memories` marks the author's own rules (ADR 0018 P1).
- Part 1: knowledge repositories per scope under `<data dir>/knowledge/` (`workspace/`, `projects/<folder>/`, `shared/`), `knowledge_repos(scope, project_id, path, …)`, entries with `area`; proposals under `proposals/`. Part 2: the module in the engine. Neither has a notion of leaving the machine.
- The viewer's Across projects view (`ui/src/components/ProjectsView.vue`) lists projects and their links; the Settings cards follow one `Card.vue`.
- `status` (`src/status/report.ts`) and `doctor` (`src/doctor/checks.ts`) print lines per concern.

## Design sketch

### The policy

```ts
type Level = "local" | "knowledge" | "all";
interface SharingPolicy {
  workspaceKnowledge: boolean;        // WIZARDINGCODE_MEM_SHARE_WORKSPACE, default off
  sharedAreas: ReadonlySet<string>;   // WIZARDINGCODE_MEM_SHARE_AREAS, default empty
  projectLevel(projectId): Level;     // projects.sharing, default local; disabled → local
}
mayShareEntry(policy, { scope, projectId, area, status }): boolean
mayShareMemory(policy, { projectId, status, isUserRule }): boolean
```

- An entry leaves when its `status` is `active`, its area is in `sharedAreas`, and its repository is shared: the shared scope always (it is the team's); the workspace when `workspaceKnowledge`; a project repository when the project's level is `knowledge` or `all`.
- A memory leaves when its project's level is `all`, its status is `active`, and it is not a user rule (the author's own rules are personal; a later part may offer them).
- A proposal never leaves (a person decides it first); a draft or archived entry never leaves.
- A disabled project is `local` whatever its column says.
- The predicate is pure: the policy is loaded once per call site (settings plus a query of `projects`), then answers in memory.

### Storage

- Core migration 8: `ALTER TABLE projects ADD COLUMN sharing TEXT NOT NULL DEFAULT 'local' CHECK (sharing IN ('local','knowledge','all'))`.
- Settings: `WIZARDINGCODE_MEM_SHARE_WORKSPACE` (`on` | `off`), `WIZARDINGCODE_MEM_SHARE_AREAS` (a comma list of area ids, each matching part 1's area pattern; an unknown area is kept and warned by `doctor`).

### The viewer and the CLI

- Settings → a Sharing card: the workspace switch; the areas as toggles, listed from the workspace and the shared taxonomies (part 1's `taxonomyFor`), unknown ids in the setting shown as such; a line "Nothing leaves this machine until a team is configured (part 5); this is what will."
- Across projects: each project row gains a level selector (`local`, `knowledge`, `all`); a disabled project shows `local` and the selector off. `PUT /api/projects/<id>/sharing {level}`; `GET /api/sharing` returns the policy and the counts (projects per level, shared areas, entries and memories that would leave).
- CLI: `wizardingcode-mem share project <level>` (the project of the current directory), `share status` (the policy and the counts).

### Status and doctor

- `status`: a `sharing` line: the levels' counts, the workspace switch, the shared areas, and the counts of entries and memories the policy would let out today.
- `doctor`: `warn` when a shared area is not in any taxonomy, when a project set to `knowledge` or `all` is disabled (its column is ignored), or when sharing is configured but no team is (part 5), said as information.

### Not in this part

The server, the sync, any network; redaction at the edge (part 6's); sharing the author's user rules; a per-entry override.

## Assumptions (what would have been asked)

- Every default is local: nothing leaves until the person chooses, area by area and project by project.
- The shared scope repository is subject to the area list too: a private area never leaves, even from the team's repository.
- The per-project level lives in the database, not in the env file: the project list is there, and the viewer edits rows; the env file holds the two workspace-level keys.
- The author's user rules never leave in this part.
