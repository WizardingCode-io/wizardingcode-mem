# structural findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: goldfish-structural
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md (lines 1-370, whole file); /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.21.0/skills/crew/rubrics/spec-feature.md; /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.21.0/skills/crew/rubrics/spec-heilmeier.md

## Findings
- F-1 · Nit · Open Questions (line 45) · The list of places the second D-9 answer would change leaves out D-2's row in the Decisions table. That row's last column says "by D-9, at every session start" and would have to change too. Otherwise the list is complete: success sentence, Goals bullet 2, D-9 row, session start, CUJ 1, AC-3, the first alternative and the first risk all exist and match.
- F-2 · Nit · Design · The rubric's "Proposed architecture" section is here under the heading "Design". The content covers components, data flow and fit, but the heading does not use the standard's name.
- F-3 · Nit · Acceptance criteria (AC-8, AC-14, AC-16, AC-17) · Two placeholder lines remain, "AC-8 (superseded by AC-16)" and "AC-14 (superseded by AC-17)". Their replacements sit out of topical order: AC-16 covers the propose tool but comes after AC-15's data returns, away from AC-6 to AC-10. A reader has to jump around to follow the tool criteria.
- F-4 · Nit · The tools (lines 203, 211, 233) · Each tool's subsection is a bold paragraph, not a fourth-level heading, so `knowledge_search`, `knowledge_get` and `knowledge_propose` do not appear in the heading outline. "Open Questions" (line 36) does the same with its bold "D-9, for the person" line.
- F-5 · Nit · Headings throughout · Heading case is mixed. "Non-Goals", "Open Questions", "Critical User Journeys" and "Non-Functional Requirements" are in title case. "Cost and time", "Alternatives considered", "Acceptance criteria" and "Risks and rollback" are in sentence case.
- F-6 · Nit · Problem and Goals · Heilmeier question 1 asks for the attempt stated with no jargon. Problem paragraph 3 rests on "the engine's composer", "ADR 0019" and "the lexical floor that ADR 0020 measured". Goals opens with `BUILT_IN`, "F5′" and "share" before any of them is explained. Problem paragraph 1 answers the question; paragraph 3 and Goals do not.
- F-7 · Nit · Opening paragraph (line 3) · The sources are one sentence of about 90 words with nested parentheses: five sources and a remark on part 1's approval status. A list would read more easily.
- F-8 · Nit · Design (lines 137, 146, 157, 216, 259) · The five fenced blocks carry no info string. They are well formed and closed, but they are not marked as plain text.

## Not answerable
- The external references (plan.md, concepts_brief.md, work.json, part 1's spec, the source files named) · I was given only the spec and the two standards, so I did not check whether the cross-references resolve.
