# Probe: the item's files linted by name

The lint gate checks no file inside a crew worktree (its log reads `Checked 0 files`), so its recorded pass says nothing of this item. Run on 2026-11-12T22:40Z at commit `2805b38`, from the worktree's root, over every `.ts`, `.vue` and `.json` file the item changed outside `.crew/` (`git diff --name-only origin/main...HEAD`):

```
./node_modules/.bin/biome check \
  src/cli/commands/distill.ts src/cli/commands/update.ts src/ui/server.ts src/ui/update.ts src/update/check.ts src/update/mode.ts src/update/report.ts tests/integration/ui-update.test.ts tests/unit/ui-update.test.ts tests/unit/update-boundary.test.ts tests/unit/update-check.test.ts tests/unit/update-docs.test.ts ui/src/App.vue ui/src/api.ts ui/src/components/Settings.vue ui/src/components/UpdateBanner.vue ui/src/components/settings/About.vue ui/src/update-state.ts ui/src/update.ts 
```

Output:

```
Checked 10 files in 29ms. No fixes applied.
```

`src`, `scripts`, `tests` and `npm` were also checked at error level before each commit of the item (`biome check --diagnostic-level=error`): no error. That run named `ui/src` too, and read nothing of it or of `src/ui` (below).

## What the ten are, and the nine the linter does not read

Run file by file, the linter reads ten of the nineteen and reports nothing on them:

`src/cli/commands/distill.ts`, `src/cli/commands/update.ts`, `src/update/check.ts`, `src/update/mode.ts`, `src/update/report.ts`, `tests/integration/ui-update.test.ts`, `tests/unit/ui-update.test.ts`, `tests/unit/update-boundary.test.ts`, `tests/unit/update-check.test.ts`, `tests/unit/update-docs.test.ts`.

For the other nine it answers `Checked 0 files`: `src/ui/server.ts`, `src/ui/update.ts`, `ui/src/api.ts`, `ui/src/update.ts`, `ui/src/update-state.ts`, `ui/src/App.vue`, `ui/src/components/Settings.vue`, `ui/src/components/UpdateBanner.vue`, `ui/src/components/settings/About.vue`. The project's `biome.json` leaves `src/ui` and `ui` out of the files it lints, for every item and on `main` alike: this is the repository's configuration, not this item's, and no lint run exists for those nine. What does hold them: the typecheck gate reads the five `.ts` files among them (`tsc --noEmit`, pass), and the build gate compiles the four `.vue` files (`vite build`, pass).
