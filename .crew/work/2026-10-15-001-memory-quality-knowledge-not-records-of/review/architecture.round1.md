# architecture findings for 2026-10-15-001-memory-quality-knowledge-not-records-of
reviewer: review-architecture
read: the rubric; the base, meaning CLAUDE.md, the spec docs/superpowers/specs/2026-10-14-memory-quality-design.md (sections 5–9), ADR 0023 (as added by the diff), the Judge contract (src/judge/types.ts, fallback.ts, typesafe.ts, questions.ts) and the callers of distillQuestions/distillState (scripts/record-typesafe.ts, scripts/proof/quality.ts); the diff covers 31 files, and I read all the source, script, CLAUDE.md, biome.json and ADR parts. I skimmed the plan, spec and golden fixture parts.

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/judge/questions.ts:118 · The `kind` question and its `none` criterion (line 97) use the wording settled during calibration ("which kind is the most useful… classified by that sentence"; "No sentence holds knowledge…"). The spec's Design §7 (docs/superpowers/specs/2026-10-14-memory-quality-design.md:166 and :176) still gives the first wording ("mainly contain"). ADR 0023 records the change ("The kind question classifies a turn by its most useful knowledge sentence", plus calibration lever 1), so no boundary is crossed. But the spec is in this diff and now disagrees with the code it designs (rubric Q5). Fix: update §7's `kind` instructions and `none` row to match, or note there that ADR 0023 replaces them.
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/src/distill/pipeline.ts:68 · `storedDetail`, `buildDraft` (line 117) and `toldInSession` (line 173) are now exported only so that scripts/proof/quality.ts can use them. This widens the pipeline's public surface beyond the `prepareTurn`/`draftTurn` seam that the Design names as the shared start for the drain and the proof. The base says nothing on this and the neighbouring proof scripts also import from src/, so it is a convention note, not drift (rubric Q6).

No defects. Checked against the base, each with what it showed:
- **Layers (Q1).** The noise filter is pure and sits in src/distill/noise.ts. The thresholds `KNOWLEDGE_THRESHOLD` and `CONTEXT_MIN_WORDS` are in src/distill/policy.ts. The wording is in src/judge/questions.ts. The report signals are in the heuristic. Each is where the spec and CLAUDE.md put it ("Exact rules and calculations stay in code").
- **Data model (Q2).** There is no migration, as spec §12 says ("No migration"). `judge_version` keeps its meaning: the rejudge stamps '1' from `IMPORT_WORDING` (src/judge/rejudge.ts:41–42) and distillation stamps the judges' new "2". `DistillVerdict.durable` keeps its name but now means the knowledge probability. Spec §7 and ADR 0023 both state this, and the code says it in comments (pipeline.ts buildDraft, questions.ts:194).
- **Contracts (Q3).** `DistillInput.wording?: 1 | 2` (src/judge/types.ts:31) is the field the Design names, with the default 2. The heuristic ignores it, as specified. The only other caller of the question builders, scripts/record-typesafe.ts, keeps the default, which is the version 2 the golden recordings need.
- **Integrations (Q4).** The proof reaches TypeSafe only through `TypeSafeJudge` (scripts/proof/quality.ts:406), wrapped by a cache that keeps the Judge interface. It reads the key through `readTypeSafeKey`, opens the copy with `openDb()` and resolves paths with `resolvePaths`, as CLAUDE.md requires. The live database is only read, with `sqlite3 -readonly .backup` (scripts/proof/quality.sh).
- **Design (Q5).** The pipeline order (told-notes, stripHost, segment, dropNoise, skip with no request, judge on the filtered texts, then the draft), the `toldInSession` bounds, the title-must-be-knowledge policy and the import rejudge's version 1 all follow spec §§5–9.

## Outside the change
none

## Not answerable
none
