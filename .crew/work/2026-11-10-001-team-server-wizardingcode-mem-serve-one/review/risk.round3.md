# risk findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-risk
read: ADR 0026 ("The mirror", "Purge"), round 2 findings and ruling, 8 files (the spec and plan were not reread this round)

## Round 2 advisory F-1 (src/team/mirror.ts:485, nothing durable recorded an owed replay)
- Answered, with one gap (see F-1 below). The purge now writes `mirror.replay` inside the erasure's transaction (mirror.ts:653). `replayOwed` clears it only when the replay adds no failure (mirror.ts:551-553). `runMirror` replays the owed folders before it exports anything (mirror.ts:437-438), and the export then skips the folders that failed (mirror.ts:439, 447). A purge that is killed, or whose replay fails, is finished by the next scheduled run once the 120 s lease goes stale. A `--rebuild` clears the note (mirror.ts:434), which is correct because a rebuild replays everything. ADR 0026:78 now describes this behaviour.
- The batched reads add no correctness risk I can find. `pendingRevisions` (mirror.ts:355-365) moves its cursor by `seq`, and `setMirrorRevision` only removes rows that are already behind the cursor. In `replayFolders`, the cached `mirror_revision` per uuid (mirror.ts:503-513) cannot go stale, because only the lease holder changes that column. Revisions the server pushes between batches are above that mark, so the replay skips them and the next export picks them up. No snapshot spans a batch.
- The checkpoints add a small risk of their own (F-2 and F-3 below).

## Findings
- F-1 · advisory · src/team/mirror.ts:653 · `setMeta` is an upsert (src/store/meta.ts:12), and the purge writes only its own `touched` folders. It neither merges a note that is already owed nor replays it first. Suppose purge A's replay fails or is killed, and the operator then purges B before a scheduled run, for example while working through several items in one erasure request. B overwrites A's folders in the note. When B's replay is whole, the note is cleared, and a folder only A touched (say a project repository) stays half replayed. The next run's `meta.mirror.last` then shows `error: null`, so the gap is invisible. The database stays intact and `serve mirror --rebuild` repairs it. The fix is to union the existing note with `touched` before writing it.
- F-2 · advisory · src/team/store.ts:634 · `PRAGMA wal_checkpoint(TRUNCATE)` runs on the CLI's connection, which has a 5 s busy timeout (src/team/db.ts:122). While it waits for readers it blocks new writers. So each purge can stall the running server's pushes for up to about 5 s, twice per purge (mirror.ts:664 and 681). A push whose own busy timeout expires first fails for that request. The stall is bounded, operator-initiated and rare, and no client exists yet.
- F-3 · advisory · docs/adr/0026-team-server.md:78 · On `wal: busy` the ADR says "the next checkpoint cuts it". But the only truncating checkpoint is in the purge (mirror.ts:664, 681). SQLite's automatic checkpoint is passive and never truncates the file, so the purged text's old frames can stay in `team.db-wal` with no command for the operator to cut them. The output reports `busy` (serve.ts:509), but neither the ADR nor the runbook list names a step to take after it.
- F-4 · advisory · src/team/mirror.ts:438 · If an owed replay keeps failing (a repository that always fails), the note is never cleared. Every hourly or after-push child then removes and replays those folders again, up to about 35 minutes for `repos/shared` at the pilot's size, holding the mirror lease and so refusing purges meanwhile. Each run records it in `meta.mirror.last`, so `serve status` shows it.
- F-5 · advisory · src/team/mirror.ts:670 · Carried from round 2 F-2, unchanged. A child that fails before `runMirror` records anything leaves only the `mirror-exit` warn line (mirror.ts:717). Also, if `fn` throws outside the per-revision try blocks (the root's `rmSync`, `resetMirrorRevisions`, a malformed `mirror.replay`), `record` writes `error: null` (mirror.ts:478-483) because no failure was pushed. The next run heals it.
- F-6 · advisory · .github/workflows/release.yml:99 · Carried, unchanged. `publish` needs `docker`, which pushes two platforms through QEMU and is never run in CI. ADR "Follow-ups" names this.
- F-7 · advisory · .env.example:4 · Carried, unchanged. `WIZARDINGCODE_MEM_VERSION=0.7.0`, while package.json:3 is still 0.6.0. A copied `.env` names an image that does not exist until 0.7.0 is tagged, and this would show at `docker compose pull`.
- F-8 · advisory · docs/adr/0026-team-server.md:98 · Carried. Rolling back across a schema bump is a manual restore of the pre-migration copy, and it relies on part 6 clients to re-push what that copy lacks. The procedure is written down.
- F-9 · advisory · .crew/work/2026-11-10-001-team-server-wizardingcode-mem-serve-one/spec.md:251 · Carried. Nothing consumes the HEALTHCHECK, as the spec states.

## Outside the change
none

## Not answerable
none
