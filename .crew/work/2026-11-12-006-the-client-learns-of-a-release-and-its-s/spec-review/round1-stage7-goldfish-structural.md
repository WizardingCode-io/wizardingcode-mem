# structural findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: goldfish-structural
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-006-the-client-learns-of-a-release-and-its-s/spec.md (lines 1-131, whole), /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-feature.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-heilmeier.md

## Findings
- F-1 · Nit · ### Alternatives (line 96) · The rubric's "Alternatives considered" is a third-level heading inside "## Design" instead of its own second-level section, and it is the only unnumbered sibling after "### 1." to "### 4.", so a reader scanning the outline sees it as a fifth part of the architecture.
- F-2 · Nit · ## Design (line 44) · The rubric's "Proposed architecture" section is titled "Design", and "Risks and mitigations" is titled "Risks and rollback"; neither title matches the standard's section name.
- F-3 · Nit · ## Risks and rollback / ## Non-Functional Requirements (lines 119-131) · The rubric puts rollout and rollback under non-functional requirements, but rollback is in Risks and the NFR section holds only three performance and hook-path sentences, so the material is split across two sections.
- F-4 · Nit · whole document (spec-heilmeier.md Q6, Q7) · Nothing answers the Heilmeier questions on cost in resources or people (Q6) or how long the work will take (Q7). Q1 (what is attempted, with no jargon) is also never stated plainly: the opening defines internal terms first.
- F-5 · Nit · ### 2, lines 62-67 · The line "A second line when the running copy is not the staged binary…" is indented two spaces with no blank line after the nested list, so Markdown joins it to the last nested bullet (`update: not checked in CI`) instead of showing it as a rule for every line.
- F-6 · Nit · ## Goals and Non-Goals vs ## Acceptance criteria · AC-20 (import boundary) and AC-21 (documents) are cited by no goal, though every other AC from AC-10 to AC-19 is traced to a G-n.
- F-7 · Nit · headings (lines 13-129) · The second-level headings mix title case ("Goals and Non-Goals", "Open Questions", "Critical User Journeys", "Non-Functional Requirements") with sentence case ("Acceptance criteria", "Risks and rollback").
- F-8 · Nit · line 117 (Test files) · Nine test files, each mapped to its ACs, are packed into one run-on paragraph separated by semicolons where a list or table would make the mapping from file to AC readable.
- F-9 · Nit · lines 68 and 123 · Fixed output texts are written in plain quotes ("run wizardingcode-mem update for the commands", "not a release redirect") where every other fixed text in the document is in code spans, so it is unclear whether these are exact strings.
- F-10 · Nit · ### 1, line 50 onward vs ### 2 and ### 3 · Design 1 ties its bullets to ACs inline (AC-19, AC-20), but Designs 2 and 3 cite none, so the links between design and criteria are uneven.

## Not answerable
- Whether "### Alternatives" matches `concepts_brief.md` ("Copied from concepts_brief.md") · that file was not in the reading list and I did not read it.
- Whether the referenced paths (ADR 0029, `src/cli/commands/install.ts`, `tests/helpers/binary.ts`, `tests/e2e/install-forward.test.ts`, and others) exist · these are code-path references, not Markdown links, and checking them is outside the structural lens and the files I was given.
