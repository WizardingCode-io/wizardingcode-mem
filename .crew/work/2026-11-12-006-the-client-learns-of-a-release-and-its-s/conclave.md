# Conclave: the gap round

Checklist read: `sync` (the change reads one third party, github.com, on a schedule). `auth`, `endpoint`, `migration-or-restore` and the others do not apply: no permission, no route, no schema and no stored format of the store changes.

## Assumed by good practice

- One side is the truth: github.com's latest release. The client only reads it; what it keeps (`<data dir>/update.json`) is a copy with its time, and a failed read never replaces the last known value (AC-2).
- Runs are idempotent and bounded: at most one request in 24 hours per data directory, a backoff after a failure, a time in the future treated as stale (AC-2). Two processes ending a turn together make one request, or at worst two.
- The third party's answer is untrusted: only a redirect of one exact shape counts, the body is never read, nothing is downloaded and nothing is executed (AC-1).
- A failure is never silent and never fatal: the reason is kept and shown (AC-5), and the drain's exit code does not change (AC-4).
- The default for the unknown is no request: an unknown value of the key, CI (AC-3).
- No work on a hook's path, and none in the tests' hooks: the check is a step of `distill`, which `WIZARDINGCODE_MEM_DISTILL=off` keeps from starting.
- A person is told what changed on their machine in the place they are looking: the line a channel copy prints when it stages itself or hands over (AC-7, AC-8).

## Decisions only the user can make

- D-1, the scope: answered on 2026-11-12, tell and add the two pieces with no network; the self-replacement is a later item.
- D-2, the default of the daily request: answered on 2026-11-12, on, notice only.

No decision is open. One cut made in the spec is said to the author with the spec: the viewer's About line and a Settings field for the key are the next item, with their captures, so D-7's third place (About) is not in this one. It defers and removes nothing decided.

## Proposals

- A `doctor` line for the staged binary's version when it differs from the copy typed. Taken, as the second line of the `update` report (AC-5).
- A unique temporary name in `stageBinary`. Taken (AC-7): this item adds a writer of the staged binary, and the fixed `<target>.new` let two writers rename each other's half-written file.
- A lock shared by every writer of the staged binary (the plugins' script, the npm shim, the OpenCode package, `install.sh`, `install`, and now a channel copy). Not taken: four of them are shipped scripts that would not change on machines that hold them; recorded in ADR 0030's limits.
- Waiting a day before telling, so the channels have published. Not taken: `distribute.yml` runs within minutes of the release; the limit is stated.

## Warnings

- github.com's real answer to `releases/latest` (the redirect's exact shape, its behaviour while a release's assets upload, its rate limiting of one address) is seen only on a real release. The check fails closed to a stated reason. Advisory.
- A person who runs a newer downloaded copy once moves the agents to it, and that copy may migrate the store at the next session. The line says so; the way back for the binary is `install --force` (ADR 0029), and a migrated store then refuses the older binary. Stated in the spec's Risks. Advisory, and the author chose this behaviour in D-1.
- The README's header changes from "nothing leaves your machine unless you ask" to "none of your data leaves your machine unless you ask". It is the product's first line; the author reads it in the pull request. Advisory.

## The leads' validation, round 1

All four leads returned the spec on 2026-11-12 (19 returns; `conclave/lead-*.md`). None contested the design's direction. What changed in `spec.md`:

- The request's content is stated and tested, the state file is read strictly so none of its bytes reaches a terminal unshaped, and the README's second absolute sentence is rewritten (security R-1 to R-3): Design 1 and 4, AC-10, AC-11, AC-21. From the notes: no reconciliation as root or over a `bin` folder of another owner, real paths compared, the temporary file never written through a link, `latest` never kept as a maximum, and the sentence that `latest` must never start a download.
- Where `reconcile` sits in `main()` and how it is loaded; the commands as one constant; one hand-over function that `install` also calls; the check outside the store's `try`; the README's sentence on the viewer's settings; a boundary test for `src/update/` (architects R-1 to R-6): Design 1 and 3, AC-13, AC-16, AC-18, AC-20, AC-21.
- The reconciled commands are now four (`status`, `doctor`, `update`, `ui` without `--auto`) in place of "every command a person types": `backup` and `history` are also started by the hooks, and `uninstall` would stage a binary while uninstalling (architects R-2, devops R-2). The other commands behave as today; stated as a non-goal.
- The release runbook says that clients are told from the GitHub release and how a notice is withdrawn; `--version` and the like never reconcile; a staging that fails does not stop the command; the tests never reach github.com (devops R-1 to R-3): Design 1, 3 and 4, J-8, AC-16, AC-17, AC-19, AC-21.
- The tests' seam is `run(args, deps)` called in the test's process with a fake `fetch`, and the preload turns the check off; the time limit is a parameter; the attempt's time is a field with its rule; the temporary files' rules are observables; the decision is a pure function with its table; the "out" sentence is defined against the current version, staged or running (qa R-1 to R-7): Design 1 to 3, AC-10, AC-11, AC-14, AC-16, AC-17, AC-19.

Two leads asked for opposite test seams (an address the tests point at a local server; no destination read from the environment). The second was taken, and the first is in the spec's Alternatives.

The criteria were retired and recorded again (AC-10 to AC-21).

## The leads' validation, round 2

Security, architects and devops validated on 2026-11-12. QA returned once more (R-1): the list of reconciled commands sat in `src/cli/main.ts`, which a test cannot import since it runs at load, so the command half of AC-16 had no unit test. It is now `reconciles(name, rest)` in a leaf, `src/cli/reconciled.ts`, with its own table in `tests/unit/update-reconcile.test.ts`. From the notes: a time in the future makes the check due before the 60-second rule is read; `update` ignores a fresh attempt. No criterion's text changed.

## After the spec review, round 1

The review's round 1 closed on 2026-11-12 with 25 Blocker and Major findings, each answered by a fix (`spec-review/`). What changed in `spec.md` and `plan.md`:

- The redirect's shape had no backing: the spec said `scripts/install.sh` relies on it, which is false. It is now backed by a probe of github.com (`probes/releases-latest.md`: a 302, an absolute `Location`, the request's letter case).
- Stated as limits, in place of claims: nothing checks from the hooks when the store cannot be opened or no turn ends; an install made with `--binary` runs another path; reconciling does nothing on Windows; a repository renamed strands the notice.
- The backoff is flat (one hour after a failure), so the README's sentence about requests is true as written; `due` is total, with the case of an attempt that never finished.
- `stageBinary` reads the staged version itself just before it copies (the `known` option is gone), and `stagedVersion` is remembered for the process.
- `decide` only guards (`skip` or `compare`); the command names are a list in the leaf that `main.ts` is typed by.
- The plan reuses `writeFileAtomic` and `ago`, gives every caller one `stagedFacts`, decides `status --json` with a store that cannot be opened, the off sentence of `update`, and the preload set unconditionally.

Criteria: AC-11, AC-14, AC-15 and AC-16 are retired; AC-22 to AC-25 replace them (the flat backoff; Windows and the command list; the lines' table with the `--json` case; `update` when off). The lines above that cite the retired ids read as the new ones.

## During the spec review, round 2: D-3

The design reader of round 2 showed that a newer copy staging itself from `status` or `doctor` would take effect in the open session: the hooks run the staged path at once, while that session's MCP server, sync and viewer stay on the old binary, which is the blocker that deferred the self-replacement. The author decided on 2026-11-12 (D-3): the newer copy only tells, and names `wizardingcode-mem install`. `spec.md` and `plan.md` were changed for it before the round's last stage, so the readiness readers read the plan that will be built: the hand-over of an older copy stays; nothing but `install` stages; `stageBinary` is not changed. Criteria: AC-17 is retired; AC-26 replaces AC-24 (the second line's three forms, and that no command but `install` stages); AC-27 replaces AC-20 (the six folders, and the leaf).

## After the spec review, round 2

The review's round 2 closed clean on 2026-11-12, its 20 Major findings each answered by a fix. Beside D-3, what changed: a release already found stays announced when a later check fails; the off line says where the value came from, since a shell's export does not reach a hook started elsewhere, and the file is the documented way to turn the check off; the automatic check never runs in CI while a typed `update` asks anywhere but when off; the hand-over's limit (only copies that carry this item) is stated; the `update` check of `doctor` is appended by the command, outside `runChecks`, so the viewer is untouched; `atomic-write.ts` and `stageBinary` are not changed; the state loses its unused failure count. Criteria: AC-12, AC-22, AC-25 and AC-26 are retired; AC-28 to AC-31 replace them. The final set: AC-10, AC-13, AC-18, AC-19, AC-21, AC-23, AC-27 to AC-31.
