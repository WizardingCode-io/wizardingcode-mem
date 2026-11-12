# Concept brief: the client learns of a release

## Overview

Piece 2 of the concept `2026-11-11-004` ("updated everywhere on release"). The hypothesis (`probes/concept.md`) had the client check for a release once a day and replace its own staged binary. Six lenses read it and found four blockers, all in the replacement. On 2026-11-12 the author narrowed the item: it tells, and it does not replace.

What this item does:

1. **A daily check that only tells.** Once a day the client asks github.com which release is the latest. It never downloads or replaces anything. `status`, `doctor` and the viewer's About show the version this command runs, the version of the staged binary the agents run, the latest known and when it was checked, with the reason when the last check failed and, when a newer release exists, one command per channel to get it. On by default; `WIZARDINGCODE_MEM_UPDATE=off` makes no request.
2. **A newer copy stages itself.** A `wizardingcode-mem` run by a person from outside the data directory (the Homebrew copy, a global npm copy, a downloaded binary) that is newer than the staged binary puts itself in `<data dir>/bin`, as `install` already does, forward-only. After `brew upgrade` the agents follow at the person's next command, with no network.
3. **An older copy hands over.** A `wizardingcode-mem` run by a person that is older than the staged binary runs the staged binary with the same arguments, as `install` already does (`binaryOrHandOver`, `src/cli/commands/install.ts`). `doctor` typed from an old Homebrew copy then never meets a store the staged binary migrated.

## Analysis

**The replacement's four blockers (design, readiness, codebase, structural).** (a) The concept had `mcp` and the viewer end themselves on "the store's recorded binary version"; nothing records a binary version in the store, and the sync's "a newer version takes over" is only the version inside a lease owner's name (`takeOverLease`, `src/store/meta.ts`). (b) That takeover does not even happen after an update: `startSync` answers "running" for any live lease and compares no version (`src/sync/spawn.ts`). (c) The viewer and the sync open the store once and never check its schema again, so after a newer binary migrates it they keep writing to the newer schema; `mcp` opens it per call and fails every call instead of ending. (d) `install --force`, ADR 0029's way back, is undone by the next daily replacement. Around them: whoever can publish a release gets code run on every machine within a day, since `checksums.txt` travels with the binary and signatures do not exist; a bad release reaches the whole fleet with no hold and no skip list; six writers of one file with no lock and a fixed temporary name (`stageBinary`); 0.4.4 npm shims that put their own version back on any difference; a store migration that happens without the person acting, with no command to restore the upgrade copy.

**What the check must not do (design, codebase, readiness).** Use `api.github.com`: 60 unauthenticated requests an hour per address, shared behind one NAT. `scripts/install.sh` already reaches the latest release through `github.com/<repository>/releases/latest`, a redirect to the tag, with no API call. Start from the hook as a fifth detached process, under a lease copied from the sync: a daily task needs neither. Keep its state in the store's `meta`: the state is about the binary, the store can be on another disk or be refused by an older binary (`SchemaTooNewError`), which is when the notice matters most. Fold every failure into "unknown": `status` and `doctor` need the reason. Trust a timestamp in the future. Run in CI or in the tests.

**What a person must be able to see (comprehension, codebase).** Three versions, apart: the copy they typed, the staged binary the agents run, the latest known. Today no `doctor` check shows the staged binary's version, and `status` reports the version of whatever was typed. "The one command for this install's channel" cannot be computed, since nothing records a channel and a machine often has several; the parent decision D-7 reads as one command per channel, so the notice lists them. A setting the README says can be changed from the viewer needs its field in Settings. The README's line "No telemetry, no account, no network — except…" and "nothing leaves your machine unless you ask" must be rewritten, not only the privacy section.

**What already exists (zoom-out, codebase).** `binaryOrHandOver` hands `install` over to a newer staged binary. `stageBinary` stages forward-only. The post-drain steps of `distill` (`healVectors`, `suggestLinksSafely`, `proposeRulesSafely`) are guarded background work that never runs on a hook path and is off in the tests with `WIZARDINGCODE_MEM_DISTILL=off`. `src/util/version.ts` orders versions.

**The version-reading rule (zoom-out, structural, readiness).** Bringing the five readers of a staged binary's version to one rule does not belong here: this item uses one of them (`stagedVersion`). "Within 10 seconds" cannot be enforced portably in the two POSIX shell readers. It stays deferred, as its own item.

## Goals vs. Non-Goals

Goals:

- A person learns within a day or two that a release exists, without the product downloading or changing anything.
- After a channel's own upgrade, the staged binary follows at the person's next command.
- A person never runs an older copy against a store a newer staged binary migrated.
- The request is named plainly, can be turned off, and is off in CI and in the tests.

Non-goals:

- A binary that replaces itself from the network. Its own item, after release assets are signed or a hold signal exists, with the four blockers answered.
- Ending or restarting long-lived processes on a version change.
- Detecting the install channel.
- One rule for reading a staged binary's version (its own item).
- The hook-contract compatibility test: this item creates no new way for a binary to run ahead of its plugin (forward-only staging already allows it; ADR 0029 lists it).
- The team server's upgrade (piece 3).

## Alternatives Weighed

- **Self-replacement on every channel** (the hypothesis, D-6). Rejected by the author on 2026-11-12 for this item: four blockers, and the risk of a published release running everywhere within a day with no signature.
- **Self-replacement only where no channel manager exists** (`install.sh` and direct installs), the swap deferred to the next session start. Rejected for this item: it keeps the bad-release and replaced-asset risks.
- **No check at all; the channels' managers do the work.** Rejected: direct installs and `install.sh` have no manager, and a plugin whose marketplace is not refreshed tells nobody.
- **The check off by default.** Rejected by the author: who does not turn it on goes on not knowing.
- **`api.github.com/repos/…/releases/latest`.** Rejected: the rate limit per address, and a second host to name.
- **A detached process from the session-start hook under a lease.** Rejected: one more spawn on the hook's path and a lease among the store's, for a task that runs once a day; a step after the drain is already off the hook path and already switched off in the tests.
- **State in the store's `meta`.** Rejected: it is about the binary, and an older binary that the store refuses could not read it.

## Key Decisions

- K-1 (the author, 2026-11-12): this item tells and does not replace; the replacement is a later item of its own.
- K-2 (the author, 2026-11-12): the check is on by default, notice only; `off` makes no request.
- K-3: the latest version is read from github.com's `releases/latest` redirect, never from the API; the tag's `v` is removed; only a plain version counts; a pre-release is never the latest.
- K-4: the check runs as a guarded step after the drain, at most once in 24 hours, sooner again after a failure only by a stated backoff; a timestamp in the future counts as stale; never in CI.
- K-5: the check's state (latest, when, the last failure's reason) is one file in the data directory, beside the binary it describes.
- K-6: one comparison at the start of a person's command decides both remaining pieces: this copy is newer than the staged one, it stages itself; older, it hands over; equal, it goes on. Never for `hook`, `mcp`, `sync`, `distill` or any command the agents and the background run.
- K-7: the notice lists one command per channel; no channel is detected.
