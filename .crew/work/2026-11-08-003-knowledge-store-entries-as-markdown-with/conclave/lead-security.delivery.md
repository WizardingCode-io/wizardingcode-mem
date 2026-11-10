# security lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: delivery
verdict: validated
## Returns
none
## Notes
- **The gate my team owns passed on the current tree.** `report.md:65` records the security judgement gate as proven with 7 findings, and all 7 are advisory (`report.md:102-108`, `review/security.round9.md:6-12`). Security has been proven from round six on. The engine's gates also pass on the current commit (`report.md:52-57`): secrets, prose, build, test, lint and typecheck. No task was handed out, so there is no brief to check. Nothing is merged, released or deployed, and no hook, MCP tool or view reads the store in this part (CLAUDE.md, the ADR 0024 draft).
- **My spec returns are closed in the code, not only in the spec:**
  - R-1 (the repository's own config could run programs) is closed.
    - The runner passes `-c core.fsmonitor=false`, `core.untrackedCache=false`, `core.pager=cat`, `diff.external=` and `core.sshCommand=` (`src/modules/knowledge/repo.ts:421-425`).
    - Hooks resolve to a file, so no hook can be found (`repo.ts:438`).
    - The environment carries `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM`, `GIT_CEILING_DIRECTORIES` and `GIT_LITERAL_PATHSPECS`, and `HOME` is not passed except for the one `user.name` lookup (`repo.ts:378-392`).
    - The local `.git/config` check is now stricter than I asked for. It is an allow list of the seven settings `git init` writes (`repo.ts:555-563`), read by git's grammar, and an unreadable line is refused (`repo.ts:593-653`). It also refuses `commondir`, `config.worktree` and `objects/info/alternates` (`repo.ts:565-569`).
    - `openRepo` runs `refuseForeign` and `checkRepoConfig` before git runs and before the interrupted-operation revert (`repo.ts:824-835`). AC-15 records red then green (`report.md:42`).
  - R-2 (proposal and entry ids reaching the file system) is closed. A non-UUID proposal id is refused before any path is built (`src/modules/knowledge/store.ts:527`), and so is a non-UUID entry id read back from a proposal file (`store.ts:550`). AC-15 covers it (`report.md:42`).
  - R-3 (secrets in an agent's proposal) is closed. An agent's text passes through `redact` before the proposal is written (`store.ts:423`). A caller slug that redaction would change is refused (`docs/adr/0024-knowledge-module.md:119`, AC-19 at `report.md:46`).
- **Personal data holds.**
  - The author name is the only personal data. ADR 0024 records where it is written, how long it is kept and how it is erased (`docs/adr/0024-knowledge-module.md:156-170`).
  - Commit e-mails use the `.invalid` domain, and agent ids and `agent:` names are validated (AC-9, `report.md:36`).
  - The ADR says plainly that there is no erase command yet, and that one is required before a name leaves the machine with team sharing (`:166`). Backups carry the index, and that is stated too (`:170`).
  - The round-nine reviewer found no new write, log line or output of the name (`review/security.round9.md:36`).
- **Data migration holds for security.**
  - `rebuild` now refuses before any DELETE when the data directory has no `knowledge/` folder (`index-store.ts:597-604`). Mutants 3 to 5 are killed (`review/security.round9.md:29-33`).
  - The remaining two-data-directory case is a stated limit (`docs/adr/0024-knowledge-module.md:183`). The files are never touched and the index can be rebuilt from them, so it is not a destructive step without a reason.
- **One condition for the sync part:**
  - F-1, carried since round six, is still open: a detached automatic gc started by the store's own commit could delete or write files through a linked folder below `objects/`, for example `objects/info/commit-graphs`. The walk does not descend into the folders of `objects/` (`repo.ts:270`), and `configArgs` sets neither `gc.auto=0` nor `maintenance.auto=false` (`repo.ts:416-434`).
  - The one run, `probes/auto-gc.md:7-16`, did not reproduce it and says plainly what it does not show.
  - Exploiting it needs same-user write access to the 0700 data directory, and that user could delete those files directly. Nothing syncs in this part. So it stays an advisory, not a return.
  - Two text corrections are owed:
    - `docs/adr/0024-knowledge-module.md:86` says git only reads or replaces those files whole. That does not cover gc's removals.
    - `:192` says a linked object or pack "is not a way to write", but the reviewer's reasoned gc case would write and delete through such a link.
  - I recommend adding `-c gc.auto=0 -c maintenance.auto=false` to `configArgs` (no cost at this store's size) and correcting `:86` and `:192`. Either way, the sync part's spec must close this, together with the unchecked files under `objects/`, before any repository arrives from outside. My security validation of that spec will ask for it.
- **Other advisories stand as stated and do not block:** unescaped names in doctor output (`src/doctor/checks.ts:739`), lstat failures read as absent (`repo.ts:211`, every traced caller fails closed later), and the two time-of-check windows (`resolve.ts:257`, `repo.ts:715`, both needing write access to the 0700 data directory).
- **Not proven, and not claimed:**
  - Windows was not run: `/dev/null` as the global config, a file as the hooks path, junctions, and refs with `..\` (`docs/adr/0024-knowledge-module.md:191`, `review/security.round9.md:20`).
  - The two-data-directory probes ran in one process, not in two real processes (`review/security.round9.md:21`).
- **What I validated on:** the report, the round-nine findings, my two spec validations and the ADR 0024 sections on git's isolation, personal data and known limits, plus my own reading of the guard code above. Like the round-nine findings, it rests on the gate runs the report records and on the session's probes. I did not rerun anything.

Files:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/report.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/review/security.round9.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/auto-gc.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/repo.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/modules/knowledge/store.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/docs/adr/0024-knowledge-module.md
