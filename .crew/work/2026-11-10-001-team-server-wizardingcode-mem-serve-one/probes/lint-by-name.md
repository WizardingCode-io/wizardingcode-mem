# Lint of the item's files by name

`bun run lint` is `biome check .`, which inside a crew worktree checks 0 files and exits 1 while the engine records the gate as passed (`docs/real-use/findings.md`, the knowledge store's row of 2026-11-09). The proof of lint for this item is therefore a run of biome over the item's own files, named one by one from `review/files.txt` (the `.ts`, `.vue` and `.json` ones that exist on the final tree), on commit 208d5de (the formatting of `tests/unit/knowledge-git-host.test.ts` included):

```
$ sh lint-item.sh   # cd <worktree>; biome check <the 51 files of review/files.txt>
Checked 51 files in 43ms. No fixes applied.
exit 0
```

Before that commit the same run found one error, the formatter's, in `tests/unit/knowledge-git-host.test.ts` (two calls past the line width); `biome check --write` on that file fixed it, and nothing else changed.

A run of biome over `src tests scripts ui/src` by name also flags files this item did not touch (`src/embed/*.ts`, `scripts/embed/*.ts`: `noNonNullAssertion`, `useTemplate`), which `biome check .` on `main` does not report; that difference is outside this item.
