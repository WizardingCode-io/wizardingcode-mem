# Report: Memory quality: knowledge, not records of a session (spec docs/superpowers/specs

- Work: `2026-10-15-001-memory-quality-knowledge-not-records-of`
- Type: feature. Kind: feature. Route: full (risk areas: data-migration)
- CTO plan: none
- Packs: none
- Checklists: none read
- Verdict: **Proven**

## Knowledge

- none
- Learned: not yet

## Acceptance criteria

| Id | Kind | Criterion | Test-first |
| :- | :- | :- | :- |
| AC-1 | behavior | AC-1 Host framing text and the sentences named in the noise filter never reach the judge; each drop is named | red then green |
| AC-2 | behavior | AC-2 A turn whose candidates the filter empties is skipped without a judge request | red then green; the red recorded 2 times (the latest decides) |
| AC-3 | behavior | AC-3 A memory is stored only when its title sentence is knowledge (KNOWLEDGE_THRESHOLD); the Context line needs 5 prompt words | red then green; the red recorded 2 times (the latest decides) |
| AC-4 | behavior | AC-4 Judge version 2: knowledge_<i> questions, reader in the state, contrastive criteria; golden floors hold for both judges with re-recorded answers | red then green; the red recorded 3 times (the latest decides); the green recorded 2 times (the latest decides) |
| AC-5 | behavior | AC-5 Heuristic version 2 penalises report sentences and discounts a mostly-report answer | proven by T-4 (child 2026-11-06-001-t-4-of-2026-10-15-001-memory-quality-kno, merged ef17a98) |
| AC-8 | behavior | AC-8 The proof script measures the metrics of spec section 6 on a read-only copy and rehearses the cleanup with undo | superseded by AC-11 (2026-11-06); own record: missing |
| AC-9 | behavior | AC-9 The noise filter has no protocol-tag or verdict pattern: such sentences reach the judge | red then green |
| AC-10 | preserve | AC-10 The import rejudge keeps the version 1 questions and stamps judge_version 1 | proven by T-5 (child 2026-11-06-001-t-5-of-2026-10-15-001-memory-quality-kno, merged f2a82b2) |
| AC-11 | behavior | AC-11 The proof script measures the metrics of the spec on a read-only copy, with TypeSafe verdicts only and injections bounded to the turn's end | red then green |
| AC-12 | behavior | AC-12 host-frame matches only the host's fixed lines at the start of a sentence: a sentence quoting one mid-sentence reaches the judge | red then green |
| AC-13 | behavior | AC-13 stripHost removes an unclosed block tag to the end of the text only when it opens a line outside code; a tag named in prose or backticks removes nothing | red then green |
| AC-14 | behavior | AC-14 The judge's user_prompt and assistant_final_message, and the Context line, hold no host block and no dropped sentence | red then green |

## Gates

| Gate | Target | Status | Command | Duration | Log |
| :- | :- | :- | :- | -: | :- |
| secrets | . | pass | `built-in secret scan` | 37 ms |  |
| prose | . | pass | `built-in prose scan` | 48 ms |  |
| build | . | pass | `bun run build` | 2158 ms | logs/build-_-1794154234974.txt |
| test | . | pass | `bun run test` | 56580 ms | logs/test-_-1794154237161.txt |
| lint | . | pass | `bun run lint` | 235 ms | logs/lint-_-1794154293741.txt |
| typecheck | . | pass | `bun run typecheck` | 293 ms | logs/typecheck-_-1794154293976.txt |

## Judgement gates

| Gate | Verdict | Reviewer | Findings | Tokens |
| :- | :- | :- | -: | -: |
| code-quality | proven | review-code-quality | 6 | 72908 |
| test-quality | proven | review-test-quality | 5 | 90655 |
| security | proven | review-security | 3 | 55322 |
| risk | proven | review-risk | 6 | 65419 |
| architecture | proven | review-architecture | 4 | 86652 |
| data | proven | review-data | 4 | 60097 |

- code-quality: src/judge/questions.ts:197 Upheld as advisory (question 4/9). The perSentence guard's ': 0' arm is reached only by a unit test, because rejudge's asInput always sends candidates: []. It keeps the DistillInput.wording contract consistent, so it is not a dead path. (advisory)
- code-quality: scripts/proof/quality.ts:286 Upheld as advisory (question 9). The check result.verdict?.source !== judge.name cannot be true once readingOf has returned 'emptied' for a turn with no candidates. It is kept as an AC-11 safeguard (TypeSafe verdicts only). (advisory)
- code-quality: src/distill/pipeline.ts:133 Upheld as advisory (question 2). buildDraft sorts known with surestFirst twice, at lines 133 and 138. One sorted array would serve both. This is boilerplate-sized. (advisory)
- code-quality: src/distill/pipeline.ts:189 Upheld as advisory (question 8). PreparedTexts and TurnTexts (line 254) are exported, but nothing imports them by name. (advisory)
- code-quality: scripts/proof/quality.sh:27 Upheld as advisory (question 6). One header comment line runs past the wrapping of the lines around it. Style only. (advisory)
- code-quality: src/judge/heuristic.ts:148 Lowered to advisory as debt: the diff did not write this line. hasDurable still uses a hard-coded 0.5 while KNOWLEDGE_THRESHOLD is 0.45, so a sentence scoring 0.45 to 0.5 can count as knowledge in buildDraft while the turn's worth stays capped. (advisory)
- test-quality: tests/unit/heuristic-judge.test.ts:398 Upheld as advisory (AC-5, question 1; mutant reasoned about, not run). The mostly-report discount is proven only on answers that are all report. Raising REPORT_SHARE from 0.6 to 1.0 would survive. One 3-of-5 case would pin the 'mostly' boundary. (advisory)
- test-quality: tests/unit/heuristic-judge.test.ts:406 Upheld as advisory (AC-5, question 6). probes/report-discount-removed.txt shows this test still passing with REPORT_DISCOUNT removed: its result comes from the !hasDurable cap, not from the discount its name claims. The criterion stays proven by line 398. (advisory)
- test-quality: tests/integration/quality-proof.test.ts:231 Upheld as advisory (AC-1/AC-11, question 1). The report's per-pattern drop line and its 'Quoted candidates the filter dropped' section are never asserted. Each drop is proven at the filter level in tests/unit/noise.test.ts, so only the report's wording is unpinned. (advisory)
- test-quality: tests/golden/judges.test.ts:21 Upheld as advisory (AC-4, question 2, partial). The replaying judge looks answers up by turn id, so changing the version 2 instructions would not force a re-recording. The wording is pinned separately in tests/unit/questions.test.ts:32-40. This is about how fresh the recording is, not about the criterion. (advisory)
- test-quality: tests/unit/typesafe-judge.test.ts:390 Lowered to advisory as debt, outside the change: the withFallback stubs still declare typesafe version '1'. Harmless to this item. (advisory)
- security: scripts/proof/quality-brief.md:5 Upheld as advisory (question 4, personal-data). The default labeller is the runtime's own agent, so the sampled turn text reaches that model's provider. The brief states this, and --projects/--exclude-projects narrow the draw. The header claim in quality.ts:10-11 covers only the script. This is a choice the author makes, not a send by the code to a broader audience. (advisory, outside the change)
- security: scripts/proof/quality.sh:72 Upheld as advisory (question 4, retention/erasure). The work-dir copy of the whole store is outside forget/compact. Deletion by hand is stated (quality.sh:22-25, ADR 0023:21) and umask 077 applies. A reminder at the end of the run would be hardening. (advisory)
- security: scripts/proof/quality.sh:77 Upheld as advisory (question 1, hardening). A work dir containing a single quote breaks sqlite3's .backup dot-command. Only the author passes this argument, and the live database is opened -readonly, so no caller path crosses a boundary. (advisory)
- risk: src/distill/pipeline.ts:319 Upheld as advisory (question 1). The three skip reasons write the same 'skipped' state with no counter. The spec states this risk (spec:299), the proof measures the filter's and the judge's losses on the real store before release, and fewer memories show in the viewer. That is a way to see it, so this is not the rubric's 'failure nobody would see'. A drain-side counter would make the first hour safer, which is advisory. (advisory)
- risk: docs/superpowers/specs/2026-10-14-memory-quality-design.md:292 Upheld as advisory (question 2/5). Rolling back does not re-distil turns that v2 skipped, and recovery rests on the undesigned D-1 inside compact's 90-day window. The spec and ADR 0023:22 state the dependency and its window, so it is a stated, manual rollback, not an unstated dependency. (advisory, outside the change)
- risk: src/distill/noise.ts:52 Upheld as advisory (question 1). stripHost can cut the rest of a final answer at an unclosed host tag that opens a line outside a fence, and the live drain records nothing. The proof counts it (1 turn on B). Nothing is deleted from the store: the turn text stays. (advisory)
- risk: scripts/proof/quality.sh:24 Upheld as advisory (question 6). Deleting the work-dir store copy is a manual step that is named but has no owner and no reminder at the end of a measure run. (advisory)
- risk: src/distill/pipeline.ts:307 Lowered to advisory as debt, outside the change: turns has never recorded why a turn was skipped. (advisory)
- risk: src/store/compact.ts:12 Lowered to advisory as debt, outside the change: compact's 90-day text window existed before this item. (advisory, outside the change)
- architecture: src/judge/types.ts:40 Upheld as advisory (question 3). The doc comments on durable and titleIdx still give the version 1 meanings. Spec section 7 and ADR 0023 declare that the field names are kept, so this is not undeclared drift. Reword the comments. (advisory)
- architecture: src/distill/pipeline.ts:117 Upheld as advisory (question 5). Spec section 8 places the decision rules in policy.ts, but buildDraft in pipeline.ts applies them. buildDraft already lived there, so no boundary is crossed. Move the rules, or reword section 8. (advisory)
- architecture: src/distill/pipeline.ts:68 Upheld as advisory (question 6). Exports used only by the proof (storedDetail, toldInSession, unfilteredTexts, and heuristicJudgeV1, which the reviewer placed at heuristic.ts:869 but which is at src/judge/heuristic.ts:256) widen src/'s surface. This matches the precedent of scripts/proof/moments.ts. (advisory)
- architecture: src/distill/pipeline.ts:173 Lowered to advisory as debt: the SQL inside toldInSession in the distill layer predates the change; the diff only added bounds to it. (advisory)
- data: scripts/proof/quality.ts:158 Upheld as advisory (question 2). The correlated NOT EXISTS over memories has no covering index. It is an offline query on a copy, never on a hook or drain path, so the cost is time only. (advisory)
- data: scripts/proof/quality.ts:114 Upheld as advisory (question 1). openDb migrates the work-dir copy. The live store is only read (sqlite3 -readonly .backup), so 'read-only' in AC-11 describes the live store, not the copy. (advisory)
- data: scripts/proof/quality.sh:22 Upheld as advisory (question 5). Retention of the work dir's copy and samples is stated as deletion by hand, behind umask 077 and a location guard. Erasure depends on the author remembering. (advisory)
- data: src/store/migrations/0001_init.sql:137 Lowered to advisory as debt, outside the change: injections_once is partial, so toldInSession's filter on session_id alone scans injections. That predates this item. (advisory, outside the change)

## Verifications

| What | Ref | Answer | Confidence | Model | At |
| :- | :- | :- | -: | :- | :- |
| defect | code-quality scripts/proof/quality.ts:197 | yes 0.97 | 0.97 | jev-1.14.0 | 2026-11-08T15:14:39.388Z |
| defect | test-quality scripts/proof/quality.sh:73 | yes 0.96 | 0.96 | jev-1.14.0 | 2026-11-08T15:14:39.388Z |
| defect | test-quality tests/unit/noise.test.ts:107 | no 0.67 | 0.33 | jev-1.14.0 | 2026-11-08T15:14:39.388Z |
| defect | test-quality tests/integration/quality-proof.test.ts:231 | yes 0.98 | 0.98 | jev-1.14.0 | 2026-11-08T15:28:05.814Z |

## Team

- Primary team: backend (the session)

| Seat | Team | Reason |
| :- | :- | :- |
| researcher | researchers | full route |
| review-code-quality | backend | full route |
| review-test-quality | qa | full route |
| review-security | security | full route |
| review-risk | architects | full route |
| review-architecture | architects | full route |
| review-data | etl | risk area data-migration |
| lead-qa | qa | full route |
| lead-security | security | full route |
| lead-architects | architects | full route |
| lead-etl | etl | risk area data-migration |
| judge |  | a gate is planned |

- Rounds: judgement 4 of 2, validation 0 of 2
- Runtimes: claude (context at start: enforced; the status line per prompt: enforced; the denial of engine files: enforced; the denial of forbidden commands: enforced; the hold at Stop: enforced; the roles' answers filed: enforced; the roles read-only: enforced)

## Validations

| What | By | Verdict | Returns | Round | File |
| :- | :- | :- | -: | -: | :- |
| delivery | lead-etl | validated | 0 | 1 | conclave/lead-etl.delivery.md |
| delivery | lead-architects | validated | 0 | 1 | conclave/lead-architects.delivery.md |
| delivery | lead-qa | returned | 2 | 1 | conclave/lead-qa.delivery.md |
| delivery | lead-security | returned | 2 | 1 | conclave/lead-security.delivery.md |
| delivery | lead-security | validated | 0 | 2 | conclave/lead-security.delivery-reply.md |
| delivery | lead-qa | validated | 0 | 2 | conclave/lead-qa.delivery-reply.md |
| delivery | lead-etl | validated | 0 | 2 | conclave/lead-etl.delivery-reply.md |
| delivery | lead-architects | validated | 0 | 2 | conclave/lead-architects.delivery-reply.md |

## Gap round

- D-1: What happens to the rejudge distilled cleanup (AC-6, AC-7) after spec review round 1? → Separar num item novo: este item entrega AC-1 a AC-5 e a prova sem o ensaio da limpeza; a limpeza volta a ser desenhada noutro item, by the user, relayed by the agent
- D-2: Does the import rejudge move to the version 2 questions? → Fixar o rejudge em v1: as importadas não mudam nesta entrega, by the user, relayed by the agent
- D-3: Do protocol-tag (0.88) and verdict (0.80) stay in the noise filter below the 97% entry rule? → Tirá-los já: só ficam os padrões medidos, by the user, relayed by the agent
- D-4: Who labels the proof's samples, and from which projects? → Deveria ser configurável; o default depende do runtime que o cliente está a utilizar, by the user, relayed by the agent
- D-5: Is there a ceiling on version 2 input tokens per turn? → Teto: no máximo 2× os tokens de entrada da v1 medida, by the user, relayed by the agent
- D-6: What gate protects keyless users (heuristic version 2) before the merge? → Sem regressão face à heurística v1, by the user, relayed by the agent
- D-7: After round 2 fixes: a third review round or accept? → Corrigir e fazer a 3.ª ronda, by the user, relayed by the agent
- D-8: Heuristic version 2 has no gain target: keep the report penalties or drop them? → Manter as penalizações, com meta: a heurística v2 tem de guardar menos registos do que a v1 nas amostras B e S, by the user, relayed by the agent
- D-9: TypeSafe price and duration in the spec? → Só o medido: custo e duração medidos pela prova e registados no ADR, by the user, relayed by the agent
- D-10: Round 3 at 23 Majors after stages 5-7: stop or finish the round? → Acabar a 3.ª ronda e decidir depois, by the user, relayed by the agent
- D-11: Round 3 stopped on no progress (31 vs 29 Blockers and Majors): accept, go on, or redraft? → Corrigir tudo isto e aceitar, sem 4.ª ronda, by the user, relayed by the agent
- D-12: Sample B missed two targets (records 24% vs ≤15%; version 2 loses 11 turns version 1 kept): accept with the losses named, recalibrate on a fresh sample, or not merge? → 1 — aceitar as perdas e os records que ficam, com nome; ADR accepted com as duas metas falhadas registadas, by the user, relayed by the agent
- D-13: AC-4 has no test-first record after the forced merge of T-6: reproduce the red against the pre-T-6 questions now, or leave the item not proven? → Reproduzir o red: as perguntas de antes da T-6 (ef17a98) postas temporariamente, red gravado agora, depois o código atual e o green; o relatório diz que o red foi reproduzido depois do código, by the user, relayed by the agent
- Debate: none

## Mail

| Message | Thread | At | Direction | With | Type | Priority | Subject | Status | Contracts |
| :- | :- | :- | :- | :- | :- | :- | :- | :- | :- |
| M-2026-11-06-001-ai-mem | - | 2026-11-06T15:29:54.126Z | sent | ai-mem/T-4 | change-request | normal | T-4 of 2026-10-15-001-memory-quality-knowledge-not-records-of | done (proven, crew/2026-10-15-001/T-4) | - |
| M-2026-11-06-002-ai-mem | - | 2026-11-06T15:29:54.325Z | sent | ai-mem/T-5 | change-request | normal | T-5 of 2026-10-15-001-memory-quality-knowledge-not-records-of | done (proven, crew/2026-10-15-001/T-5) | - |
| M-2026-11-06-003-ai-mem | M-2026-11-06-002-ai-mem | 2026-11-06T15:36:32.924Z | received | ai-mem/T-5 | change-request | normal | Re: T-5 of 2026-10-15-001-memory-quality-knowledge-not-records-of | read (proven, crew/2026-10-15-001/T-5) | - |
| M-2026-11-06-005-ai-mem | M-2026-11-06-001-ai-mem | 2026-11-06T15:39:20.997Z | received | ai-mem/T-4 | change-request | normal | Re: T-4 of 2026-10-15-001-memory-quality-knowledge-not-records-of | read (proven, crew/2026-10-15-001/T-4) | - |
| M-2026-11-07-001-ai-mem | - | 2026-11-07T10:52:28.234Z | sent | ai-mem/T-6 | change-request | normal | T-6 of 2026-10-15-001-memory-quality-knowledge-not-records-of | blocked: unproven: gates have not run (unproven, crew/2026-10-15-001/T-6) | - |
| M-2026-11-07-002-ai-mem | M-2026-11-07-001-ai-mem | 2026-11-07T10:58:25.496Z | received | ai-mem/T-6 | change-request | normal | Re: T-6 of 2026-10-15-001-memory-quality-knowledge-not-records-of | read (unproven, crew/2026-10-15-001/T-6) | - |
| M-2026-11-07-003-ai-mem | - | 2026-11-07T21:16:02.521Z | sent | ai-mem/T-7 | change-request | normal | T-7 of 2026-10-15-001-memory-quality-knowledge-not-records-of | refused: dropped by the user | - |

## Roles

| Role | Model | Personality | At | Tokens | Answer | Filed by |
| :- | :- | :- | :- | -: | :- | :- |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-06T13:34:53.848Z | 126286 | spec-review/goldfish-zoom-out.round2.md | hook |
| goldfish-comprehension | claude-opus-5-5 | - | 2026-11-06T13:37:42.629Z | 115706 | spec-review/goldfish-comprehension.round2.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-06T13:38:54.161Z | 21762 | spec-review/goldfish-structural.round2.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-06T13:38:57.148Z | 24059 | spec-review/goldfish-style.round2.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-06T13:40:13.103Z | 52572 | spec-review/goldfish-design.round2.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-06T13:42:28.086Z | 122171 | spec-review/goldfish-zoom-out.round3.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-06T13:47:22.837Z | 205631 | spec-review/goldfish-readiness.round2.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-06T13:49:42.111Z | 250657 | spec-review/goldfish-codebase.round2.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-06T14:17:59.462Z | 95918 | spec-review/goldfish-zoom-out.round4.md | hook |
| goldfish-comprehension | claude-opus-5-5 | - | 2026-11-06T14:19:48.556Z | 85711 | spec-review/goldfish-comprehension.round3.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-06T14:20:45.744Z | 23912 | spec-review/goldfish-structural.round3.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-06T14:20:50.583Z | 23748 | spec-review/goldfish-style.round3.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-06T14:21:57.701Z | 46599 | spec-review/goldfish-design.round3.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-06T14:23:17.585Z | 81531 | spec-review/goldfish-zoom-out.round5.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-06T14:28:09.507Z | 183802 | spec-review/goldfish-readiness.round3.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-06T14:31:16.193Z | 247609 | spec-review/goldfish-codebase.round3.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-06T14:49:48.324Z | 101204 | spec-review/goldfish-zoom-out.round6.md | hook |
| goldfish-comprehension | claude-opus-5-5 | - | 2026-11-06T14:52:34.768Z | 113256 | spec-review/goldfish-comprehension.md | hook |
| goldfish-structural | claude-opus-5-5 | - | 2026-11-06T14:53:27.829Z | 25229 | spec-review/goldfish-structural.md | hook |
| goldfish-style | claude-opus-5-5 | - | 2026-11-06T14:53:49.021Z | 26683 | spec-review/goldfish-style.md | hook |
| goldfish-design | claude-opus-5-5 | - | 2026-11-06T14:54:20.844Z | 35029 | spec-review/goldfish-design.md | hook |
| goldfish-zoom-out | claude-opus-5-5 | - | 2026-11-06T14:56:37.682Z | 91743 | spec-review/goldfish-zoom-out.md | hook |
| goldfish-readiness | claude-opus-5-5 | - | 2026-11-06T15:00:14.139Z | 129190 | spec-review/goldfish-readiness.md | hook |
| goldfish-codebase | claude-opus-5-5 | - | 2026-11-06T15:04:45.577Z | 271900 | spec-review/goldfish-codebase.md | hook |
| review-code-quality | claude-sonnet-5-5 | - | 2026-11-07T13:42:31.388Z | 52008 | review/code-quality.findings.md | hook |
| review-test-quality | claude-sonnet-5-5 | - | 2026-11-07T13:42:53.462Z | 59918 | review/test-quality.findings.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-08T15:12:24.168Z | 57207 | review/security.findings.md | hook |
| review-data | claude-opus-5-5 | - | 2026-11-08T15:12:27.740Z | 69708 | review/data.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-08T15:12:30.243Z | 69828 | review/architecture.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-08T15:12:50.263Z | 82245 | review/test-quality.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-08T15:13:02.499Z | 69962 | review/risk.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-08T15:13:11.193Z | 99848 | review/code-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-08T15:14:32.516Z | 37660 | review/ruling.json | hook |
| review-security | claude-opus-5-5 | - | 2026-11-08T15:25:15.321Z | 34688 | review/security.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-08T15:25:38.783Z | 93854 | review/test-quality.findings.md | hook |
| review-data | claude-opus-5-5 | - | 2026-11-08T15:25:47.492Z | 70256 | review/data.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-08T15:26:01.800Z | 95470 | review/architecture.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-08T15:26:12.102Z | 68108 | review/risk.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-08T15:26:16.245Z | 81727 | review/code-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-08T15:27:57.543Z | 38979 | review/ruling.json | hook |
| review-security | claude-opus-5-5 | - | 2026-11-08T15:33:17.780Z | 57656 | review/security.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-08T15:33:19.278Z | 65026 | review/risk.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-08T15:33:53.206Z | 83157 | review/architecture.findings.md | hook |
| review-data | claude-opus-5-5 | - | 2026-11-08T15:33:56.262Z | 72449 | review/data.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-08T15:34:27.193Z | 103922 | review/test-quality.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-08T15:34:57.705Z | 98829 | review/code-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-08T15:36:26.144Z | 47454 | review/ruling.json | hook |
| review-security | claude-opus-5-5 | - | 2026-11-08T15:56:33.343Z | 55131 | review/security.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-08T15:56:39.064Z | 83132 | review/code-quality.findings.md | hook |
| review-data | claude-opus-5-5 | - | 2026-11-08T15:56:41.022Z | 57314 | review/data.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-08T15:57:02.291Z | 79533 | review/architecture.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-08T15:57:27.123Z | 76283 | review/risk.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-08T15:57:54.304Z | 99415 | review/test-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-08T15:58:41.796Z | 26943 | review/ruling.json | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:07:47.522Z | 43792 | conclave/lead-etl.delivery.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:07:55.318Z | 63160 | conclave/lead-architects.delivery.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:07:59.137Z | 53683 | conclave/lead-qa.delivery.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:08:13.739Z | 54956 | conclave/lead-security.delivery.md | hook |
| review-security | claude-opus-5-5 | - | 2026-11-08T16:14:38.423Z | 49222 | review/security.findings.md | hook |
| review-code-quality | claude-opus-5-5 | - | 2026-11-08T16:15:04.562Z | 66808 | review/code-quality.findings.md | hook |
| review-data | claude-opus-5-5 | - | 2026-11-08T16:15:07.400Z | 53997 | review/data.findings.md | hook |
| review-risk | claude-opus-5-5 | - | 2026-11-08T16:15:21.326Z | 59319 | review/risk.findings.md | hook |
| review-architecture | claude-opus-5-5 | - | 2026-11-08T16:16:02.052Z | 80552 | review/architecture.findings.md | hook |
| review-test-quality | claude-opus-5-5 | - | 2026-11-08T16:16:13.711Z | 84555 | review/test-quality.findings.md | hook |
| judge | claude-opus-5-5 | - | 2026-11-08T16:17:34.744Z | 36599 | review/ruling.json | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:18:19.485Z | 111938 | conclave/lead-security.delivery-reply.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:18:29.880Z | 112642 | conclave/lead-qa.delivery-reply.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:18:35.375Z | 98847 | conclave/tech-lead-1-reply.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:18:54.352Z | 101969 | conclave/lead-etl.delivery-reply.md | hook |
| tech-lead | claude-opus-5-5 | - | 2026-11-08T16:18:55.359Z | 144295 | conclave/lead-architects.delivery-reply.md | hook |

## Tasks

| Task | Criteria | Branch | Child | Verdict | Merged | Report | State | Gate |
| :- | :- | :- | :- | :- | :- | :- | :- | :- |
| T-4 | AC-5 | crew/2026-10-15-001/T-4 | 2026-11-06-001-t-4-of-2026-10-15-001-memory-quality-kno | proven | ef17a98 | .crew/work/2026-11-06-001-t-4-of-2026-10-15-001-memory-quality-kno/report.md | briefed | pass (round 1) |
| T-5 | AC-10 | crew/2026-10-15-001/T-5 | 2026-11-06-001-t-5-of-2026-10-15-001-memory-quality-kno | proven | f2a82b2 | .crew/work/2026-11-06-001-t-5-of-2026-10-15-001-memory-quality-kno/report.md | briefed | pass (round 1) |
| T-2 | AC-9, AC-12, AC-13 | inline |  |  | inline |  | briefed | pass (round 1) |
| T-3 | AC-2, AC-3, AC-11, AC-14 | inline |  |  | inline |  | briefed | pass (round 1) |
| T-6 | AC-4 | crew/2026-10-15-001/T-6 | 2026-11-07-001-t-6-of-2026-10-15-001-memory-quality-kno | unproven | b2f483f (forced by the user) | .crew/work/2026-11-07-001-t-6-of-2026-10-15-001-memory-quality-kno/report.md | briefed | pass (round 1) |
| T-7 | AC-11 | inline |  |  | inline |  | briefed | pass (round 1) |

## Decisions

- spec approved by the agent in auto mode (2026-10-15T19:18:20.811Z): not counted, the policy waits for a person (a person runs the same command, or policy.json sets unattendedDecisions to "count")
- spec approved by the user (2026-10-15T19:31:11.833Z)
- AC-6 (behavior) removed (2026-11-06T13:51:09.646Z): AC-6 Migration 8 adds memory_reviews; NewMemory accepts sourceOrdinal
- AC-7 (behavior) removed (2026-11-06T13:51:09.722Z): AC-7 rejudge distilled supersedes, archives or keeps each version-1 distilled memory from its source turn, resumes, dry-runs without writing, and --undo restores the counts

## Waits

- for the user (2026-10-15T19:19:13.663Z), not proven: gates have not run
- for the roles (2026-11-06T13:33:05.193Z), not proven: gates have not run
- for the roles (2026-11-06T13:35:09.298Z), not proven: gates have not run
- for the roles (2026-11-06T13:38:04.198Z), not proven: gates have not run
- for the roles (2026-11-06T13:39:04.008Z), not proven: gates have not run
- for the roles (2026-11-06T13:40:43.140Z), not proven: gates have not run
- for the roles (2026-11-06T13:42:47.099Z), not proven: gates have not run
- for the roles (2026-11-06T13:47:41.401Z), not proven: gates have not run
- for the roles (2026-11-06T13:54:23.448Z), not proven: gates have not run
- for the roles (2026-11-06T14:17:08.433Z), not proven: gates have not run
- for the roles (2026-11-06T14:18:11.822Z), not proven: gates have not run
- for the roles (2026-11-06T14:20:08.031Z), not proven: gates have not run
- for the roles (2026-11-06T14:20:55.139Z), not proven: gates have not run
- for the roles (2026-11-06T14:22:20.635Z), not proven: gates have not run
- for the roles (2026-11-06T14:23:33.981Z), not proven: gates have not run
- for the roles (2026-11-06T14:28:21.933Z), not proven: gates have not run
- for the roles (2026-11-06T14:36:15.727Z), not proven: gates have not run
- for the roles (2026-11-06T14:48:34.738Z), not proven: gates have not run
- for the roles (2026-11-06T14:50:02.722Z), not proven: gates have not run
- for the roles (2026-11-06T14:52:33.555Z), not proven: gates have not run
- for the roles (2026-11-06T14:52:59.063Z), not proven: gates have not run
- for the roles (2026-11-06T14:53:37.831Z), not proven: gates have not run
- for the roles (2026-11-06T14:53:59.057Z), not proven: gates have not run
- for the roles (2026-11-06T14:55:47.427Z), not proven: gates have not run
- for the roles (2026-11-06T14:56:52.113Z), not proven: gates have not run
- for the roles (2026-11-06T15:00:24.146Z), not proven: gates have not run
- for the roles (2026-11-06T15:16:18.896Z), not proven: gates have not run
- for the roles (2026-11-06T15:32:48.523Z), not proven: gates have not run
- for a reply (2026-11-06T15:38:01.837Z), not proven: gates have not run
- for a reply (2026-11-07T10:52:42.771Z), not proven: gates have not run
- for the roles (2026-11-07T13:42:30.265Z), not proven: gates have not run
- for the roles (2026-11-07T13:42:49.499Z), not proven: gates have not run
- for a reply (2026-11-07T21:16:16.107Z), not proven: gates have not run
- for the roles (2026-11-08T12:36:39.275Z), not proven: gates have not run
- for the roles (2026-11-08T12:49:44.583Z), not proven: gates have not run
- for the roles (2026-11-08T12:50:54.568Z), not proven: gates have not run
- for the roles (2026-11-08T12:51:48.458Z), not proven: gates have not run
- for the user (2026-11-08T13:25:21.001Z), not proven: gates have not run
- for the roles (2026-11-08T14:30:30.055Z), not proven: gates have not run
- for the roles (2026-11-08T14:32:04.391Z), not proven: gates have not run
- for the user (2026-11-08T14:33:01.161Z), not proven: gates have not run
- for the user (2026-11-08T14:50:03.123Z), not proven: gates have not run
- for the user (2026-11-08T14:53:24.208Z), not proven: gates have not run
- for the roles (2026-11-08T14:55:35.647Z), not proven: gates have not run
- for the roles (2026-11-08T14:56:47.032Z), not proven: gates have not run
- for the roles (2026-11-08T14:57:12.014Z), not proven: gates have not run
- for the user (2026-11-08T14:58:42.591Z), not proven: gates have not run
- for the roles (2026-11-08T15:11:15.218Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T15:12:42.055Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T15:13:01.733Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T15:13:14.505Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T15:13:38.388Z), not proven: judgement gate code-quality not run
- for the roles (2026-11-08T15:16:34.599Z), not proven: code changed since the last gate run
- for the roles (2026-11-08T15:24:32.675Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:25:26.138Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:26:44.702Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:32:32.070Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:33:33.723Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:34:08.286Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:34:37.929Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:35:15.718Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:55:45.010Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:56:51.261Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:57:10.851Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:57:37.617Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T15:58:13.558Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T16:13:49.696Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T16:14:47.128Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T16:15:18.661Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T16:15:30.279Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T16:16:11.699Z), not proven: judgement gate code-quality not run on the current code
- for the roles (2026-11-08T16:16:35.128Z), not proven: judgement gate code-quality not run on the current code

Fingerprint: sha256:e66ddfb48ae4308c657a1dd3a3e7f0ff4e19483c99814dd9d5a719a1eb5b7925
