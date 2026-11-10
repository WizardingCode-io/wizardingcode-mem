# Probe: the documents check fails on the item's base and passes on the tree

Asked by the test-quality reviewer in round two (F-1, lowered to advisory by the judge): the reason recorded for AC-18 said the documents were prose with no behaviour a test could fail on before they exist, while the check script named in the same record fails when any part is missing, so a red run was possible and only the green was recorded.

Run on 2026-11-09 with `probes/check-docs.ts`, which gained `--at <commit>` for this: with it the three files are read from that commit through `git show`, without it from the working tree.

Against the item's base, `62780aa` (the ADR does not exist there, the README has no Sharing subsection, CLAUDE.md has no sharing bullet):

```
$ bun probes/check-docs.ts <root> --at 62780aac6e5f4bf1eaefd449ee3c523815b3acd4
docs/adr/0025-sharing-policy.md is not there at 62780aa
ADR 0025 has 0 ruling rows, not 20
ADR 0025 lacks the section ## Storage: the `sharing` namespace
… (the ten sections, the two binding sentences, the two pinned-key names)
README has no Sharing subsection under Privacy and your data
README's Sharing text lacks wizardingcode-mem share project <local|knowledge|all>
… (the six README phrases)
CLAUDE.md's bullet lacks `src/sharing/`
CLAUDE.md's bullet lacks wizardingcode-mem share project | roots | areas | status | explain
CLAUDE.md's bullet lacks `sharing` namespace
CLAUDE.md's settings line does not name the two sharing keys as the exception that can only narrow
exit 1
```

On the working tree at the third round's fixes:

```
$ bun probes/check-docs.ts <root>
ADR 0025: 20 rulings, 10 sections, the binding limit, part 6's duty and the six pinned types; README: the Sharing subsection; CLAUDE.md: the bullet and the settings line's exception
exit 0
```

What it shows: the check is a run that fails before the documents exist and passes once they hold every part the criterion names, so the criterion's observed record stands on a red and a green, not on prose alone. The record's reason is corrected to say so.
