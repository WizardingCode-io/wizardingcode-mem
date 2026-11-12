# structural findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: goldfish-structural
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-006-the-client-learns-of-a-release-and-its-s/spec.md (whole, lines 1-167), /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-feature.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-heilmeier.md

## Findings
- F-1 · Nit · AC-23 (line 136) vs G-3 (line 21) · AC-23 cites G-3, but G-3 cites only AC-26, so the goal-to-criterion links do not match both ways. AC-23 tests `reconciles` and `decide`, which belong to the hand-over (G-4), not the telling (G-3), so the G-3 citation is probably wrong.
- F-2 · Nit · Acceptance criteria, line 133 · A blank line between AC-19 and AC-21 splits the criteria list into two lists, or makes it a loose list. No other item in the list has this gap.
- F-3 · Nit · `### Limits (stated in ADR 0030)` (line 112) · This level-3 heading sits under `## Design` next to the numbered subsections 1 to 4, but it is not numbered and holds limits and failure modes. The rubric puts those under risks. `## Risks and rollback` does not point to it, so the limits are split across two sections.
- F-4 · Nit · `## Design`, `## Alternatives`, `## Risks and rollback` · The headings differ from the rubric's section names ("Proposed architecture", "Alternatives considered", "Risks and mitigations"). The rubric names no Acceptance criteria section, and this one sits between Alternatives and Risks.
- F-5 · Nit · `## Alternatives` (line 124) · About a dozen rejected options are written as one dense paragraph with no list items, so the options and the reason for rejecting each are hard to tell apart and check.
- F-6 · Nit · whole document vs spec-heilmeier.md question 7 · Nothing says how long the work will take. The cost (question 6) is answered only by "one item and one pull request" in the non-functional requirements.

## Not answerable
- Whether the paths, functions and files the spec names exist (`binaryOrHandOver`, `writeFileAtomic`, `probes/releases-latest.md`, `tests/helpers/binary.ts`, `ago`) · I read only the spec and the two standards I was given, not the codebase.
