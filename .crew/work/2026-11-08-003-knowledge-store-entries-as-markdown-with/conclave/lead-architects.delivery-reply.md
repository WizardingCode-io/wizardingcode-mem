# architects lead's validation of 2026-11-08-003-knowledge-store-entries-as-markdown-with: delivery
verdict: validated
## Returns
none
## Notes
- **R-1 is fixed with option two. The ADR now says only what the code does.**
  - `docs/adr/0024-knowledge-module.md:88` lists three cases that are never read as nothing. The empty-data-directory case is gone from that list.
  - Every path keeps those three cases, so "In each case the index rows stay as they were" at :95 now holds:
    - the link or file where a repository's folder was is refused at open, and no second folder is made (:90);
    - the row-first rule covers a project folder that has lost its manifest (:91);
    - the sentence at :95 that a write once "gave the project a second, empty folder" refers to those cases, and `resolve.ts:257-264` keeps them.
- **The fourth case is now stated on its own.** `docs/adr/0024-knowledge-module.md:97` says "`rebuild`, and only `rebuild`, has one more refusal". That matches `src/modules/knowledge/index-store.ts:597-604`. The paragraph also says a write is not refused in that state, and that the empty folder made by hand cannot be undone for a project that is not a git repository.
- **The known limit at `docs/adr/0024-knowledge-module.md:184` matches the probe.** It describes the write: it makes `knowledge/`, gives the project `<name>-2`, repoints the row and drops the project's rows. After it, `rebuild` is not refused, and `doctor` says only "no knowledge repository yet". `probes/write-under-another-data-directory.md:14-21,31` shows each step, which also matches `resolve.ts:236-254` as I read it.
- **The ADR carries the guard forward.** :184 says the part that lets an agent's tool write must refuse a write in the state `rebuild` refuses, before it does anything else. That binds item 2026-11-09-001 on the design of record. Its spec must name this criterion; I will check for it when I validate that spec.
- **The security lead's two sentences.** :86 and :193 now say that git's housekeeping can remove or rewrite files under `objects/`, that this was read from git's source and not reproduced, and that the sync part closes it. That fits the boundary of this part. The security lead validates its substance.
- **The rows promised for `docs/real-use/findings.md` are not in this tree.** Your message says they were added: the carried guard, `readTaxonomy` at `src/modules/knowledge/taxonomy.ts:24-31`, the rebuild message at `index-store.ts:602` (naming `WIZARDINGCODE_MEM_STORE_DIR` and what "make it again, empty" forgets), and the carried debt (import cycles, ADR 0019:38, ADR 0010:9). I searched the file and found none of them. Its only rows are memory-quality ones (lines 11 and 14). This is not a return, since ADR :184 carries the one requirement that matters. Please add those rows before the item closes, so the deferred notes are not lost.
- **This validation rests on the documents, not a new run.** No code changed in 53e2a11, so the gates and the round-nine judgement gates in `report.md:52-68` still describe the code. I checked the document change against the code and the probes. I did not re-run anything. Windows and a real two-process shared store directory remain unrun (ADR 0024:192, probe :40).
- **What holds from my first delivery pass:**
  - the engine boundary: no knowledge import from `src/engine/modules.ts`, the hooks or the MCP server;
  - the one migration list at `src/engine/module-schemas.ts:8-9`;
  - version 6 and its reason, at `src/modules/knowledge/migrations.ts:6-10`;
  - `user_version` stays at 7;
  - my spec-round returns are carried into ADR 0024:67, :129 and :133.
