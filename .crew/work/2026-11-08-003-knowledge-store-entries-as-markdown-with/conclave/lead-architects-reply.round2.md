# architects lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:112 · The rule "restore every staged path from HEAD (`git checkout -- <paths>`), remove a file that did not exist at HEAD … an adopt alike" destroys data for `adopt`. The paths `adopt` stages (line 161) hold the person's uncommitted hand edits and files they added by hand. On a failed commit, restoring from HEAD would discard those edits, and removing "a file that did not exist at HEAD" would delete a file the person created. Write and accept can restore from HEAD because the engine produced the change. `adopt` cannot. State that `adopt` is exempt. On a failed commit it must unstage only (`git reset -- <paths>`) and leave the working tree as the person left it. The hand-edit text and any file the person added must stay byte for byte. Rewriting version, `updated` and `author` should happen on a copy, or the original text should be kept in memory and written back. Fix AC-14 (line 251) and plan task 14 to match, with a case such as a stub `git` that fails `commit` during adopt, asserting the hand edit is still there.

## Notes
- My earlier returns R-2, R-3 and R-4 now hold.
  - Step 4 (spec.md:119) creates the workspace repository before a project write, and AC-17 (line 254) covers it.
  - `change` no longer carries an id (line 110). An accept whose entry id already belongs to another slug is refused as `invalid` naming that slug (line 157).
  - `removeArea` runs `ensureFresh` first and is refused for an open proposal as well as an entry (line 184).
- My earlier R-1 holds for write, accept and reject. They stage only their paths, restore them on a failed commit, and leave the proposal under `open/` unchanged (lines 112 and 157).
- The additions in this round are consistent with the base. Git's local config is refused for `include`, `hooksPath`, `fsmonitor` and `sshCommand` (line 104). `redact` is applied to the agent's proposal text (line 134). Proposal and entry ids are checked against the UUID pattern before a path is built (line 157). The old two-column `module_migrations` is widened via `PRAGMA table_info` (line 191). Nothing here moves `user_version` or touches the hook path.
