# security findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-security
read: 6 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · scripts/proof/quality-brief.md:5 · The brief's default labeller is the runtime's own agent (a Claude Code subagent, or Codex). That means the sampled turn text (prompt, final, candidates) goes to that model's provider, not only to TypeSafe. The brief says so, and `--projects`/`--exclude-projects` can narrow the draw, so it is the author's choice and not a leak the script makes. Still, the header of scripts/proof/quality.ts:10-11 ("sends no text to any model but TypeSafe") holds only for the script itself, and a reader of quality.sh might take it to cover the whole proof.
- F-2 · advisory · scripts/proof/quality.sh:72-79 · The proof copies the whole store, including memories and turns from every project, into `<work dir>/home/mem`, along with sample-*.json, full.md and verdicts.json. forget and compact never reach that copy. The header (lines 22-25) and the 077 umask (line 30) cover this, but nothing removes the copy or warns about it later. If the author never runs `rm -rf <work dir>`, data they have forgotten in the live store survives in the copy.
- F-3 · advisory · scripts/proof/quality.sh:77 · The work dir path is placed inside single quotes in sqlite3's `.backup` dot-command. A work dir name that contains `'` breaks the command or changes what it does. Only the author passes this argument, and the live database is opened with `-readonly`, so the live store cannot be written either way. Rejecting a path that contains `'` (or escaping it) would harden this.

## Outside the change
none

## Not answerable
none

Notes behind the answers:
- Boundary: the work dir is checked against the repository and every live data and store directory, by real path, before the copy is made (quality.sh:61-71). It is checked again in quality.ts:108 and :113, and the labels file at quality.ts:329. Both checks go through the existing `assertNotLive` (scripts/proof/live-guard.ts:15), which also catches a copy that is the same file as the live database (same device and inode). The live database is only read (`sqlite3 -readonly`). quality.ts opens only the copy (quality.ts:114). Project filters are bound parameters (quality.ts:166-176). Labels with an unknown label or no quote stop the run (quality.ts:337-352).
- Secrets: none in the diff. The key is read from the environment or the live env file and is passed only to TypeSafeJudge (quality.ts:390, :403). quality.sh unsets every TYPESAFE_*/WIZARDINGCODE_* variable and re-exports only the key, and only for `measure` (quality.sh:84-95). That also drops WIZARDINGCODE_MEM_TYPESAFE_URL, the endpoint override the live judge already honours (src/judge/index.ts:39). tests/golden/typesafe-answers.json holds recorded verdicts, not credentials.
- personal-data: what goes to TypeSafe is the same redacted turn text the live drain already sends, now with less in it. The host's framing and noise sentences are removed before the request (src/distill/pipeline.ts:637-660, :679-696), and a turn the filter empties sends nothing (pipeline.ts:683). report.md and the console get counts, turn ids and pattern names only (quality.ts:538-580). Titles and quotes go only to full.md, which is marked never to commit (quality.ts:583-617).
- data-migration: there is no migration file in files.txt and no schema change. The only migration that runs is `openDb` migrating the work-dir copy (quality.ts:114), never the live store. New distilled memories are stamped judge_version 2 (src/judge/typesafe.ts:42-45). The import rejudge keeps stamping 1 from a single constant (src/judge/rejudge.ts:39-40 and :166-172). Nothing is deleted or archived differently, so there is nothing to reverse.
