# Lint by folder (the engine's lint gate checks 0 files inside a worktree)

`bun run lint` is `biome check .`; biome.json excludes `**/.crew`, and this checkout lives under `.crew/worktrees/`, so the gate's run reads "Checked 0 files" and the engine passes it on the exit code of a run that saw nothing (a known limit of the worktree, noted in the repository's memory). The run the plan's task 27 promised, by folder name:

```
./node_modules/.bin/biome check src tests scripts --max-diagnostics=500
Checked 485 files in 205ms. No fixes applied.
Found 96 warnings.
exit 0
```

Taken on 2026-11-11 after the round-3 judgement, on the tree the gate run of the same time cut, and taken again after the delivery leads' returns and the round-4 advisories were applied (the last change to a source the item owns: the doc comment of `setProjectSharing` in `src/ui/api.ts`), with the same result: `Checked 485 files`, `Found 96 warnings`, `Found 1 info` (`lint/style/useTemplate` at `scripts/embed/pack.ts:86`, a file this item never changed), exit 0. No error. The 96 warnings sit in files this item never changed (`scripts/embed/*`, `src/embed/*`, `tests/unit/embed*.test.ts`, `tests/integration/plugins-packaging.test.ts`, `src/history/db.ts`: `noNonNullAssertion`, `noUnusedImports`, `noExplicitAny`), plus two `noTemplateCurlyInString` warnings in `tests/unit/ui-sharing-copy.test.ts` at lines 99 and 181, both pre-existing pins of template-literal text in the Vue sources that this item kept. The files this item added or changed hold no finding. `ui/src` is excluded by biome.json (`!**/ui`) and has no linter of its own; its sources are type-checked by the Vite build (`bun run ui:build`, part of the test gate).

Re-run after the delivery returns (the viewer's bind path, the three edge-case tests): the same command, the same counts, no finding in the item's files.
