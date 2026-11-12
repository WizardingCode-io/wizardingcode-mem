# Probe: the lint of the item's files, run by name

Asked by the QA and devops leads' delivery returns: the engine's lint gate runs `biome check .` inside a crew worktree, where Biome ignores every path (`.crew` is excluded in biome.json), so its log says 'Checked 0 files'. This is the same check run over the item's own files, each named, and over the four source folders, on the tree of commit bd45b41, on 2026-11-12.

The item's 21 files that biome.json covers (from review/files.txt; plugin/, plugins/ and tests/fixtures/ are excluded by the project's biome.json: generated files and fixtures):

```
$ ./node_modules/.bin/biome check npm/bin/wizardingcode-mem.js scripts/plugins.ts scripts/release/lib.ts scripts/release/npm.ts scripts/release/plan.ts scripts/release/push.ts scripts/release/token.ts src/cli/commands/install.ts src/install/binary.ts src/util/version.ts tests/e2e/install-forward.test.ts tests/helpers/version.ts tests/integration/install-script.test.ts tests/integration/install.test.ts tests/integration/npm-shim.test.ts tests/integration/release-commands.test.ts tests/integration/release-push.test.ts tests/unit/deploy-files.test.ts tests/unit/release-docs.test.ts tests/unit/release-lib.test.ts tests/unit/version-order.test.ts
Checked 21 files in 41ms. No fixes applied.
```

The four folders, every diagnostic at the level error:

```
$ ./node_modules/.bin/biome check --diagnostic-level=error src scripts tests npm
Checked 500 files in 171ms. No fixes applied.
```
