# architects lead's validation of 2026-11-12-005-harden-the-releases-distribution-after-i: delivery
verdict: validated
## Returns
none
## Notes
- Placement follows the spec's Design 1. `encodedCredential` and `redact` are in `scripts/release/push.ts:30-40`, the only file that builds a derived form of the token, and `gitEnv` builds its header from the same function (`push.ts:56`). Nothing moved into or out of `lib.ts`.
- The redaction wraps the runner once, on `options.runner ?? run` (`push.ts:94-98`), with the environment passed through untouched. Every git call goes through `exec`: the tag read (`push.ts:101`), the `git` and `must` helpers (`push.ts:118-125`), both pushes, the rebase and its abort (`push.ts:143, 159, 161, 166`).
- No destination comes from the environment: the command passes `REMOTES[target]` and `https://github.com/<GITHUB_REPOSITORY>.git` (`push.ts:237-238`), and the `PUSH_REMOTE`, `PUSH_ORIGIN` and `onRunner` reads are gone. `editTap` and `editMarketplace` are exported (`push.ts:187, 202`) and the command stays behind `import.meta.main` (`push.ts:225`).
- No `::add-mask::` line is printed anywhere in `push.ts`, as the changed spec asks (spec.md:25, 84).
- Both rules are in ADR 0029. The token paragraph (`docs/adr/0029-release-distribution.md:15`) has the exact-match redaction, its limit, "another form must add its own", and why no mask line is printed. Limits (`:66`) has no destination from the environment and writes tested through `commitAndPush`.
- Both rules are in the Releasing line of `CLAUDE.md`, one sentence: "`push.ts` redacts the token's encoded credential by exact match … and its command takes no destination from its environment: writes are tested through `commitAndPush`."
- The findings row is split by content as Design 4 asks (`docs/real-use/findings.md`):
  - `:70` and `:71` are answered and cite item `2026-11-12-005`.
  - `:72` is the version rule, `deferred, to the client update item`, with the lenses' points.
  - `:73` keeps the two untouched advisories (`decideHold`'s `previous === null` branch, the temporary folders of `deploy-files.test.ts`) as `deferred`.
  - `:74` is the new `deferred` row naming `GIT_CONFIG_GLOBAL`, the missing time limit and the inherited `MARKETPLACE_TOKEN`.
- The architecture gate is proven with no findings (`report.md:63`, `review/architecture.findings.md:6`), all nine criteria are red then green or preserved (`report.md:34-42`), and every other gate's findings were ruled advisory (`review/ruling.json`).
- The lint gate reads "pass: 1 untouched file with problems, none of the item's" (`report.md:52`). `findings.md:64` records that this gate has checked 0 files inside a crew worktree before; I could not tell from the report whether the item's files were linted by name this time. The build and typecheck gates passed (`report.md:50, 53`).
- The `tasks/` folder holds no briefs for this item; I validated from the report, the code and the documents as built. The report's Validations table (`report.md:125-139`) lists no delivery row yet, as expected before this answer.
- Advisory, not a return: `findings.md:70` no longer says that the old row's claim "Actions masks the raw secret only" was wrong; the correction lives in `docs/adr/0029-release-distribution.md:15` (already ruled advisory, `report.md:69`).
