# Build notes

## The compiled binary against the real github.com

Run on 2026-11-12 with the binary the e2e builds (`dist/e2e/wizardingcode-mem-darwin-arm64`, macOS arm64), a throwaway home and an empty environment (`env -i HOME=<tmp> PATH=/usr/bin:/bin WIZARDINGCODE_HOME=<tmp>/w WIZARDINGCODE_MEM_MIGRATE=off`):

```
$ wizardingcode-mem update
update: 0.8.0 is the latest (checked 0 s ago)
  plugin: update the wizardingcode-mem plugin from your agent's plugin manager
  Homebrew: brew upgrade wizardingcode-mem && wizardingcode-mem install
  npm (and Windows): npx wizardingcode-mem@latest install
  script: curl -fsSL https://raw.githubusercontent.com/WizardingCode-io/wizardingcode-mem/main/scripts/install.sh | sh
exit 0

$ cat <tmp>/w/mem/update.json
{"latest":"0.8.0","checkedAt":1794509887652,"failedAt":null,"reason":null,"attemptAt":1794509887652}

$ wizardingcode-mem status | head -2
wizardingcode-mem 0.8.0
update: 0.8.0 is the latest (checked 0 s ago)

$ wizardingcode-mem doctor | grep update
ok    update: 0.8.0 is the latest (checked 0 s ago)
```

What it shows: `fetch` with `redirect: "manual"` in the compiled binary reads the 302 and its `Location` on this platform, and the state file is written as specified. What it does not show: the other four platforms, rate limiting, and the answer while a release's assets upload.

## Lint by name

The lint gate checks no file inside a crew worktree (`biome.json` excludes `**/.crew`). By name, on 2026-11-12: `./node_modules/.bin/biome check src scripts tests npm` checked 515 files with no error (96 warnings and 1 info, the same count as before this item, none in its files).

## A red recorded after its code

AC-18's end-to-end test (`tests/e2e/update-reconcile.test.ts`) was written after `src/update/reconcile.ts` and the wiring in `src/cli/main.ts` existed, since the unit tables of AC-23 had already driven them. Its red was recorded with `reconciles` made to answer false in `src/cli/reconciled.ts`, and the file was restored before the green: the test fails without the hand-over, but the order "test, then code" does not hold for that file. The tests of every other criterion were written and seen failing before their code.

One case planned for that file was dropped: `ui --auto` on the compiled binary starts the viewer, which does not exit; the rule is held by the `reconciles` table instead.
