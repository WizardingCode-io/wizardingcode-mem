# security lead's validation of 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search: delivery
verdict: validated
## Returns
none
## Notes
- The security gate is proven in the latest ruling (review/ruling.json, security entry), with three advisories and no defect. review/security.findings.md round five says nothing changed in this item's risk paths since round four.
- The security gates on the merged tree passed (report.md:62-68): secrets, prose, build, test, lint (one untouched file with problems, none of the item's) and typecheck. The e2e skip is a recorded user decision (report.md:70).
- AC-29 (report.md:55) covers redaction before the judge, quoted-token search and ref validation. I spot-checked the code:
  - src/modules/knowledge/propose.ts:95 redacts the draft and every neighbour with the store's env. Line 117 clips after redaction.
  - src/modules/knowledge/propose.ts:28 is the rate limiter (`allowProposal`).
  - src/modules/knowledge/tools.ts:108 sets `REF` to the scope/slug pattern, so refs cannot be file paths.
  - src/modules/knowledge/entry.ts:12 sets `AGENT_ID`, which `--agent` is checked against.
- Auth: per review/security.findings.md, an agent's write always goes through `agentWriter` as a proposal, and no tool argument names the writer. Recorded as objection O-1 (report.md:295) and ruled advisory.
- Personal data: the judge sees only redacted, clipped text from at most 8 neighbours.
- Migration 0007 only adds columns and tables. The 0.6.0 rollback probes are cited as evidence in review/risk.findings.md and not re-run here.
- Three open advisories, none blocking:
  - src/mcp/agent-id.ts:21: rotating the handshake name gives about 11 rate windows (about 220 proposals an hour instead of 20). Part 1's quotas and the person's acceptance still bound it.
  - src/modules/knowledge/tools.ts:420 and :443: `query` and `body` have no maximum length before redaction.
  - src/modules/knowledge/tools.ts:247: `knowledge_get` puts the author name in the agent's context, and ADR 0024's personal-data section (docs/adr/0024-knowledge-module.md:368-370) names only `on_behalf_of`. Worth fixing before parts 4 to 6 bring in other people's names.
- The gap-round decisions D-12 and D-15 are reflected in the delivered code and ADR 0024. D-12 puts the agent id in the handshake mapping with `--agent` as an override. D-15 limits the global server to the workspace and shared repositories.
