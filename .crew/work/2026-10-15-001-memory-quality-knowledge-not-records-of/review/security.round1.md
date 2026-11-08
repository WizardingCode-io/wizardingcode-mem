# security findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-security
read: 9 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:240 · `sample` writes `sample-*.json`, and `measure` writes `verdicts.json` (line 491) and `full.md` (line 498). These files hold the author's redacted turn text and titles, and they are created with the default umask (usually 0644) inside a work dir that `mkdir -p` makes 0755 (/Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:68,72). The live store is 0700/0600 (`src/store/db.ts:164,177`). So another local account could read the turn text if the author picks a world-traversable work dir such as /tmp. The database copy itself is narrowed to 0600 once `openDb` runs at quality.ts:115. This is the same pattern the neighbouring `scripts/proof/semantic.sh` uses, and the tool is for the operator only, so it is not a defect. Suggested hardening: `umask 077` in quality.sh, or `mode: 0o600` on the writes.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.sh:73 · The copy target goes into the sqlite3 dot-command inside single quotes. A work-dir path that contains `'` would break out of the `.backup` argument. Only the operator supplies this path, so no other caller has this path. The neighbour `semantic.sh:94` has the same pattern.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/semantic.sh:94 · Same unquoted-for-sqlite path and default-umask copy as F-1/F-2 (debt, not touched by this diff).

## Not answerable
none

Notes on the questions answered (no defect found):
- Boundary: `quality.ts` checks each labels file against its sample (line 331 onward). It refuses work dirs, copies and labels files that sit inside the repository or the live data/store (lines 100-114, plus quality.sh:56-67). Its SQL takes the project filter as bound parameters (lines 167-177). `toldInSession`'s new query is parameterised (`src/distill/pipeline.ts`, `toldInSession`).
- Secrets: none in the diff outside documentation. The golden fixtures use `apiKey: "recorded"` (tests/golden/judges.test.ts:32), and the new golden turns (tests/golden/turns.json) are synthetic. quality.sh unsets every TYPESAFE_*/WIZARDINGCODE_* variable and puts the key back only for `measure` (lines 80-91). The live env file is only read (`readTypeSafeKey`, quality.ts:393).
- Personal data: the proof sends turn text only to TypeSafe, with the user's own key, and that text is already redacted in the store. This is the same recipient the live drain already uses, so the audience is not broader. On the live path, `prepareTexts` (`src/distill/pipeline.ts`) now strips host blocks and noise sentences before the judge sees anything, so less text is sent than before. The `dropped` list is returned to callers only; nothing logs or stores it. The live store is copied with `sqlite3 -readonly .backup` and never written; `openDb` migrates the copy only (quality.ts:115). report.md is anonymous; full.md and the samples are marked never-commit.
- Data migration: the diff has no migration file. TypeSafe distillation now stamps `judge_version` "2" (`src/judge/typesafe.ts`). The import rejudge still stamps "1" through `IMPORT_JUDGE_VERSION` (`src/judge/rejudge.ts`). Existing rows are not rewritten, the schema does not change, and nothing is destructive. Archiving in rejudge is unchanged and still never deletes.
