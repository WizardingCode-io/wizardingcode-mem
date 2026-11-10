# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 33 files, every source, doc, SQL and test-helper hunk (the eight test files only where a finding needed them)

Round 1's four upheld defects are all fixed:
- **F-1:** `area` now calls `scopeAmong(flags, ["workspace", "shared"])`, so the unreachable throw is gone.
- **F-2:** `createRepository` no longer has a branch for a missing manifest.
- **F-3:** doctor calls the shared `gitTooOld`.
- **F-4:** both doctor catches now let through only "no such table: knowledge_" and rethrow anything else.

Round 1's advisories F-5, F-6, F-10, F-11 and F-15 are also fixed. The diff adds no new defect. The advisories below are either still there from round 1 or introduced by the change.

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:110 · `isDirectory` is still written three times, identically: here, src/modules/knowledge/resolve.ts:23 and src/doctor/checks.ts:582 (Q2, boilerplate; round 1 F-7, still there).
- F-2 · advisory · src/doctor/checks.ts:591 · `foldersByHand` and `projectFolders` (602) still copy the folder listing of `scanRepos`'s first loop and of `projectFolders` in resolve.ts:114 (Q2; round 1 F-8, still there).
- F-3 · advisory · src/modules/knowledge/store.ts:824 · `adopt` still repeats `underLeases`'s nesting (root lease, open, then the repository's own lease unless it is the root) from store.ts:187 (Q2; round 1 F-9, still there).
- F-4 · advisory · src/modules/knowledge/repo.ts:249 · Only one test passes `GitOptions.timeoutMs` (tests/unit/knowledge-repo.test.ts:350), and it duplicates `store.gitTimeoutMs`. Only a test passes `resolveRepo`'s `folderName` either (resolve.ts:207). These are test-only knobs (Q4/Q5; round 1 F-12, still there).
- F-5 · advisory · src/store/db.ts:216 · Only tests use the exported `moduleVersion`, and the same is true of `readEntry` (src/modules/knowledge/store.ts:745) (Q8; round 1 F-13, still there).
- F-6 · advisory · src/store/db.ts:296 · `owner.get(migration) ?? ""` is still a fallback for a key the map always holds (Q9; round 1 F-14, still there).
- F-7 · advisory · src/modules/knowledge/store.ts:100 · `export { requireSchema }` re-exports the schema check from store.ts, but nothing imports it from there: taxonomy.ts, resolve.ts and index-store.ts all import it from schema.ts (Q8).
- F-8 · advisory · src/modules/knowledge/index-store.ts:34 · `export const fileHash = hashOf` is an alias that only forwards. store.ts then uses both names for the same hash (`fileHash` at 257/465/573, `hashOf` at 304/887/888) (Q5/Q3).
- F-9 · advisory · src/modules/knowledge/store.ts:762 · `onDisk` re-implements `existsOnDisk` (repo.ts:119), which the diff exports and resolve.ts already uses (Q2, boilerplate).
- F-10 · advisory · src/modules/knowledge/store.ts:320 · Inside `commit`, `const written` (the list of paths) shadows the outer `written` declared at 303 (the hash per path), which is a different thing (Q3).
- F-11 · advisory · src/modules/knowledge/taxonomy.ts:55 · `change`'s doc comment describes a `repos` parameter ("the repositories whose leases are held, the root first") that the function does not have (Q10).
- F-12 · advisory · src/modules/knowledge/repo.ts:947 · Every path with no `written` hash counts as `edited`, so the message at 969 says it "changed after" the interruption, which can be false. For an interrupted adopt, `written` covers only entry files that could be read. So a deleted entry, `taxonomy.md`, `knowledge.json` and proposal files get that message even when nobody touched them (Q3, a message that says more than the code knows).
- F-13 · advisory · src/doctor/checks.ts:101 · `DoctorContext.gitVersion` is documented as "for a test" and only tests set it. It is a test-only knob. Separately, line 659 formats the minimum git version one way and `requireGit`'s message (repo.ts:379) formats it another (Q5/Q2).
- F-14 · advisory · src/modules/knowledge/entry.ts:172 · `clipLine` re-implements `clip` from src/util/text.ts (with the "…" ellipsis), but without its surrogate-pair guard (Q2).

## Outside the change
- src/cli/commands/history.ts:214 · `db: db as Db` casts a database that may be null. The diff repeats the same pattern at src/doctor/checks.ts:628 (debt, carried over from round 1).

## Not answerable
- Q2/Q4/Q8 for the eight test files (tests/unit/knowledge-*.test.ts, doctor-knowledge, module-migrations, settings; tests/integration/knowledge-cli.test.ts) · I read them only where a finding needed it, not whole. The two helpers (tests/helpers/knowledge.ts, tests/helpers/stub-git.ts) were read in full, and every StubBehaviour option is used.
- Q7 · `review/inputs.json` (dependencies, phrases) was not given. No `package.json` appears in files.txt, so the diff adds no dependency.
- Which hunks the round-2 commit changed · I could not run `git log -1`/`git show` (read-only tools only). I judged every file as it stands now.

Files read, under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/:
- src/modules/knowledge/{repo,resolve,store,index-store,taxonomy,entry,schema,errors,author,store-open,types,migrations}.ts
- src/cli/commands/knowledge.ts, src/doctor/checks.ts, src/core/git.ts
- docs/adr/0024-knowledge-module.md
- tests/helpers/knowledge.ts, tests/helpers/stub-git.ts
- the diff hunks for src/store/{db,meta,migration}.ts, src/settings/settings.ts, src/util/text.ts, src/status/report.ts, src/cli/commands/{compact,doctor}.ts, src/doctor/context.ts, src/engine/module-schemas.ts, CLAUDE.md, README.md, tests/helpers/cli.ts, tests/preload.ts
