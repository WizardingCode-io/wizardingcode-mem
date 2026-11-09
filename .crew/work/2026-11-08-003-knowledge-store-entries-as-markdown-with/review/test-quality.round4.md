# test-quality findings for 2026-11-08-003-knowledge-store-entries-as-markdown-with
reviewer: review-test-quality
read: 5 test files (the round-four hunks of tests/unit/knowledge-repo.test.ts, tests/unit/knowledge-resolve.test.ts, tests/integration/knowledge-cli.test.ts, tests/unit/module-migrations.test.ts and tests/helpers/stub-git.ts, read against repo.ts, index-store.ts, store.ts and src/cli/commands/knowledge.ts), 19 criteria

## Findings
- F-1 · advisory · tests/unit/knowledge-repo.test.ts:193 · The template test holds the change it names, but nothing holds the empty template name itself (Q1). Going back to the `.template` folder would make it fail: the filter in the copied config runs on the first `git add`, or the config contains "filter". Dropping `--template=` from `createRepository` would leave every test green, though. `gitEnv` builds the environment from nothing and the global config is `/dev/null`, so git would copy its built-in template. The test at line 203 creates `.git/hooks` with `recursive: true`, and no test checks that `.git/hooks` or `.git/info` are absent after `ensureRepo`. ADR 0024 promises "git init is given an empty template name"; no criterion names it, hence advisory.
- F-2 · advisory · tests/unit/knowledge-repo.test.ts:1183 · `clearIntent` gained `recursive: true` so that a folder left at the record's path is removed. The "not a file" half of the test only checks that `readIntent` returns null and never calls `openRepo` after `mkdirSync(record)` (Q1). If `recursive` were dropped, `rmSync` would throw on the folder from every `openRepo`, leaving the repository refusing every command, and the test would stay green. One assertion holds it: `openRepo` succeeds and `existsSync(record)` is false.
- F-3 · advisory · tests/unit/knowledge-repo.test.ts:1187 · The rejected-record branch of `revertInterrupted` now runs under `underOwnLease`. Before, it was guarded by `leaseHeldElsewhere`. No test holds that a rejected record is left alone while another live process holds the lease: the test at line 1323 uses a record the store can read. Replacing `underOwnLease` with a direct call in that branch leaves every test green. The new `started` rule (a `locked` raised once the step has begun is thrown, not swallowed) is held by no test either, in `revertInterrupted` or in `learnAliases` (Q1).
- F-4 · advisory · tests/integration/knowledge-cli.test.ts:489 · Three behaviours of this change are not held (Q1). The rest of the test does hold the change: it fails for each of `list`, `rebuild` and `adopt` when its catch is removed. It also holds `rebuildAll`'s own per-repository catch through `rebuild`: without that catch the throw reaches `run` before any line is printed, so stdout lacks `knowledge/workspace`.
  - (a) Catching only code `invalid`, in `rebuildAll` (index-store.ts) and in `isRefusal`. Catching every `KnowledgeError`, a `git` fault or a `locked` included, leaves this test green.
  - (b) `adoptAll`'s inner catch around `adopt()`. The fixture is refused in `opened()`, never inside `adopt` itself (for example adopt's refusal of a nested repository).
  - (c) The "nothing" line being suppressed when every repository is refused.
- F-5 · advisory · src/modules/knowledge/store.ts:906 · The reordering in `adoptIn` (the record is written first, then the kept bytes under the name it gives) is held by no test. Swapping the two lines back leaves the suite green. The removal it enables (`dropKept` for a rejected record) is held at knowledge-repo.test.ts:1187.
- F-6 · advisory · tests/unit/knowledge-index.test.ts:335 · Carried from round three (F-3): no test adds a file during a write's `git add` and `git commit`. The ADR states this window as a known limit.
- F-7 · advisory · tests/unit/knowledge-index.test.ts:314 · Carried (Q5): the rebuild-order test depends on the internal renewal count.
- F-8 · advisory · tests/unit/knowledge-store.test.ts:440 · Carried (AC-8): only the `git --version` probe times out; no git call inside the write does.
- F-9 · advisory · tests/unit/knowledge-repo.test.ts:534 · Carried (AC-8 "killed"): only the "timed out" message is checked, not that the process is gone.
- F-10 · advisory · tests/unit/knowledge-repo.test.ts:315 · Carried (AC-2): the parent's `.gitignore` holds `data/`, so the parent's empty status at line 343 proves nothing. The ceiling guard is held by the environment test.
- F-11 · advisory · tests/unit/knowledge-repo.test.ts:562 · Carried (AC-13): clipping is checked on the thrown message, not on the log line.
- F-12 · advisory · tests/unit/knowledge-resolve.test.ts:85 · Carried (AC-2): the gained-remote test resolves through the `knowledge_repos` row. The manifest path is covered elsewhere, without a gained remote.

No defects. Read against the code before the fix, each new test fails when its change is undone:
- **Files left beside the repositories (knowledge-repo.test.ts:174, 182, 193).** Each fails if the store goes back to its support folders.
  - 174: `core.hooksPath` would again point at `.no-hooks`, and its `pre-commit` writes the marker.
  - 182: `ensureSupportFolders` keeps an existing `.gitconfig-empty` (`if (!existsSync)`), so `GIT_CONFIG_GLOBAL` would read its `attributesFile` plus `filter.x.clean`, and `git add` runs the filter.
  - 193: the copied template config and `info/attributes` would run the filter at the initial commit, or the config assertion fails.
  - Line 152 fails on `readdirSync` (`.template`, `.no-hooks` and `.gitconfig-empty` reappear).
- **Hooks path as a file (line 203).** Dropping `core.hooksPath` brings back `.git/hooks`, and the three hooks write the marker. That is as far as "a file as the hooks path" can be held: nothing can be put inside a file.
- **Linked folders.**
  - Line 1128: without `reachedByFolders` in `stateOf`, the victim's hash matches `written`, so `restoreToHead` reaches `undoStaged`. That either throws out of `openRepo` (when its own check stays) or removes the victim through the link (when it does not).
  - Line 1142 holds the `stateOf` check on its own. Without it, every `openRepo` throws on `undoStaged`'s refusal and the record is never cleared.
  - Line 1153 holds `undoStaged`'s check directly: without it, `rmSync` removes the file beyond the link.
  - The check in `restoreKept` is not reachable past `refuseForeign`, which already refuses an `entries` that is a link.
- **The record.** Line 1167 fails without `readRegularFile`: the old `readFileSync` followed the link and returned an intent. Line 1187 fails without `dropKept` and without the report.
- **The `.gitmodules` half (line 1528).** The probe at .crew/work/2026-11-08-003-knowledge-store-entries-as-markdown-with/probes/submodule-layers.md settles round three's open question. With `ignore = none` in `.gitmodules`, the `-c diff.ignoreSubmodules=all` layer gives way, and only the `--ignore-submodules=all` flag keeps the filter from running. So dropping only the flag now fails this half (round three's F-1 is resolved). I weigh this on the probe, which ran `statusOf`'s arguments without the flag on the test's own fixture. Nobody ran this test itself with the flag removed.
- **Formats (line 480).** The stub's `prepend` puts `sha256` and `reftable` ahead of the store's `-c` settings, so without the two init settings `extensions` appears in `.git/config` and the next `openRepo` refuses. This was seen red with the settings removed (round three's F-2 is resolved).
- **Alternates (line 1369).** Fails without the `REFUSED_FILES` entry.
- **Resolve, knowledge-resolve.test.ts:167.** Without the record, the old `learnAliases` leaves `M  knowledge.json` staged. The next `ensureRepo` then finds the alias already on disk and returns, so the clean-status assertion fails. The `failOnce: "restore"` stub hits `undoStaged`'s `git restore`.
- **Migration, module-migrations.test.ts:206.** Fails without the `DELETE FROM meta`. The `kept.by.the.core` row guards against deleting too much.

Nothing is true by construction: each assertion reads what real git or the store left on disk, never a stub's own answer. No fixture uses a real name (`example.invalid`, `the-persons-folder`, `x`).

## Outside the change
- none

## Not answerable
- Q7 (mutation) · no mutation report was named for this item.
- Whether the `.gitmodules` half of knowledge-repo.test.ts:1496 goes red with only the flag dropped · the probe ran the same fixture and the same arguments and showed the program running; the test itself was not seen red that way.
