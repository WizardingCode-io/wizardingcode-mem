# code-quality findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-code-quality
read: 5 files, 4 hunks

## Round 5 state, checked against the current diff
- Round 5 F-1 still holds and nothing has changed. src/team/store.ts:640 still reads `PRAGMA busy_timeout` outside the `waitMs !== undefined` branch (:641, :646).
- Round 5 F-2 still holds and nothing has changed. The generator `pendingRevisions` at src/team/mirror.ts:360-373 still repeats the seq-keyed batch loop of `forEachRevision` (src/team/store.ts:617-631).
- tests/unit/knowledge-git-host.test.ts (diff lines 11704-11812) is formatting only. Two `runGit` calls are wrapped at the line width: the `thrown(() => runGit(...))` at :47-49, and the multi-line `runGit(host, ..., { operation, readOnly, timeoutMs })` call at :51-55. The `commitPaths(...)` arguments at :90-98 are one per line. No test name, assertion, argument or value differs from a plain reflow.
- docs/real-use/findings.md (hunk @@ -32,4 +32,14) adds rows only. Line 35, the old erasure row, keeps every word and only gains `; ADR 0026 names \`serve forget <member id>\` as the server's follow-up`. That source exists: docs/adr/0026-team-server.md names `serve forget` at :94 and :114. Each row at :36-45 restates findings the round-5 ruling upheld, in the ruling's own terms, with no fact, hedge or scope limit changed. Line 44, for example, matches this gate's two round-5 advisories plus the architecture advisory.

## Findings
- F-1 · advisory · src/team/store.ts:640 · `checkpointWal` reads `PRAGMA busy_timeout` even when `waitMs` is undefined, as both mirror.ts callers leave it, so for them the read does nothing; reading it inside the `waitMs !== undefined` branch would tie it to the one case that uses it (Q5; carried from round 5, recorded as deferred at docs/real-use/findings.md:44).
- F-2 · advisory · src/team/mirror.ts:360 · The generator `pendingRevisions` repeats the seq-keyed batch loop of `forEachRevision` (src/team/store.ts:617-631), which is duplicated boilerplate, not logic (Q2; carried from round 5, recorded as deferred at docs/real-use/findings.md:44).

## Outside the change
none

## Not answerable
- Q11 (the new findings.md rows against references/writing.md) · I was not given writing.md. I checked the rows only for facts kept and sources named, against review/ruling.round5.json and docs/adr/0026-team-server.md, and found no drift.
- Q2/Q8 across the rest of the diff · This round reread only the hunks that changed since round 5 (the git-host test, findings.md) and the two lines carried from round 5. The other files are taken as round 5 left them, since the caller reports no source change other than the formatting.
