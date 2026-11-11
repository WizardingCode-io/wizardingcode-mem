# qa lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
- My round-14 return is answered. Task 11 (plan.md:96) no longer depends on `resume`.
  - The test holds the 25 deleted entries under `bulk`.
  - It then writes `sharing.resume_authorised:<serverId>` with those uids directly. The text says "the `resume` command itself is task 16".
  - The next sweeps withdraw them with no new hold, and a sweep interrupted by `rate` keeps the rest authorised.
  - Outbound's consumption rule is stated in the same task (plan.md:96): each uid is removed from the list as its withdrawal is answered, and the key is deleted when empty.
- `resume` writes the authorised set it printed, in task 9's description (plan.md:88). The stub is filled in task 16 (plan.md:104).
- The `remove` and restore cases sit in tasks that have what they need.
  - `remove` deleting the authorised list is in task 9's remove description (plan.md:88). Its test is in task 16, and the case line at plan.md:129 names "the authorised list deleted".
  - The restore's clearing of `sharing.resume_authorised:*` and the re-added server starting with no authorised uid are in task 19 (plan.md:113). Task 19 is after task 16, so the key exists.
- Task 13 (plan.md:101) has the `pinnedEntries` case: a held pin of an own entry is left out. The reads and the `applied` rows it needs come from task 12, which is before it.
- Task 14 (plan.md:102) has the disabled-then-re-enabled project case. It also appears in the case line at plan.md:135. It needs the pull and the new-alias path, both in that task.
- Task 19 (plan.md:113) names `openStoreFile` and a case that no backup file is written for the copy (`upgradeBackup: false`). It comes after the `db.ts` change in the same task.
- The remaining criteria and the observed and preserve criteria (AC-62, AC-56, AC-57) are unchanged since round 14. They stand as validated.
