# data findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-data
read: 11 files (the rubric, review/data.round4.md, review/ruling.round4.json, probes/round-five-change.patch whole, probes/withdrawn-module-meta-rows.md whole, src/modules/knowledge/migrations/0006_knowledge_store.sql whole, src/modules/knowledge/repo.ts:180-220, 660-790 and the commitChange, NO_CAP and dropKept sites, src/modules/knowledge/store.ts:266-345 and 745-890, src/modules/knowledge/index-store.ts:120-180 and 480-614, src/store/db.ts:68-80, the project_aliases reads in src/modules/knowledge). Schema and migrations read: migration 0006 as it stands, which this commit leaves unchanged. Risk areas: data-migration, personal-data.

## Findings
- F-1 · advisory · src/modules/knowledge/repo.ts:162 · `refuseLinksInside` now refuses a repository whose `.git` holds anything that is not a regular file or a folder, sockets and FIFOs included, not only links. One example is a git fsmonitor daemon socket, which a person's own git run with `core.fsmonitor` in their global config may leave in `.git`; I did not run this. When that happens, `inEachRepo` (index-store.ts:562-566) sets the repository aside, and its `knowledge_entries` / `knowledge_proposals` rows, the author name among them, stay as last indexed until the entry is removed. Nothing is lost, and ADR 0024:155 now states that a refused repository is not rebuilt. This only notes that the set of refusals that freeze rows has widened (Rubric Q5, Q6).
- F-2 · advisory · src/modules/knowledge/migrations/0006_knowledge_store.sql:19 · Carried, unchanged. The `DELETE FROM meta` of the three withdrawn-module keys cannot be undone. Its reason is stated at :17-18. It runs in the same `BEGIN IMMEDIATE` as the drops and after the pre-upgrade backup, which rotates out. Round four's open question is now answered by probes/withdrawn-module-meta-rows.md (round-four section): the keys have no other writer in `src/` or `scripts/` of the archived branch, and no release tree (v0.6.0) carried the module (Rubric Q1).
- F-3 · advisory · src/modules/knowledge/store.ts:302 · Carried, code unchanged. `settle` takes the fingerprint after the commit, so a file added by hand during the write's git calls is counted but never read. This is a stated known limit (Rubric Q3).
- F-4 · advisory · src/store/db.ts:75 · Carried. The one-time `VACUUM INTO` backup runs under the write lock on a store that ran the withdrawn module. This is stated but has not been timed (Rubric Q6).
- F-5 · advisory · src/modules/knowledge/resolve.ts:94 · Carried. `project_aliases` is read by `project_id`, which has no index. `learnAliases` (repo.ts:684 and :687) reads it twice on a write path, off the hook path, and the table is small (Rubric Q2).

What I checked against the code for this round:
- **Round four's F-1 is closed.** ADR 0024:155 now says a refused repository is not rebuilt, and that its rows, the name among them, stay until it is accepted again or its folder is removed. The code that keeps them (index-store.ts:590-599 removes rows only where the folder is gone) is as described.
- **learnAliases moving HEAD (repo.ts:693-702).** It moves HEAD through `commitChange` and clears the record without touching the index. This does not make the rows and the files drift apart:
  - The index holds nothing from `knowledge.json`. Migration 0006 has no manifest column, `knowledge_repos.project_id` is not changed by adding aliases, and `fingerprintOf` lists only the entry and proposal folders.
  - On the write that follows, `settle` records the new HEAD, which already includes the alias commit, and that is correct.
  - On a read path (`list`), `ensureFresh` sees the head mismatch and rebuilds.
  - `learnAliases` runs only with `create`, so `inEachRepo`'s `openRepo(store, found.ref)` never moves HEAD.
  - When the commit fails and the undo succeeds, `commitChange` clears the record itself (repo.ts, its catch) and the outer `clearIntent` is not reached. When the undo fails, the record stays for the next open. Either way the error thrown is the commit's.
  - The `written` hash and the bytes written both come from `file.text`, so the next open's revert recognises the manifest as the engine left it.
- **commitChange and store.commit.** `undisturbed` is still computed before any write (store.ts:284-285). A failed commit rolls back the files and staging and touches no row. Rows change only in `settle`'s single `withWrite`.
- **A repository set aside in the middle of a command:**
  - In `adopt`, the nested-repository refusal (store.ts:784-789) is thrown before `writeIntent` (:842) and `keepBytes` (:851), so a set-aside adopt has written nothing.
  - A refusal raised later, from `rebuildRepo` at :886 after the commit, would leave HEAD ahead of the index and a record whose paths are clean against HEAD. The next open clears the record, and `ensureFresh` rebuilds on the head mismatch, so nothing stays apart.
  - In `list`, each repository's rows are read after its own `ensureFresh` and printed after the loop. A rebuild that throws rolls back its one transaction (index-store.ts:516-524), so rows are either rebuilt whole or left as before.
- **Kept bytes and records.** They are read whole now (`NO_CAP`, repo.ts:1068). This closes the mismatch where `keepBytes` wrote without a cap but `restoreKept` read under 64 MiB, so a large adopt no longer loses the person's kept bytes on restore. `dropKept` (repo.ts:1161-1163) removes only names matching `KEPT_NAME` inside `.git`, and a link there is now refused before this point.
- **Personal data.** No column or table changed. The writer's name is in the record under `.git/` for the span of each write, as before, and is cleared on success, on a failed write whose undo succeeds, and at the next open. The adopt commit message now replaces control characters in path names (store.ts:865), which does not change what personal data is stored.

## Outside the change
- src/store/migrations/0001_init.sql:14 · `project_aliases` has no index on `project_id`. This is debt (advisory).

## Not answerable
- Q6 Availability · Carried: the first open's backup and drops under the write lock have not been timed on a real store that ran the withdrawn module.
