# Conclave: the sharing policy

Checklists read: `migration-or-restore` (the `sharing` schema namespace and the reset of levels after a restore), `endpoint` (`GET /api/sharing`, `PUT /api/projects/<id>/sharing`, the `share` command) and `screen` (the Sharing page and the dock's Sharing section). The change is not a login, a payment, an upload, a sync with a third party, a redirect, a deletion or a merge.

## Assumed by good practice

- The migration adds three tables in a module namespace and nothing else: no row is copied, moved or dropped, so no step is destructive and no copy is taken first; it is reversible by dropping the three tables and the `module_migrations` row, and no down migration ships (the spec's Risks and rollback says the rollback target is 0.6.0, which opens the store at `user_version` 7 and ignores them) (AC-1).
- A restore brings the schema and the rows of the copy; the levels in the copy are reset to Nothing on purpose, logged with source `restore`, and said by the CLI and the viewer; the roots and the areas live in the env file, are not in the backup and keep their current values (the checklist's "what comes back exactly": every row of the copy but the person's levels, which never come back from a copy) (AC-12).
- Every route is behind the viewer's bearer token like its neighbours; input is validated at the boundary (the level against `LEVELS`, `confirm` a boolean, `list` a flag); errors use the server's `problem()` shape, never a stack; the two lists are capped at 500 items with a `more` count; a widening needs `confirm: true` as `move` and `restore` need it (AC-9). The fields exposed are entry slugs, titles and areas, and memory ids and titles, which the viewer already shows on this machine; nothing personal beyond the author's name already in the files.
- The command refuses outside a known project, never creates one, asks before widening on a TTY and needs `--yes` otherwise, and exits 0, 1 or 64 as the other commands do (AC-8).
- Loading fails closed, the environment can only narrow, every change is logged with its source and bumps the epoch, and `decide` is pure (AC-2, AC-3, AC-5, AC-6).
- The screen's states are enumerated on the criterion: default (nothing shared), loading, saving, error (a toast, as Backups does), locked by the environment, empty taxonomy, the confirmation dialog, success (a toast); every control is a native button or a Nuxt UI switch, so it is operable by keyboard with a visible focus; no animation is added; the dark frame is the viewer's; copy in English, no part numbers (AC-10).
- No hook reads the policy; the first `openDb` after the upgrade creates the tables once; the pinned snapshots and the perf budgets hold (AC-13).

## Decisions only the user can make

Recorded on the item with their conservative defaults; where nobody watches, the validator applies the stated default under `stated-default`:

- D-1: where the level lives (default: the database beside the project; the env file for the two workspace-level keys; its "column on projects" clause superseded by D-8).
- D-2: the defaults (default: everything local).
- D-3: a list of shared or of private areas (default: shared areas; private by default).
- D-4: the author's rules (default: never leave in this part).
- D-5: the shared repository and the area list (default: subject to the list; its "always" clause superseded by D-12).
- D-6: which memories leave at `all` (default: every active non-rule memory; refined by D-15's fixed set).
- D-7: where the person sets the level (default: Across projects rows plus Settings; its "separate card" clause superseded by D-18).
- D-8: the storage namespace (default: the `sharing` namespace of `module_migrations`; `user_version` stays 7).
- D-9: one level or one per destination (default: per `(project, destination)`; one destination, `team`).
- D-10: what leaves for an entry (default: the exported current content; never a repository or its history).
- D-11: the predicate's answer (default: `send`, `withdraw` or `keep` with a reason and the epoch; the ledger created here).
- D-12: area ids and roots (default: root-qualified ids; a roots list, default empty).
- D-13: the environment and the sharing keys (default: the file is the policy; the environment only narrows).
- D-14: loading when something is wrong (default: fail closed; an invalid token empties the list; unknown ids inert).
- D-15: the meaning of `all` (default: active, not stale, project scope, not imported, not a user rule; fixed).
- D-16: a level and the project's identity (default: bound to the `remote:` alias; disabled, orphans and project 0 are local; restore resets).
- D-17: recording and confirming changes (default: a change log, an epoch, confirmation before widening).
- D-18: the viewer (default: the Collaboration card becomes the Sharing page; the level in Across projects).
- D-19: what rides along and redaction (default: the fixed lists; `redact` at the edge a required step).
- D-20: the read-outs and doctor (default: a `status` line, `GET /api/sharing`, `share`; doctor warns for invalid, ignored, unbound and inert only).

The endpoint checklist's "who may call it": whoever holds the viewer's token on this machine, as for every other route; the command, whoever has a shell here. The screen checklist's "focal moment": none; no motion is authored.

## Proposals

- `share status --json` so part 6's dry run and a person's script can read what would leave as data: a later item, once part 6 names its shape.
- A filter by memory kind at `all` (decisions and conventions, not fixes): a later item, if the team asks; today `all` is one fixed set.
- A "would leave" filter in the Memories view and the Knowledge view: part 3's viewer, which does not exist yet.
- Sharing the author's own rules as pinned knowledge: a later item (D-4).

## Warnings

- An agent with a shell can widen sharing with `share project all --yes` or by writing `<data dir>/env`; the confirmation protects a person at a terminal, not against a process. Part 1 named agent shell access as the guarantee's boundary; here it decides egress. Every change is logged with its source and `share status` prints the last one; the ADR says so. Recorded as an advisory objection.
- A restore changes the person's choices: the levels in the copy are reset to Nothing. The safe direction, said by the CLI and the viewer and logged; a person who restores sets them again. Recorded as an advisory objection.
- The settings rule "the environment wins over the file" gains two exceptions, and the Settings page's footer says the rule without them. The footer is reworded in this part ("The environment wins over the file; for sharing it can only narrow.") and the ADR records the exception. Recorded as an advisory objection.
- Memories have no area: a project at Knowledge and memories sends every memory of the fixed set whatever the area list says. The viewer says it in two places and the ADR records it. Recorded as an advisory objection.
