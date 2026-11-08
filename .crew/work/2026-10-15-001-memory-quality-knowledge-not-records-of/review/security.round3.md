# security findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-security
read: 7 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:75 · The work dir goes into the sqlite3 dot-command inside single quotes (`".backup '$DATA/wizardingcode-mem.db'"`), so a work-dir path with a `'` breaks the copy command or changes it. Only the operator supplies this path and nothing crosses a privilege boundary, so this is hardening, not a defect.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:237 · `sample-*.json`, `full.md` and `verdicts.json` are copies of the author's redacted turn text (or verdicts derived from it) placed outside the store. The mem's own forget, compact and restore paths never reach them, and nothing removes them. The files are owner-only (`quality.sh:28`, umask 077) and the script's header says never to commit them, but no step tells the author to delete the work dir after the proof, so erasure there is manual.
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/docs/adr/0023-memory-quality.md:30 · The script sends turn text only to TypeSafe (`quality.ts:403-411`; `quality.sh:82-93` passes only the key through and unsets every other TYPESAFE_*/WIZARDINGCODE_* variable). However, the ADR records that the samples, which hold the author's text, were labelled by Claude Code subagents. So in the real run the data did leave for a second model provider. This was the author's choice (D-4) and is outside the script's path, but line 21 ("the proof sends nothing to a model but TypeSafe") would be clearer if it said the labeller sees the samples.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/src/judge/index.ts:39 · `WIZARDINGCODE_MEM_TYPESAFE_URL` points the judge, and so the key and the turn text, at any endpoint the environment names. `quality.ts:405` honours it the same way when run directly, without `quality.sh`. The exposure is not new; it is the production judge's existing behaviour (debt).

## Not answerable
- none

Notes on the questions:
- Boundary: `quality.sh` and `quality.ts` refuse a work dir, copy or labels file inside the repository or any live data or store directory, checked by real path (`quality.sh:58-69`, `quality.ts:98-113`, `quality.ts:329`). Labels are checked against the sample (`quality.ts:337-357`). The live store is opened only through `sqlite3 -readonly .backup` (`quality.sh:75`), and `openDb` runs on the copy only (`quality.ts:114`). The `--projects` filters are bound parameters (`quality.ts:166-176`).
- Secrets: the new golden turns (`tests/golden/turns.json`) and test fixtures are synthetic and hold no credential. The key is read from the environment or the live env file and is never written or logged.
- Personal data: dropped sentences are returned in memory only and never logged (`src/distill/pipeline.ts:236-245`). `report.md` and stdout carry counts and turn ids only (`quality.ts:538-580`). The ADR names lost turns by id and category only. What TypeSafe receives in the drain is still redacted turn text, as before; the version 2 state adds only a fixed `reader` constant.
- Data migration: `files.txt` lists no migration and the diff adds no schema change. The only stored-data change is `rejudge` stamping the constant `IMPORT_JUDGE_VERSION = "1"` in place of the judge's version (`src/judge/rejudge.ts`). It uses the same UPDATE as before, archives and never deletes, and leaves no new irreversible step.
