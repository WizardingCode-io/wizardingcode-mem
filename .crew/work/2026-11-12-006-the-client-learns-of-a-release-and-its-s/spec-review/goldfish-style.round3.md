# style findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: goldfish-style
read: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-006-the-client-learns-of-a-release-and-its-s/spec.md (whole, lines 1-172), /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/references/writing.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-feature.md, /Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.23.3/skills/crew/rubrics/spec-heilmeier.md

## Findings
- F-1 · Major · Goals, G-1 · "`status` and `doctor` say that a newer release exists and how to get it on each channel" contradicts Design §2 and AC-25: there, `doctor` prints line 1 plus "; run wizardingcode-mem update for the commands" and no per-channel commands, so a reader who builds from G-1 makes `doctor` print the four commands and finds AC-25 does not cover it.
- F-2 · Nit · J-1 · "`doctor` shows a warning line `update` with the same sentence" is not what Design §2 says: the doctor line adds "; run wizardingcode-mem update for the commands", so "the same sentence" is loose.
- F-3 · Nit · J-8 · "a client still on 0.9.1 is told nothing is out": the Design's table prints `update: 0.9.1 is the latest (checked <age>)`. Quote the line instead of paraphrasing it.
- F-4 · Nit · Non-goals, last bullet · "Detecting the install channel. One rule for the five places … : its own item. The team server's upgrade." is three fragments that a reader has to put together. The middle one does not say what the rule decides.
- F-5 · Nit · Non-goals, first bullet · "A later item, after release assets are signed or the author can mark a release as not to be followed." This fragment has no subject. It does not say whether the later item waits for both conditions or for either one.
- F-6 · Nit · Design §1 "Where it runs" and AC-13 · "the drain" and "a turn" are used as terms but are not in the spec's "Words used here". A reader who comes to the spec fresh has nothing to look them up against.
- F-7 · Nit · Design §2, `status` bullet · "The viewer's status is unchanged: the field is optional and only `status` fills it" says unchanged and in the same breath describes an added field. Say that the type gains an optional `update` field that the viewer leaves empty.
- F-8 · Nit · Design §4, README bullet · "none of your data leaves your machine unless you ask" depends on what "your data" covers. Risks says the default-on request "tells github.com that an address runs the product". Scope the sentence (for example, memories and settings) or point to the network bullet next to it.
- F-9 · Nit · Design §4, runbook bullet · One sentence carries three procedures. In "which also moves what `scripts/install.sh` downloads and is to be checked on the first real release" the antecedent of "which" (the command or the procedure) is unclear.
- F-10 · Nit · Design §4, ADR 0030 bullet · "the four blockers … with the unsigned assets" leaves the count unclear: is the unsigned-assets point a fifth blocker or a separate reason?
- F-11 · Nit · Design §4, CLAUDE.md bullet · "with the developer's hazard" names a hazard without saying which one. It is presumably the Limits item about a compiled build staging over the developer's real binary. Name it.
- F-12 · Nit · Limits · "Every reconciled command now runs the staged file, as hooks and `install` already did" is stated without exceptions. Elsewhere the spec excludes Windows, `install --binary`, root and a `bin` folder owned by another user, and `install` hands over only to a newer staged binary.
- F-13 · Nit · AC-21 and G-2 · "says the daily request" leaves out the hourly rate after a failure and the request made on each `update`, which Design §4 requires in the same bullet. G-2's "it is said in the README" is vaguer than the AC it cites.

## Not answerable
- none
