# structural findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: goldfish-structural
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-006-the-client-learns-of-a-release-and-its-s/spec.md (whole, lines 1-172); /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-feature.md; /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-heilmeier.md; the item folder's file listing, to confirm that the referenced concepts_brief.md and probes/releases-latest.md exist

## Findings
- F-1 · Major · Acceptance criteria, AC-20 (line 138) against Design §1 (line 52) · Design forbids src/update/ importing from six folders, src/status/ and src/doctor/ included, but AC-20, the criterion its boundary test checks, lists only four, so a builder who writes update-boundary.test.ts from AC-20 will not enforce the status and doctor rule
- F-2 · Nit · Design › "### Limits (stated in ADR 0030)" (line 115) · the limits sit as an unnumbered fifth H3 inside Design, after numbered §1–§4, and are split from "## Risks and rollback"; the rubric's "Risks and limits" content is spread over two places
- F-3 · Nit · ## Alternatives (line 128) · about ten rejected alternatives across four topics (check, channel copy, backoff, tests) are packed into one prose paragraph instead of a list, so it is hard to scan which option was rejected for which reason
- F-4 · Nit · Goals and Non-Goals, last non-goal bullet (line 31) · one bullet holds three separate non-goals, one of them the bare fragment "The team server's upgrade."; the first bullet (line 27) also mixes a non-goal with a policy rule about `latest`
- F-5 · Nit · section headings · the rubric's names are partly renamed ("Design" for Proposed architecture, "Alternatives" for Alternatives considered, "Risks and rollback" for Risks and mitigations), and capitalisation is mixed ("Goals and Non-Goals", "Open Questions", "Non-Functional Requirements" against "Acceptance criteria", "Risks and rollback")
- F-6 · Nit · whole document, against spec-heilmeier.md question 7 · nothing says how long the work will take; cost appears only as "one item and one pull request" in the last section

## Not answerable
- Whether the source paths, functions and test files the spec names exist or match the code · outside the structural lens; I read only the spec, the two standards and the item folder's listing
