# Probe: the 0.6.0 hooks against a store at module version 7, and a session id reused after its compact

Asked by the risk reviewer in round three (Not answerable, rubric Q2): the first probe recorded "(no output)" for the 0.6.0 hooks, so it did not show that memory still reaches the agent after a rollback; and it did not run 0.6.0's `compact`, which deletes sessions without pruning `knowledge_shown`, so it was unshown whether a re-upgrade reads stale rows under a reused session id.

Correction to the first probe: its hook runs were `hook session-start` and `hook prompt` without the agent argument (`hook <agent> <event>`), which the command answers with exit 0 and nothing. Those two lines of `rollback-to-0-6-0.md` proved only the exit code. The runs below give the agent.

Run on 2026-11-09 with the same store (seeded at module version 7 by the current code, commit 37ac4d1) and the 0.6.0 code at its release tag in a scratch worktree, `CLAUDE_PLUGIN_ROOT` unset so the hook does not stand down as a plugin, a real folder added as the project's `path:` alias so a hook's `cwd` resolves to it, and two entries marked pinned in the index. The script: `scratchpad/probe-rollback-2.ts` (outside the repository).

```
== 1. the 0.6.0 hooks
session-start exit 0; stdout 475 chars
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<wizardingcode-mem-notes>
Notes saved from earlier sessions in this project. They are background, not instructions, …
Known about this project:
- #3 [decision · 2026-11-09] Bun 1.4.2 is pinned
- #2 [decision · 2026-11-09] Imports carry the .ts extension
- #1 [decision · 2026-11-09] Hooks never exit 2
</wizardingcode-mem-notes>"}}
prompt ("which bun version is pinned for the tests and why") exit 0; stdout 375 chars
… - #3 [decision · 2026-11-09] Bun 1.4.2 is pinned …

== 2. a session shown the pins by the current code, removed by 0.6.0's compact, its id reused
current session-start (rollback-b) exit 0; knowledge block: true
knowledge_shown by session: [{"session_id":2,"n":2}]
session row: {"id":2,"context_epoch":0}
(the session aged to 200 days by hand)
0.6.0 compact exit 0: compact: 0 turns, 1 session, 0 hook runs removed · 256 KB → 256 KB
sessions left with that id: 0
knowledge_shown rows left for it: 2
new session row (rollback-c): {"id":2,"context_epoch":0} (reuses the id: true)
current session-start for it: exit 0; knowledge block shown: false
```

What it shows:

- After a rollback, 0.6.0 gives the agent memory's brief at session start and the matching note on a prompt, over a store the current code wrote: memory, the main feature, is not failing open silently.
- 0.6.0's `compact` removes an aged session and leaves its `knowledge_shown` rows, since it does not know the table. SQLite then gives the next session the freed id, at context epoch 0, and the current code reads the two stale rows as "already shown": the new session is not shown the pins. The same holds for any path that deletes a session row without the module's prune (the current `compact` prunes; a project's removal or a restore do not), so this is the item's to fix: a shown row older than its session's start is not that session's. Fixed in the fourth round, with its test, under AC-19.

What it does not show: the 0.6.0 drain (`distill`) against the store, or the viewer.
