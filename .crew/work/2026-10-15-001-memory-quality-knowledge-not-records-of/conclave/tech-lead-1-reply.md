I re-read the changed evidence and my verdict is still validated, with no returns: commit 8a1c2f7 closes the two data points I raised as advice last round.

# etl lead's validation of 2026-10-15-001-memory-quality-knowledge-not-records-of: delivery
verdict: validated
## Returns
none
## Notes
- **No migration is in the delivery.** `src/store/migrations/` still ends at `0007_links.sql`. AC-6 and AC-7 were removed and moved to their own item (`report.md:125` is D-1, plus the removals under Decisions), and `spec.md:33` says there is no migration in this item. The data findings now in the report confirm no schema change: the four at `report.md:78-81` are all advisory, and the one at line 81 is debt from before this item.
- **Rolling back the written rows is a release.** Distilled rows are stamped by the judge that produced them (`src/distill/pipeline.ts:349`). The import rejudge keeps version 1 from a single constant (ADR 0023 at `docs/adr/0023-memory-quality.md:19`), which holds D-2 and AC-10 (`report.md:26`).
- **The one window that cannot be undone is now stated where it is decided.** ADR 0023:22 says a turn skipped by version 2 can be recovered only until `compact` removes its text after 90 days, and that D-1 belongs inside that window. This closes my earlier advice. The architects' review also cites it at `report.md:69`.
- **Erasing the store copy is now stated.**
  - `scripts/proof/quality.sh:22-24` says the work directory holds a full copy of the store that forget and compact never reach, and that it should be deleted with `rm -rf <work dir>` once the report is taken. ADR 0023:21 repeats it.
  - The live store is only read: `sqlite3 -readonly .backup` (`quality.sh:11-12`), with `umask 077` at `quality.sh:30`.
  - That deletion is still a manual step with no reminder at the end of a run (`report.md:71`, `report.md:80`). This is hardening, not a return.
- **The read the item changed only narrows an existing filter.** `toldInSession` adds the turn-end bound and excludes the memory made from the same turn (`src/distill/pipeline.ts:180-185`), and no transaction is held across the judge call. The scan of `injections` was already there before this item (`report.md:81`).
- **The proof's queries run offline on a copy.** The correlated NOT EXISTS has no covering index, which costs time only (`report.md:78`). `openDb` migrates the copy, not the live store (`report.md:79`).
- **The gates passed on the current tree.**
  - build, test, lint and typecheck pass (`report.md:38-41`), and the test log ends with 2015 pass and 0 fail (`logs/test-_-1794154237161.txt:68-70`).
  - All six judgement gates are proven (`report.md:47-52`), and the data gate has 4 findings, all advisory.
- **The briefs are complete for my gates.**
  - T-7 names the proof files it changed and its AC-11 red then green (`tasks/T-7.brief.md:3-16`).
  - T-6 now records AC-4 red then green under D-13 (`tasks/T-6.brief.md:20`).
  - The "Left" lines in T-6 and T-7 point to the QA and security leads' returns, which belong to those teams.
- **Outside my team (no effect on data):** `spec.md:14` says `KNOWLEDGE_THRESHOLD = 0.5`, but ADR 0023:17 says 0.45 after calibration. In the code-quality finding at `report.md:59`, `hasDurable` still uses a hard-coded 0.5. Bringing the spec line in step with the calibrated value is for the QA and architects leads.

Files read (all under /Users/andreagroferreira/AIProjects/ai-mem/):
- `.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/report.md`
- `.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/tasks/T-6.brief.md`
- `.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/tasks/T-7.brief.md`
- `.crew/work/2026-10-15-001-memory-quality-knowledge-not-records-of/logs/test-_-1794154237161.txt`
- `scripts/proof/quality.sh`
- `docs/adr/0023-memory-quality.md`
