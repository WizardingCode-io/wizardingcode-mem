# comprehension findings for memory-quality (spec 2026-10-14 + plan 2026-10-15)
reviewer: goldfish-comprehension
read: /Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/specs/2026-10-14-memory-quality-design.md (all, lines 1-250); /Users/andreagroferreira/AIProjects/ai-mem/docs/superpowers/plans/2026-10-15-memory-quality.md (all, lines 1-3284); no standard (review mode). I also grepped src/ once to check where `withWrite` lives and whether the `UNIQUE (source_turn_id, source_ordinal)` constraint exists.

## Findings

**What this proposes**
The tool turns each finished conversation turn between a user and a coding agent into short stored "memories". At present most of those memories record what happened in the session ("PR merged", "gate verdict: REJECTED") and are not lasting knowledge. The design changes this in five ways:
- A pure filter runs before the judge. It removes the host's own framing blocks and drops sentences that match named patterns which are never knowledge. A turn with nothing left is skipped without calling the judge.
- The judge questions get a version 2. They are asked on behalf of a named "reader" (a future newcomer). Each sentence gets a `knowledge_<i>` question, and the criteria say what is *not* knowledge.
- A policy rule: a memory is stored only if its title sentence passes `KNOWLEDGE_THRESHOLD`. The `Context:` line now needs a prompt of at least 5 words.
- A manual, reversible command, `rejudge distilled`, re-reads the source turns of existing version-1 memories. Each old memory is superseded by a new one, archived, or kept, and every decision is recorded in a new `memory_reviews` table.
- A proof measures the change on two hand-labelled 200-memory samples taken from a read-only copy of the author's database.

**How the existing system works, per this document**
- Turns are queued and processed by a "drain" that holds a lease. For each turn, the pipeline splits the prompt and the final answer into candidate sentences and sends one request to a judge. The judge is either TypeSafe (an external classification service with typed question "primitives" such as `noul`, `choice` and `score`) or a local heuristic.
- The judge returns `worth`, `kind`, `importance`, a durability score per sentence, and a title choice. Code in `policy.ts` turns these into a draft memory, which is then consolidated against neighbouring memories: it can be inserted, merged as a duplicate, or supersede another memory.
- Memories carry `origin`, `judge` and `judge_version`, plus a `source_turn_id`/`source_ordinal` pair that is unique together. They are never deleted, only `archived` or `superseded`.
- A separate `rejudge` command already re-judges memories imported from claude-mem. Retrieval, hooks and "the brief" are outside the scope of this change.

- F-1 · Blocker · Spec §6 "The cleanup, rehearsed" (and AC-7 in the plan, "--undo restores the counts") · The spec requires that "the counts of `memories` by status before and after the undo must match". The undo the spec designs in §5 cannot meet that. Undo *archives* each replacement memory instead of removing it, so after the undo the `archived` count is higher by one per superseded memory. The plan quietly narrows the check to the `active` count only (`quality.ts` rehearse: "active count back to before"; the undo test compares only active). As written, the spec's acceptance criterion is unbuildable. A reader can't tell which check is the real bar.

- F-2 · Major · Spec §5 "Reversibility" vs plan Task 6 `apply` / `undoRejudgeDistilled` · The spec calls the cleanup "reversible" and says `--undo` "reverses the last run". The plan breaks this in three places:
  - A `kept` outcome overwrites `kind`, `importance`, `judge` and `judge_version` in place. The old values are not stored anywhere, and undo leaves them changed ("what it kept stays").
  - The same applies to orphan memories that are kept.
  - The `duplicate` path's `reinforce` (an extra evidence row and `evidence_count`) is left in place.

  Someone relying on "nothing changes after undo" would trust a rollback that is only partial. Either the spec should say which effects are permanent, or the review row should carry the old values.

- F-3 · Major · Spec §5 "What it does, per memory" vs the `memory_reviews.outcome` table · The steps are labelled "Nothing kept" (archived), "**Kept**" (which in fact *supersedes*), and "Judge failed". The table's outcomes are `'superseded'`, `'archived'` and `'kept'`. So the spec's "Kept" step maps to outcome `superseded`, and the `kept` outcome is never defined in the spec at all. Only the plan (Task 6, `draft.title === row.title && draft.body === row.body`) shows it means "the new reading is identical". A reader of the spec would map the "Kept" step to `outcome = 'kept'` and build the wrong thing.

- F-4 · Major · Spec §5 "--undo reverses the last run" together with "bounded by `--limit` and resumable" · Each process invocation is its own `run_id` (plan: `owner = pid-uuid`). Undo picks only the most recent `run_id`. A cleanup done as five `--limit 500` invocations, or resumed after a crash, therefore needs five `--undo` calls, and nothing says so. Neither the spec nor the README/CLAUDE.md text in Task 9 tells the operator what "the last run" means once a run has been resumed. A reader would believe one `--undo` rolls back the cleanup.

- F-5 · Major · Spec §6 first paragraph ("the labels file is refused inside the repository, as in the knowledge proof") vs plan Task 8 · `quality.ts` and `quality.sh` refuse only the live data directory (`assertNotLive`, and a work dir under `~/.wizardingcode`). Neither refuses a `--labels` path or a work directory inside the repository. That leaves `full.md` (real titles), the samples and the labels free to land in the repo, which is exactly the privacy rule the spec states. "The knowledge proof" is also never linked, so a reader can't copy its guard.

- F-6 · Major · Spec §1 `stripHost` table, rows `agent-message` vs `hand-back` · The `hand-back` row removes the frame lines "up to the report", which implies the subagent's report survives. The `agent-message` row removes the whole block, and in practice the hand-back sits inside that block. The plan's test asserts the report's knowledge ("The cart total is rounded once…") is removed. A reader can't tell whether a subagent's findings, quoted by the assistant, are meant to be kept or thrown away. That decides whether real knowledge is lost.

- F-7 · Major · Spec §1 "each pattern named so that the proof's report can say what it dropped" vs plan Task 1 · In the plan only the `dropNoise` sentence patterns have names. `stripHost` removals are anonymous, and the spec's named `hand-back`, `summary`, `agent-message` and `system-reminder` patterns do not exist as names. (`hand-back` was folded into the `host-frame` sentence pattern; `NOISE_PATTERNS` is pinned to exactly five names.) The proof cannot report what `stripHost` removed, which the spec requires so that a pattern dropping knowledge can be caught.

- F-8 · Major · Spec "Decisions" ("Only patterns with 97–100% precision") and the §1 rule ("a pattern enters only with 97–100% precision on a labelled sample") vs the §1 table · `protocol-tag` is listed at 0.88 and `verdict` at 0.80. Both are justified by an argument ("at sentence level the tagged sentence is the record"), not by a measurement. Of the others, `status-label` rests on 4 hits and `template-label` on 2. As written, the stated entry rule is contradicted by two of its own entries. A reader adding a pattern can't tell whether the bar is a measured 97% or a good argument.

- F-9 · Major · Plan Task 2, Step 7 ("Existing tests may now fail only where their expected body carried a `Context:` line… Any other difference is a bug in Step 6: fix the code, not the test.") · This step also changes the title rule (a title below `KNOWLEDGE_THRESHOLD` now gives way to another sentence, or there is no memory) and puts the noise filter into every turn. Existing fixtures can legitimately differ for either reason. An implementer following the instruction would "fix" correct code, or stall.

- F-10 · Major · Spec §5 "the drain lease is taken for the run, so live distillation waits" vs plan Task 6 (`DRAIN_LEASE_MS = 120_000`, renewed once per batch of 50) · The lease is renewed only between batches. A 50-turn batch at concurrency 4 against a slow or retrying TypeSafe can outlast 120 s. The lease then lapses mid-batch and the live drain can write memories for the same turns at the same time, which is the very thing the lease is meant to prevent. Neither document reasons about lease length against batch duration.

- F-11 · Major · Project terms used without definition or link, across both documents. A newcomer can't paraphrase the mechanism without these:
  - "the mem" (the product itself)
  - **TypeSafe** / "TypeSafe System One" and its "primitives" (`noul`, `choice`, `score`), "state paths" and "`candidates[i]` paths stay dense"
  - "the drain" / "drain lease"
  - "host" and "host notifications"
  - "the brief" and "the pinned snapshots of ADR 0022"
  - "consolidation" and "the consolidation guard", `findNeighbours`
  - `user_memories` ("the author's rules")
  - `withoutNotes`, `compact`
  - "history import"
  - "the viewer" and its "Back in use"
  - "the knowledge proof"
  - "the archived knowledge module's `episodic.ts`"
  - claude-mem (as a separate tool)
  - migration 7

  The ADRs (0005, 0017, 0021, 0022) are cited by number with no path. In particular, without knowing what a `noul` answer is, or that the state is addressed by path, §2 cannot be followed.

- F-12 · Major · Plan "Crew" section and Global Constraints · The workflow assumes a lot of setup it never states:
  - a plugin installed at `~/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.1.4/dist/crew.mjs`
  - the `crew` command being available on PATH (later steps run `crew tdd red <id> …`, not `node …crew.mjs`)
  - an `<id>` whose source is never given (presumably the output of `start`)
  - "the nine typed questions"
  - "`references/understand.md`, `specify.md` and `plan.md` of the crew skill"
  - the "superpowers:*" skills

  A new implementer cannot carry out the gating steps the constraints make mandatory.

- F-13 · Major · Label vocabulary, across spec §"Why", §6 and plan Task 8 brief/`quality.ts` · The spec's four labels are Knowledge/Mixed/Record/Fragment. §6 metrics then say "`keep`" and "turns labelled `record`". The brief and the code use `keep|episodic|fragment|mixed`. Someone implementing `measure` from the spec would count `record`, which the labelling agent never emits, and the metric would silently read 0%.

- F-14 · Nit · Spec §6 metrics table and plan Task 10, Step 4 · Rehearse runs a full dry run and then a full real run, and both make every request, so it costs about 10 M tokens (≈ $0.42), not the "about 5 M input tokens (≈ $0.21)" stated. Separately, the "Title-only 16%" figure listed under "Before (sample of 2026-10-13)" actually comes from the store-wide count (411/2,513), not from the sample.

- F-15 · Nit · Spec §5 "writes a new memory of the same turn with `source_ordinal = 1`" vs plan `nextOrdinal` (MAX+1) · After an undo and a rerun the ordinal will be 2. The spec's fixed value is misleading.

- F-16 · Nit · Spec §5 "The dry run" · This lists a "skipped by the filter" count and a report named `rejudge-distilled-<date>.md`. The plan prints no such count (filter-emptied turns are counted as `archived`) and names the file with a timestamp. The plan also writes the report on real runs, not only dry runs.

- F-17 · Nit · Spec §5 says the command "Needs a TypeSafe key… without one it says so and does nothing". The plan lets `--undo` run without a key (which is reasonable), but explains it in a garbled sentence: "The "needs a key" check runs before the `--undo` branch is not required: undo needs no judge, so it comes first, as written."

- F-18 · Nit · The spec §4 heuristic is not quite what the plan builds:
  - The status-verb list includes "done" and "feito", which the plan drops on purpose.
  - The 60% report share is computed only over `final` sentences, not over "its candidate sentences".
  - The "floor 0.05" does not appear in the plan's code.

  The spec should follow the plan, or the reverse.

- F-19 · Nit · Spec §3 "Facts: … at most `MAX_FACTS = 5`" · The plan takes five, then removes the title, so a memory can have only four facts (the test pins exactly 4). Whether the title counts toward the 5 is never stated.

- F-20 · Nit · Spec §2 `importance = round(score) + 1` · The range of `score` (0–4) is never stated. A few smaller unexplained items:
  - The fallback version string `"1+1"`/`"2+2"` is mentioned in plan Task 4 and never explained.
  - `buildDraft` returns null when `kind === "none"`, a rule the spec never states.
  - `status-label` is case-sensitive (the plan's test expects `state:` to pass), which the spec doesn't say either.

- F-21 · Nit · Plan Task 6, Step 3 note ("`withWrite` must return the callback's value (it does: `src/store/meta.ts` already returns through it)") · `withWrite` is defined in `src/store/db.ts:182`. The sentence reads as if it lived in meta.ts.

- F-22 · Nit · Plan Task 10 uses `<scratchpad>` and "the Agent tool, general-purpose" with no definition. These are agent-session terms, not project terms, and a human implementer has no referent for them.

## Not answerable
- Claims about existing code and ADRs: that `findNeighbours` excludes the memory's own turn, the behaviour of `isFromTheHost`, `withoutNotes` and `consolidate`, the ADR 0005 token figures, the 2026-10-13 sample counts, and the existing golden-set size of 32. I did not read `src/` or `docs/adr/` beyond one grep, because the reading list was the spec and the plan only.
- Whether `sqlite3 -readonly … ".backup"` works against a live database in WAL mode with no writable `-shm`. This can't be checked from the documents.
