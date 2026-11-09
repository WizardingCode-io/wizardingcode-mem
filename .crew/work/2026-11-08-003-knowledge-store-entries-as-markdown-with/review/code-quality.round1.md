# code-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-code-quality
read: 29 files, about 48 of 63 hunks (all source, docs and SQL hunks; the 15 test and helper files were not reviewed beyond their headers)

## Findings
- F-1 · defect · src/cli/commands/knowledge.ts:177 · `if (scope === "project") throw new UsageError(...)` can never run, because the line above calls `scopeOf(flags, ["workspace", "shared"])`, which already throws on `project`; this is a dead path (Q4).
- F-2 · defect · src/modules/knowledge/repo.ts:477 · In `createRepository`, the `!existsSync(join(repo.path, MANIFEST_FILE))` branch is unreachable: its only caller `openRepo` goes through `resolveRepo`, which always writes or requires a manifest before returning a repository. This is a dead path and a guard for a case the code cannot reach (Q4, Q9).
- F-3 · defect · src/doctor/checks.ts:662 · The doctor writes its own git version comparison, which looks at major and minor only. It duplicates `older` (repo.ts:293) and the `GIT_MIN_VERSION` check in `requireGit`, which compare all three parts, so the two checks can disagree. This is logic duplication (Q2).
- F-4 · defect · src/doctor/checks.ts:689 · The bare `catch { scan = { found: unmapped(), … } }` treats every `scanRepos` failure as "the tables do not exist yet". Any other SQL or read error is hidden and the line can still report ok. The neighbour `recordedModuleVersions` (src/store/db.ts) narrows its catch to "no such table" and rethrows anything else. This is a fallback that hides a cause (Q9, Q6).
- F-5 · advisory · src/doctor/checks.ts:573 · The new knowledge section was inserted between `runChecks`'s doc comment ("Looks, and changes nothing…") and `runChecks` (now line 835), so the comment now sits above `// --- Knowledge` and describes the wrong unit (Q10, Q6).
- F-6 · advisory · src/doctor/checks.ts:717 · The second bare `catch {}` around the `over_cap` query swallows any error, not only a missing table (Q9, same pattern as F-4).
- F-7 · advisory · src/doctor/checks.ts:581 · `isDirectory` is written a third time in this diff, identically in src/modules/knowledge/repo.ts:112 and src/modules/knowledge/resolve.ts:20 (Q2, boilerplate).
- F-8 · advisory · src/doctor/checks.ts:601 · `projectFolders` and `foldersByHand` (590) re-implement the folder listing of `projectFolders` in resolve.ts:111 and the first loop of `scanRepos`, because those take a database. A database-free listing shared by both would remove the copy (Q2).
- F-9 · advisory · src/modules/knowledge/store.ts:794 · `adopt` repeats `underLeases`'s nesting (root lease, open the repository, then the repository's own lease unless it is the root) from store.ts:180, minus the refresh (Q2).
- F-10 · advisory · src/modules/knowledge/repo.ts:318 · `requireGit` tells a timeout from a missing git with `error.message.includes(TIMED_OUT)`. errors.ts says the code is what callers branch on and the message is for the person (Q6).
- F-11 · advisory · src/modules/knowledge/index-store.ts:86 · `proposal.decision ?? "rejected"` silently indexes a decided file that has no `decision` key as rejected. `parseProposal` raises no problem for that case, so the default hides a malformed file (Q9).
- F-12 · advisory · src/modules/knowledge/resolve.ts:203 · Only a test passes the `folderName` option of `resolveRepo`; the same holds for `GitOptions.timeoutMs` (src/modules/knowledge/repo.ts:194), which also duplicates `store.gitTimeoutMs`. These are test-only knobs (Q4, Q5).
- F-13 · advisory · src/store/db.ts:216 · Nothing outside tests imports the exported `moduleVersion` (Q8). The same is true of `readEntry` (src/modules/knowledge/store.ts:716), which the next part will plausibly use.
- F-14 · advisory · src/store/db.ts:296 · `owner.get(migration) ?? ""` falls back for a migration the map always holds (Q9).
- F-15 · advisory · docs/adr/0024-knowledge-module.md:84 · The ADR says "A store move, a restore and a compact wait for a write". The code refuses instead: `compact` throws `CompactBusyError`, and `move` and backup return `ok: false`. AC-19 also says "refused" (Q11).

## Outside the change
- src/cli/commands/history.ts:214 · `db: db as Db` casts a possibly-null database, the same pattern the diff repeats at src/doctor/checks.ts:627.

## Not answerable
- Q2/Q4/Q8 for the test helpers and test files (tests/helpers/knowledge.ts, tests/helpers/stub-git.ts, the eight new test files) · not read past their headers in this pass.
- Q7 · `review/inputs.json` (dependencies, phrases) was not given; no `package.json` appears in files.txt, so no dependency was added.
