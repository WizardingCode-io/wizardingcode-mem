# Conclave: the gap round

Checklist read: `auth` (the change handles a token that grants writes to two repositories). `sync` was read for the parent item and adds nothing here: no target, order or record of the distribution changes.

## Assumed by good practice

- The token is never in a URL, an argument or a log. The parent item put it in an authorization header in the child's environment; this item closes the encoded form of that header in what the script itself emits: redacted in every text git answers (AC-9, AC-19).
- The check is in one place and not in the caller: the redaction wraps the runner inside `commitAndPush`, so no failure sentence or dry-run line is built from unredacted text (AC-9).
- The default is deny: the command reads no destination from its environment (AC-11). `gitEnv` is unchanged: with a token set, the calls that carry it (clone, push, `pull --rebase`) discard inherited `GIT_CONFIG_KEY_n`; every other git call runs with the environment as inherited.
- A step that only starts another workflow has a short time limit (AC-6), and the runbook says what the person does when it is cut (AC-13).
- What was tested through an override stays tested without it (AC-12, AC-17).

## Decisions only the user can make

- The scope: the request's fourth change (one rule for reading a staged binary's version) moves to the next item of the parent concept. The author was told on 2026-11-12; the brief records it as an assumption they can reverse before the spec is approved. It grants nothing and removes nothing already delivered.
- Who holds the permission: unchanged, the author alone (D-3, D-4, D-9 of `2026-11-11-004`).

No decision is open.

## Proposals

- Isolating the token's git from global and system configuration (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`). Not taken: the four external writes have never run, and a change to how git is configured before the first real run cannot be tested here. This item writes it as an open row of `docs/real-use/findings.md` (AC-21).
- A time limit on each git call of `push.ts`. Not taken: outside the three changes; written in the same row (AC-21).
- A `credential.helper` in place of the header. Not taken (the spec's Alternatives).

## Warnings

- That 5 minutes covers `gh workflow run` under GitHub API latency is seen only in a real run. Stated in the spec's Risks. Advisory.
- That the runner masks the token's base64 inside the header rests on its source as read on 2026-11-12, and is not tested here; whether that masking reaches the step summary is not established. The design does not depend on either: the redaction covers what the script emits. Advisory.
- The warnings of the first draft about a `::add-mask::` line no longer apply: the line was removed (last section).

## The leads' validation, round 1

All four leads returned the spec on 2026-11-12 (9 returns; `conclave/lead-*.md`). None asked for a change of the design. What changed in `spec.md`:

- What a second run for a tag does is said per target, with the exception after a write reverted by hand (devops R-1): J-4, Design 3, AC-13. From the notes: "cut (cancelled or failed)", look again after a minute, either way of starting the second run, the rollback of change 3.
- The documents are in the Design and have criteria: `docs/real-use/findings.md` with its open row (architects R-1, security R-1): Design 4, AC-18; ADR 0029 and `CLAUDE.md` carry the two rules a later change must keep (architects R-2): AC-15.
- What `gitEnv`'s overwrite covers is said as the code does it: the token's calls only, and only with a token (security R-2): Design 2, and this file's "Assumed by good practice".
- AC-11 (was AC-4) says what git's log shows for each target, on a stub that reaches the clone (qa R-1).
- The command's cases kept on a stub `git` are listed and held by AC-17, a preserve criterion (qa R-2).
- AC-16 (was AC-8) names its three cells and a git that does not quote the header (qa R-3).
- AC-9 (was AC-1) names the five sentences, the tag read included, and the complement: a text without the value byte for byte, nothing replaced with no token (qa R-4).
- From the notes: the wrapper sits on `options.runner ?? run` and passes the environment through; `redact` replaces by literal string; the mask line goes through `process.stdout.write`, before `need("VERSION")`, and is never in the summary file (AC-10); the test file of each criterion is named.

The criteria whose text changed were retired and recorded again (AC-9 to AC-17); AC-6 kept its id.

## The leads' validation, round 2

Security, architects and devops validated on 2026-11-12 (`conclave/lead-*-reply.md`). QA returned once more (R-1): the words AC-14 listed are already in `docs/real-use/findings.md` as the deferred advisories, so its test had no red. AC-14 was retired and recorded again as AC-18, which names what is absent today: the answered rows cite item `2026-11-12-005` and are no longer `deferred`, the version rule's row names piece 2, and a `deferred` row names `GIT_CONFIG_GLOBAL`, the missing time limit and `MARKETPLACE_TOKEN`. From the notes, into the plan: the runbook's paragraph sits outside "What a run shows" and its test looks inside that paragraph; the `CLAUDE.md` test cuts the Releasing line out first.

## After the spec review, round 1

The review's round 1 closed clean on 2026-11-12 with ten Major findings answered by a fix (`spec-review/`). The one that changed the design: the spec said Actions does not know the encoded form of the token. It does. The runner registers the base64 of every secret at three byte alignments (`ValueEncoders.cs` in `actions/runner`, read on 2026-11-12), and the prefix `x-access-token:` is 15 bytes, so the token's base64 sits whole inside the header's and is masked in the log. The `::add-mask::` line therefore added nothing there, while printing the whole encoded credential to standard output on purpose. It is removed, with its ordering rule and its `GITHUB_ACTIONS` gate. The redaction inside the script stays: nothing shows the runner's masking reaches the step summary file, and off a runner nothing masks.

Criteria: AC-10 and AC-16 (the mask line) are retired; AC-19 holds the redaction at the command; AC-20 replaces AC-13 (the paragraph's place); AC-21 replaces AC-18 (the answered rows cite the item, the open points are named in the file, with no test on which rows stay deferred); AC-22 replaces AC-15 (redaction by exact match, why no mask line). The assumed-by-good-practice lines above that cite AC-10 now read AC-19.
