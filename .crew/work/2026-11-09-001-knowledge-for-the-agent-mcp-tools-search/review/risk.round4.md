# risk findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-risk
read: spec, plan, 12 files

## Findings
- F-1 · advisory · src/modules/knowledge/contribute.ts:90 · The fix for a reused session id works on the prompt path only by ignoring stale rows, and only session start deletes them (`dropStaleShown`, line 213). So in a reused-id session whose first hook is a prompt (a host that does not inject at start, or a lost start), `recordShown`'s `INSERT OR IGNORE` keeps the gone session's row with its old `at`. `alreadyShown` keeps reading that row as not this session's, so the same entry can be shown again on every matching prompt of that context until a session start runs. The harm is bounded: it needs the rare reused-id state, and at most 2 entries in 480 characters. The fourth-round test (tests/unit/knowledge-module.test.ts:667) covers only the session-start order. An `INSERT OR REPLACE`, or the drop also on the prompt path, would close it.
- F-2 · advisory · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:387 · Carried from round three and still open: the Rollout paragraph and the plan (plan.md:339, 373 only say "then `bun run plugins`") name no release-day steps, order or owner. The committed plugins/opencode/index.js already lists the three knowledge tools, while plugins/opencode/binary.js:7 still pins VERSION "0.6.0". If the OpenCode package goes out before the version bump, `bun run plugins` and the binary release, a 0.6.0 binary answers `tool knowledge_*` as an unknown tool. The plugin turns that into an empty answer with stderr ignored, so the failure is not seen.
- F-3 · advisory · .crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md:379 · The rollback, and migration 7 applying on an empty index (spec:131, ADR 0024:272), depend on "parts 1 to 3 ship in one release". Nothing in the code or the plan enforces this or names who cuts the release. A release cut from the journey branch before part 3 would ship a module that is on by default (src/settings/settings.ts, `memory,knowledge`), with agent proposals that only the CLI can decide. The spec states the dependency, so this is advisory.
- F-4 · advisory · src/judge/index.ts:28 · The tools' TypeSafe spend goes to `typesafe.tools.requests` and `typesafe.tools.input_tokens`, and no `status` line shows either counter (ADR 0024:360 says so). Open proposals are not counted in `status` either (src/status/report.ts:224). In the first hour, an agent's proposal volume and its judge cost can be seen only through `knowledge list`, `doctor` or raw `meta` rows. Both are capped in code: 20 calls per agent id per hour, at most 16 questions each, and part 1's quotas.
- F-5 · advisory · src/judge/index.ts:68 · The tools' judge shares distillation's persisted breaker. A few slow TypeSafe answers in interactive `knowledge_propose` calls can open the breaker for the drain, which then distils with the heuristic for the cool-down. This is stated (ADR 0024:360), logged, visible in `doctor`, and recovers on its own.
- F-6 · advisory · src/install/opencode-plugin.ts:31 · A `knowledge_propose` that the plugin's 15 s timeout kills after part 1's write has committed returns "" to the agent, and the plugin logs nothing. A retry is caught as a duplicate of the open proposal, so nothing is written twice, but the agent cannot tell a written proposal from a failed one.
- F-7 · advisory · docs/adr/0024-knowledge-module.md:378 · A project folder emptied by hand, or with its `.git` deleted, keeps its last indexed rows. Hooks keep showing its pins at every session start and the tools keep returning its entries until a write or a rebuild. The limit is stated, but no `doctor` signal is named for that state.

## Outside the change
- src/install/opencode-plugin.ts:36 · The bridge's spawn ignores stderr and returns "" for any non-zero exit or timeout, for every tool. The three knowledge tools inherit this (debt).
- src/judge/breaker.ts:101 · The breaker's state is read when it is built and saved with a plain `setMeta`, with no transaction around the read and the write. Tool-call processes are now a second kind of writer that can lose the drain's failure counts (debt).
- src/modules/knowledge/migrations/0006_knowledge_store.sql:7 · Part 1's migration 6 drops the withdrawn module's tables and `meta` rows, with no backup and no down path. It belongs to item 2026-11-08-003, reviewed there, and is in this diff only because this item's base predates part 1.
- src/engine/module-schemas.ts:1 · Module migrations run on whichever process opens the database first after the upgrade, usually a hook, under its busy timeout. This item adds migration 7's DDL to that open, which the spec states (NFR "Rollout"); the mechanism is part 1's.

## Not answerable
- Rollback (Q2) · The two probes still do not run the 0.6.0 drain (`distill`) or the viewer against the version-7 store; the hooks probe says so. 0.6.0 has no knowledge code, so a risk is unlikely, but it is not measured.

Notes for the caller:
- Round three's two Not answerable items are answered. probes/rollback-to-0-6-0-hooks.md shows 0.6.0's hooks still give memory's brief and notes. It also measured the reused-session-id case, and the fix (`alreadyShown` reads only rows from the session's start on; `dropStaleShown` at session start) is in contribute.ts:53-74, with its test.
- Round three's F-1 is closed: the spec's rollback line (spec.md:379) now says "silently", which agrees with the probe and ADR 0024:382.
- The newest gate log (logs/test-_-1794257766986.txt) shows the budgets hold with knowledge on: prompt p95 49.3 ms against 80, session start p95 20.7 ms against 150, the rebuild's write transaction 25.9 ms against 50, 0 failures.
- No defect condition of the rubric is met:
  - Migration 7 is additive DDL, and 0.6.0 is measured to ignore it.
  - Every index row can be rebuilt from the git files.
  - Writes are bounded in code: the rate counter, part 1's quotas, 3 refreshes per drain, and `compact` has a dry run.
  - TypeSafe failures fall back to the heuristic within 3 s.
  - Lock and schema failures on a hook are contained and logged.
- No finding falls in the sibling item's paths (2026-11-09-002, the sharing policy).

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/contribute.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/tests/unit/knowledge-module.test.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/store/compact.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/plugins/opencode/binary.js
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0024-knowledge-module.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/spec.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/probes/rollback-to-0-6-0-hooks.md
