# architects lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: spec
verdict: validated
## Returns
none
## Notes
- My round 2 return (R-1) is fixed. `spec.md:112` now exempts `adopt` from the restore-from-HEAD rule. On a failed commit `adopt` only unstages its paths (`git reset -- <paths>`). It also writes back the original bytes it read before rewriting `version`, `updated` and `author`. Hand edits and hand-added files stay as the person left them, so no uncommitted work is lost.
- AC-18 is at `spec.md:252`. It is in `work.json` (lines 86 and 106). AC-14 at `spec.md:251` is marked superseded by it.
- `plan.md:32` (task 14) has the adopt-failure case: a stub `git` that fails `commit`, with both ` M` and `??` paths unstaged. I did not read the full text of that long line. I only confirmed that AC-18 and `??` appear in it.
- Two edits are needed in the pass-through, neither a return:
  - The adopt section (`spec.md:161`) should state the exemption in its own text. I did not read that line in full, because the search omitted it as too long.
  - AC-14's text still says "or an adopt" in the restore case. Its "superseded" marker is enough.
- My earlier checks still hold: migration 6 and the module namespace follow ADR 0019 F2 and ADR 0020 K3/K8. `user_version` stays at 7. Nothing touches the hook path, the composer or the MCP tools.
