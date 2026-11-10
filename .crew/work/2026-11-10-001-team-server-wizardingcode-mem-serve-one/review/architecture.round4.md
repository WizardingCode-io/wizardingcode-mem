# architecture findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-architecture
read: the rubric; review/architecture.round3.md; docs/adr/0026-team-server.md in full; CLAUDE.md:16 (the team-server bullet); src/team/db.ts in full; src/team/errors.ts in full; src/team/store.ts:540-660 (revisionAt, PendingKey, PENDING_SQL, pendingRevisionsAfter, forEachRevision, checkpointWal); src/team/mirror.ts:340-720 (pendingRevisions, owedReplay/noteOwed, runMirror, replayFolders/replayOwed, eraseEntry/eraseMemory, purgeItem); src/team/push.ts:145-175 (deviceAlias, memoryFeedUid); src/team/server.ts:195-230 (the hourly tick); the import lines of every src/team/*.ts file; the 34 source files in review/files.txt by their imports, the round-4 changes read whole

Round 3 advisories, now:
- F-1 (the "nothing else of the module" wording) is answered. "The mirror" (ADR line 74) now names everything the server takes, and it matches the imports:
  - the runner with its stage, commit, remove and folder-name helpers; `writeFileAtomic`, `headOf` and `hashOf` from repo.ts;
  - the entry format from entry.ts: the parser, the slug and area checks, the size cap and `slugify`;
  - the `Identity` and `KnowledgeEntry` types;
  - the closing line "the module's formats and git helpers, never its store or its hooks".

  The imports in mirror.ts:7-18, validate.ts:5-14, server.ts:3, status.ts:6 and instance.ts:4 stay inside that list.
- F-2 (db.ts and CLAUDE.md said "two reads") is answered. The db.ts header (lines 4-6) and CLAUDE.md:16 now name the same four statements as ADR D-1 and line 48: the version read, the schema check, `secure_delete` and migration 1's identity write. The code matches at db.ts:28, 51, 61-70 and 75.

The round-4 changes hold the stated boundaries:
- **Every SQL statement in store.ts.** All the new SQL is in store.ts: the truncating checkpoint (`checkpointWal`, store.ts:637), the keys-only pending query (`PendingKey` and `PENDING_SQL`, store.ts:574-594) and the per-row fetch (`revisionAt`, store.ts:552). mirror.ts (lines 368, 479, 550, 698, 717), feed.ts:117 and server.ts:217 call these functions and hold no SQL. `unknownItem` (errors.ts:55) keeps errors.ts a leaf with no imports. `deviceAlias` (push.ts:153) reaches the database only through the store's `deviceById`.
- **types.ts a leaf.** It is unchanged: it holds only `import type` lines (db, limits, log, signal), and no new module imports it at runtime.
- **The one-process assumption.** The hourly checkpoint runs on the server's own connection, on the process's own timer, and only while no export child is running (server.ts:217). That is what ADR line 78 states. A CLI purge beside the server takes the mirror lease first, so it does not run during an export. Nothing adds state that a second process would have to share. The replay note `mirror.replay` lives in `meta` and is written inside the erasure's transaction (mirror.ts:682-696). That is the same pattern as the leases and `mirror.last`.
- **The replay note's rules match ADR line 78.** A purge merges its folders into the note (mirror.ts:396-407). An unreadable note becomes a rebuild, both at the next purge (line 402) and at the next run (line 465). `--rebuild` clears the note (line 469). The note is cleared only after a replay with no failures (line 587).

## Findings
- F-1 · advisory · docs/adr/0026-team-server.md:52 · "The data model" lists `meta` as "the ids, the leases, `mirror.last`". The change also keeps two other `meta` keys:
  - `mirror.replay` (mirror.ts:380), which line 78 names;
  - `mirror.rebuild` (mirror.ts:375), which no line of the ADR names: a rebuild cut midway is finished by the next run because of it.

  Each is state that decides what the next run does. Fix: add both keys to the `meta` clause on line 52.
- F-2 · advisory · src/team/push.ts:153 · `deviceAlias` and `memoryFeedUid` (push.ts:153-158) and `parseFeedUid` define how a memory is named in the feed. Feed and mirror code both use them, and mirror.ts:25 now imports three helpers from the push handler. The folder's neighbouring convention keeps a key's format in ids.ts (`memoryKey`, `splitMemoryKey`) or in the store. This crosses no boundary the ADR draws. Fix, if wanted: move the feed-uid helpers beside `memoryKey` in ids.ts, with `deviceAlias` taking the alias from its caller or staying a store-backed helper outside push.ts.

## Outside the change
none

## Not answerable
none
