# style findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: goldfish-style
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-005-harden-the-releases-distribution-after-i/spec.md (whole, lines 1-116), /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/references/writing.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-feature.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-heilmeier.md

## Findings
- F-1 · Major · Design 1, fourth bullet (line 48) · "none can carry the value. This is the guarantee, and it holds wherever the script runs" claims more than an exact literal match can deliver: git text that splits, wraps or truncates the base64 value gets through `redact`. A reader who takes "guarantee" at its word will not test or fix those cases. The exact-match limit is only stated one bullet later and only about other credential forms.
- F-2 · Major · AC-18 (line 95) · "a row that names piece 2" uses a term the spec never defines. Design 4 says "points to the next item" and Non-goals says "the next item of the parent concept", so a writer of the findings row or of its doc test cannot tell what text "piece 2" requires.
- F-3 · Nit · Alternatives, last bullet (line 83) · "Rejected here: those jobs are the backlog's debt point" is jargon that hides the reason. A reader cannot tell why a timeout on the other jobs was turned down, and the feature rubric asks for a stated reason.
- F-4 · Nit · Acceptance criteria intro (line 87) · "retired when the leads' returns changed their texts" is process jargon. It tells a fresh reader nothing about the feature and could be cut or reduced to "AC-1 to AC-5, AC-7, AC-8 and AC-14 are retired".
- F-5 · Nit · Design 4, first bullet (line 74) · "with what the lenses found" and "the security lead's advisory" point to sources the reader cannot find. Neither names a file or finding id.
- F-6 · Nit · AC-18 (line 95) · "the old row" is not defined anywhere in the spec. Which row of `docs/real-use/findings.md` is meant has to be guessed.
- F-7 · Nit · Design 2, third paragraph (line 59) · "What the deletion buys is stated exactly:" is filler before the fact. The sentence can start at "No named test knob is left in the command."
- F-8 · Nit · Problem, item 1 (line 9) · "which is as good as the token" is informal. "which authenticates as the token does" states the fact.
- F-9 · Nit · Problem, intro (line 7) · "Three of them are small" is a subjective size judgement with no measure, and item 1 goes on to describe a leaked write credential.
- F-10 · Nit · Open Questions (line 30) · "None." is followed at once by something the spec says is not known. Either list it as an open question that nothing here depends on, or move it to Risks, where line 106 already covers it.
- F-11 · Nit · Non-goals, Design 4, AC-18, Out of scope (lines 24, 74, 95, 115) · One deferred topic has three names: "One rule for reading a staged binary's version", "the version rule of a staged binary" and "The version rule for a staged binary". Use one.
- F-12 · Nit · Design 1, second bullet (line 46) · "Unchanged when `token` is null, and byte for byte when the value does not occur" leaves out the word that "byte for byte" modifies. It should say "returned byte for byte unchanged".
- F-13 · Nit · throughout (lines 10, 18, 49, 55, 61, 91, 96) · "the command of `push.ts`" is a stiff construction used again and again. "`push.ts`'s command" or a name defined once would read more easily.
- F-14 · Nit · Critical User Journeys, J-4 (line 37) · One paragraph holds the given/when/then and then the whole runbook procedure, including how each target behaves on a second run. Splitting the then from the runbook text would make the journey easier to check.
- F-15 · Nit · Acceptance criteria (line 93) · AC-6 sits between AC-12 and AC-13 while the other ids run in order, so a reader scanning by id misses it.
- F-16 · Nit · Risks and rollback, second bullet (line 105) · "on a slow day" is informal. "under GitHub API latency we have not measured" says what is not known.

## Not answerable
- Whether `docs/real-use/findings.md` already defines "piece 2" and "the old row" · the spec does not cite those files and they were not on the reading list, so F-2 and F-6 are judged from the spec alone.
