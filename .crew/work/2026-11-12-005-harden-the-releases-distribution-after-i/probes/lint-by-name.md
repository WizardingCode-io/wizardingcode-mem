# Lint by name

The lint gate checks no file inside a crew worktree (`biome.json` excludes `**/.crew`), so the item's files were linted by name on 2026-11-12, at commit `1d12b6a`:

```
./node_modules/.bin/biome check scripts/release tests/integration/release-commands.test.ts tests/integration/release-push.test.ts tests/unit/release-docs.test.ts tests/unit/deploy-files.test.ts
Checked 9 files in 10ms. No fixes applied.
```

And the whole of `scripts src tests npm`: `Checked 500 files`, no errors (96 warnings and 1 info, none in the files of this item).

## A red recorded after its code

AC-19 (the redaction at the command) is satisfied by the wrapper written for AC-9. Its test was written after that wrapper existed, so it passed at once. Its red was recorded with the wrapper's two `redact` calls switched off in `scripts/release/push.ts`, and the file was restored before the green: the test fails without the code, but the order "test, then code" does not hold for this criterion. AC-17's baseline (`crew tdd before`) was likewise recorded with `scripts/release/push.ts` put back to its state at the item's base, since Phase 1 had already changed the file.
