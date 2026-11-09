# Probe: the documents check fails on the item's base and passes on the tree

The document criterion (AC-26) is observed: its check, `probes/check-docs.ts`, reads ADR 0024's part 2 (its seventeen section marks and its eight ruling rows), the dated note in ADR 0019, CLAUDE.md's and the README's sentences, and exits 1 when any part is missing. With `--at <commit>` it reads the files from that commit through `git show`, so the same run is a red on the item's base and a green on the tree.

Against the item's base, `62780aa` (ADR 0024 does not exist there; CLAUDE.md and the README describe memory as the one module):

```
$ bun probes/check-docs.ts <root> --at 62780aac6e5f4bf1eaefd449ee3c523815b3acd4
docs/adr/0024-knowledge-module.md is not there at 62780aa
ADR 0024 lacks part 2 (## Part 2: knowledge for the agent)
… (the 25 marks of part 2, each named)
ADR 0024 has 0 part-2 ruling rows (D-9 to D-16), not 8
ADR 0019 lacks the dated note pointing to ADR 0024's part 2 (ADR 0024, part 2)
CLAUDE.md lacks the modules default (default `memory,knowledge`)
CLAUDE.md lacks how to turn knowledge off (`WIZARDINGCODE_MODULES=memory` turns knowledge off)
CLAUDE.md lacks the knowledge module's opening (The knowledge module (ADR 0024)
CLAUDE.md lacks the propose tool (knowledge_propose)
CLAUDE.md lacks module version 7 (is at 7)
README lacks on by default (**On by default.**)
README lacks what the agent sees (**What your agent sees.**)
README lacks the three tools (**Three tools.**)
README lacks how to turn it off (WIZARDINGCODE_MODULES=memory)
exit 1
```

On the working tree at commit cc85251 (phase H):

```
$ bun probes/check-docs.ts <root>
ADR 0024: part 2 with its 17 sections' marks and 8 rulings; ADR 0019: the dated note; CLAUDE.md: the modules default, the module's opening, the tools, version 7; README: on by default, what the agent sees, the three tools
exit 0
```

What it shows: the check fails before the documents hold what the criterion names and passes once they do, so the observed record stands on a red and a green, not on prose alone. What it does not show: that the sentences are true of the code; the reviewers read that.
