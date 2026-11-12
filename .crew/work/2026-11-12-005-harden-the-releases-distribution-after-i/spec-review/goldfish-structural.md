# structural findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: goldfish-structural
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-005-harden-the-releases-distribution-after-i/spec.md (whole, lines 1-116), /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-feature.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-heilmeier.md

## Findings
- F-1 · Nit · ## Design (line 39) · the rubric's "Proposed architecture" section is titled "Design" and is a list of changes per file, with no named components or data flow (token -> encodedCredential -> gitEnv / redact / tokenMask -> stdout and summary)
- F-2 · Nit · ### Alternatives (line 77) · the rubric's "Alternatives considered" is not a section of its own: it is an unnumbered third-level heading under Design, beside the numbered subsections 1-4
- F-3 · Nit · ## Risks and rollback (line 102) · named differently from the rubric's "Risks and mitigations", and the rollback text belongs under the rubric's non-functional "rollout and rollback", which says only "None beyond the above"
- F-4 · Nit · headings throughout · capitalisation is mixed: "Goals and Non-Goals", "Open Questions", "Critical User Journeys", "Non-Functional Requirements" are title case, while "Acceptance criteria", "Risks and rollback", "Out of scope" are sentence case
- F-5 · Nit · ## Open Questions (line 30) · says "None." and then states something unresolved (whether `::add-mask::` reaches the step summary); Risks (line 106) says the same thing again
- F-6 · Nit · ## Out of scope (line 115) vs Non-goals (lines 22-26) · two lists of what is excluded, which overlap (the staged binary's version rule) and differ (only Out of scope lists `plan`'s ruleset check, the older jobs and the `latest` job), so neither one is complete
- F-7 · Nit · ## Acceptance criteria (lines 89-98) · the ids are out of order (AC-9, 10, 11, 12, then AC-6, 13, 18, 15, 16, 17), and no AC names the goal (G-1 to G-4) it covers
- F-8 · Nit · ### 2 (line 65) vs AC-17 (line 98) · the moved-tag summary ends with "…" in Design but with no ellipsis in AC-17, so it is unclear which text the test should match
- F-9 · Nit · ## Critical User Journeys J-4 (line 37) · one bullet holds a given/when/then plus the full runbook procedure and its exception, and Design 3 uses it as the runbook text. J-3 (line 36) packs two givens with separate thens into one journey
- F-10 · Nit · whole document vs spec-heilmeier.md · questions 6 (cost) and 7 (how long) have no answer, and no midway check is stated for question 8

## Not answerable
- Whether the cited paths (`scripts/release/push.ts`, `docs/real-use/findings.md`, ADR 0029, `concepts_brief.md`, the test files) exist and match what the spec says about them · this is a structural review limited to the document and its two standards
