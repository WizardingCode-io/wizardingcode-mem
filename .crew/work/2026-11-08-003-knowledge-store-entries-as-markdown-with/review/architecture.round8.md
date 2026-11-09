# architecture findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-architecture
read: the rubric; my round-seven findings (review/architecture.round7.md) and the judge's ruling (review/ruling.round7.json); probes/round-eight-change.patch in full (one commit, 9 files: CLAUDE.md, ADR 0024, src/doctor/checks.ts, src/modules/knowledge/{index-store,repo,resolve}.ts, three test files). For the code as it stands: resolve.ts:140-368 (matchProject, resolveRepo, listRepos, scanRepos); repo.ts:160-219 (isDirectory, existsOnDisk, refuseForeign), :715-740 (createRepository) and :798-842 (openRepo, headOf); checks.ts:605-729 and :843-853 (knowledge's catch); store.ts:780-814 (adopt's present/deleted split). I also grepped the remaining isDirectory, existsOnDisk, readdirSync and bare catch calls under src/modules/knowledge, and the orphan rule in ADR 0024 (:179). The rest of the 45-file diff is as round seven reviewed it.

## Findings
- F-1 · advisory · CLAUDE.md:22 · The new sentence makes a universal rule: "wherever the answer decides whether a repository, or a file of one, is there, the disk is asked with `lookAt`, `kindAt` and `namesIn` (`repo.ts`), for which anything that cannot be looked at is a refusal, never 'not there'". ADR 0024:88 says the same in its lead-in ("never read as … 'no file there'"). The code keeps the rule at the places the ADR's three bullets list. It does not keep it everywhere the sentence covers. `isDirectory` and `existsOnDisk` (repo.ts:170-186) still read every error as "no", and they still decide whether something of a repository is there at:
  - repo.ts:214, refuseForeign's `existsOnDisk(repoFolder)`
  - repo.ts:203, `mustBe`, which returns on any lstat error
  - repo.ts:732, the taxonomy in createRepository
  - repo.ts:841, headOf's `.git`
  - repo.ts:1177, the intent record
  - store.ts:792, adopt's present/deleted split. A changed path that cannot be lstat'd is classed as deleted there.

  Each one appears to sit behind an earlier refusal (refuseForeign's `.git` walk, or kindAt in resolveRepo). That is the ordering the code-quality judge noted at repo.ts:154 last round. So I see no reachable harm, and no boundary is crossed. This is the same pattern as round seven's F-3: the document says more than the code does (Q5/Q6). Fix, either way:
  - word the CLAUDE.md sentence and ADR 0024:88's lead-in for what the code covers (the roots, a repository's name, its `entries/` and `proposals/` folders and the names in them), and say the two older helpers remain only behind an earlier refusal; or
  - replace those calls with `kindAt`/`lookAt` and retire `isDirectory`/`existsOnDisk`.
- F-2 · advisory · src/modules/knowledge/resolve.ts:222 · One function, two rules for a manifest that is missing. For a project (:268), a write rewrites `knowledge.json` only when the folder has no commit (`headOf(path) === null`). The comment at :265-267 says why: "A repository that has commits keeps the manifest it has, or lacks, for the person to see". For the workspace and shared scopes (:222), any write rewrites a missing manifest even in a repository with commits. That leaves an uncommitted `knowledge.json` beside the person's deletion, which the next commit or `adopt` then credits to whichever writer runs. ADR 0024:69 records only the project rule ("A folder the row names that was emptied by hand gets its manifest again with the repository a write makes in it"). It says nothing about the fixed scopes. No boundary is crossed (Q6). Fix: apply the same `headOf(path) === null` guard at :222, or say in ADR 0024 why the fixed scopes differ.
- F-3 · advisory · src/modules/knowledge/repo.ts:29 · Carried, unchanged: the function-level import cycles repo.ts↔resolve.ts and repo.ts↔author.ts. resolve.ts now also imports `headOf` and `MANIFEST_FILE` over the existing edge, so there is no new edge.
- F-4 · advisory · .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/spec.md:130 · Carried: the spec's Design is still not amended. It now also lacks the row-first rule for a project's folder ("the name a project's row holds is the project's while anything is at it"). ADR 0024:3 declares itself the later text and records that rule at :69 and :88-93, so no boundary is crossed.

What the caller asked me to check, beyond the findings:
- Round seven's F-1 is closed. ADR 0024:87 now says only "may be a link" for the way to keep the knowledge on another disk. It names `WIZARDINGCODE_MEM_DATA_DIR` (this product) and `WIZARDINGCODE_HOME` (the brand's home), says each must be in every agent's environment (ADR 0010), and says the store directory does not carry the knowledge (D-1). The message at repo.ts:139-141 now says "make the data directory itself a link".
- Round seven's F-2 is closed. The doctor's `foldersByHand` and `projectFolders` (checks.ts:578-604) now use the module's `kindAt` and `namesIn`. The links-and-files rule matches `scanRepos` (`!== "absent"` in both). A refusal reaches the person as the check's warning through knowledge()'s catch (checks.ts:843-852), with or without a database. A refused repository is kept out of the count (`unread`). The entries and proposals listing uses `namesIn` and `readRepoFiles`, under one KnowledgeError catch per repository. CLAUDE.md:22 says the doctor lists with the same three functions, and it does.
- Round seven's F-3 is closed for what the ADR's bullets now list. `listFolder` uses `namesIn` and `readListed` uses `lookAt` (index-store.ts:333, :350). resolve.ts:216 and :244 use `kindAt`. The fingerprint's leniency is documented at repo.ts:844-850, and it hands the refusal to the rebuild. The general wording that remains is F-1 above.
- What this round decides agrees with the base:
  - The row-first rule in `matchProject` (resolve.ts:158-179) is what ADR 0024:69 and :93 say. Only a name with nothing at it falls through to the manifests.
  - A link or a file at a project's name is refused by `refuseForeign` (resolve.ts:257-263), as for the fixed scopes. `rebuildAll` keeps the rows of anything not `absent` (index-store.ts:594).
  - `openRepo` still resolves without writing and runs `refuseForeign` first (repo.ts:811-812), before the new manifest write at resolve.ts:268. So "refused before anything is written" (ADR 0024:85) still holds.
  - No table, column, error code or exported type changed shape. `lookAt` is a new export, and `kindAt` is now built on it (Q2/Q3).

## Outside the change
- src/core/git.ts:111 · readGitInfo, the hooks' reader, still follows any `ref:` in HEAD. It predates this item. Debt, carried.
- ui/src/api.ts:92 · The viewer's SettingKey type omits WIZARDINGCODE_MODULES and WIZARDINGCODE_MEM_AUTHOR. Debt, carried.
- docs/adr/0019-one-engine.md:38 · Ruling F2 and "Not in this ADR" still read as open, with no forward reference to ADR 0024. Debt, carried.
- docs/adr/0010-settings-storage-and-backups.md:9 · ADR 0010 still uses the retired `SHIBAOX_*` names, and ADR 0024:87 now sends readers there for `WIZARDINGCODE_MEM_DATA_DIR`. Debt, carried.

## Not answerable
- Contracts (rubric Q3) for the later parts' MCP tools and viewer routes · Part 1 defines no route, tool or event payload. There is no contract file to check KnowledgeStore, Change, InEachRepo or Writer against, beyond spec.md, the plan and ADR 0024.
- Windows behaviour of `lookAt`/`namesIn` (the errno names and permission bits the ADR's rule relies on) · Windows was not run, and the new tests skip on win32.
