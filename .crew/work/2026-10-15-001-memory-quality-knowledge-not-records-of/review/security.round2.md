# security findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-security
read: 9 files, risk areas: data-migration, personal-data

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:237 · Only quality.sh:28 sets `umask 077`. If the author runs `bun scripts/proof/quality.ts` directly, as its header at line 4 shows, the process umask decides the file modes, usually 0644. That covers sample-*.json and check-*.json (line 237-239), verdicts.json (line 488) and full.md (line 495), which hold the author's redacted turn text and memory titles, so another local user could read them. Setting the mode in the script (`writeFileSync(..., { mode: 0o600 })`) would close this; it is hardening only, because the documented route is the shell wrapper.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/scripts/proof/quality.ts:405 · When quality.ts is run directly, `WIZARDINGCODE_MEM_TYPESAFE_URL` sends the author's TypeSafe key and turn text to any endpoint the environment names. The live drain does the same today (src/judge/index.ts:39), and quality.sh:83-85 unsets every WIZARDINGCODE_* variable before it runs, so this route only exists outside the wrapper. Advisory, not a defect, because the caller is the key's owner.

## Outside the change
- none

## Not answerable
- none

Notes on the rubric questions:
- **Boundary.** The new inputs are the work-dir path and the label files. quality.sh:58-69 resolves the work dir to its real path and refuses it inside the repository, the live data dir, the live store or WIZARDINGCODE_HOME. quality.ts:108-113 checks it again through `assertNotLive`, which is not in files.txt, so it existed before this diff. The noise patterns (src/distill/noise.ts:17-71) and the regex `withoutSentences` builds (noise.ts:104-115) have no nested quantifiers, so I see no ReDoS path on turn text.
- **Secrets.** I found no credential in the files I read: the scripts, the noise filter and the redaction path. I did not open the re-recorded fixtures (tests/golden/turns.json, tests/golden/typesafe-answers.json) or the tests, which the secrets gate covers.
- **personal-data.** The live store is copied with `sqlite3 -readonly .backup` (quality.sh:75), so it is only read. Turn text sent to TypeSafe is text that was redacted when stored. In the pipeline, `stripHost` and `withoutSentences` only remove text from Redacted values (src/distill/pipeline.ts:222-243). Commands and errors are still redacted before they are clipped (pipeline.ts:105-107). Nothing is sent to any model other than TypeSafe, which the live drain already uses. report.md is anonymous (quality.ts:580 returns before the per-turn titles); full.md and the samples are written only to the work dir, and the scripts tell the author not to commit them. Retention and erasure are unchanged: the proof writes nothing to the live store.
- **data-migration.** files.txt has no migration file. `judge_version` is an existing column (src/store/migrations/0001_init.sql:81). The rejudge's version 1 stamp (src/judge/rejudge.ts:138) and the pipeline's `versions[verdict.source]` (pipeline.ts:349) write values into it, not new schema. The only migration that runs is on the work-dir copy when it is first opened (quality.ts:114).
