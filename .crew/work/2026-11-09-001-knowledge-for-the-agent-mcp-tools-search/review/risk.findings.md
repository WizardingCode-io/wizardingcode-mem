# risk findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-risk
read: spec, plan, 7 files (criteria-round-five.md, files.txt, probes/rollback-to-0-6-0.md, probes/rollback-to-0-6-0-hooks.md, src/modules/knowledge/contribute.ts, src/store/sessions.ts, src/hooks/handle.ts); diff.patch read only in the parts of those files, since nothing in this item's paths changed after 93af04f

## Findings
- F-1 · advisory · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:379 · The rollback to 0.6.0 is measured for the hooks, the commands and `compact`. The probes say themselves that 0.6.0's drain (`distill` with distillation on), the viewer and a release binary built from the 0.6.0 lockfile were never run against a module-version-7 store (rollback-to-0-6-0.md:42, rollback-to-0-6-0-hooks.md:39). 0.6.0 does not know these tables, so a break is unlikely, but the rollback the spec states is still partly assumed and not shown.
- F-2 · advisory · src/modules/knowledge/contribute.ts:61 · The 93af04f fix (`k.at >= s.started_at` in `alreadyShown`, and the delete in `dropStaleShown` at :70-71) depends on `knowledge_shown.at` and `sessions.started_at` coming from the same clock. They do (both are the hook's `now`). But a wall clock that steps backward during a session (an NTP correction) would make that session's own rows look older than its start. The session start would then drop them, and the session would be shown its pins again. The harm is bounded: one extra pinned block, within 840 characters, and nothing is lost. Nothing logs it.

## Outside the change
- .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:371 · A hook that waits past its busy timeout behind any writer (the drain, `compact`) fails at `touchSession` and prints nothing, memory's brief included. No log line or count shows this in the first hour. The repository already had this risk. This item only adds its own `rebuildRepo` transaction, which is bounded (under 50 ms at 2,000 entries, asserted by AC-27, and at most 3 repositories per drain, each in its own transaction).
- src/modules/knowledge/contribute.ts:53 · Paths that delete a session row without the module's prune (removing a project, a restore, 0.6.0's `compact`) leave orphan `knowledge_shown` rows. They are now harmless to the next session that reuses the id, and the current `compact` prunes them. Until then they only take space. This is debt the earlier code carried, not a risk this item adds.

## Not answerable
- none

Notes for the judge. The sibling item's commits since round four (b54a579 in src/sharing/policy.ts, levels.ts and report.ts, and in tests/unit/sharing-policy.test.ts; be1f6b7 in docs/adr/0025-sharing-policy.md) belong to 2026-11-09-002 and are not judged here. No defect was found. Each rubric question has an answer in the item's own words:
- **Migrations:** 6 and 7 have no down path. The stated reason is that 0.6.0 ignores the module tables, measured by the two rollback probes.
- **First run:** it is bounded in code. The drain refreshes at most 3 repositories, an agent gets 20 proposals an hour, and an agent's write is only a proposal.
- **TypeSafe:** one attempt with a 3 s timeout, then the heuristic. The breaker is logged, and the draft is redacted before it is sent.
- **First hour:** the module going silent is logged once per process. `status` and `doctor` have knowledge lines.
- **Hands at deploy:** none for a release. The one manual step is `knowledge rebuild`, once, on development stores that ran migration 6 alone, and it is named in ADR 0024.
