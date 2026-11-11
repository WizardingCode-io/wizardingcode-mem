# test-quality findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-test-quality
read: 12 test files (the knowledge, sharing and ui-sharing tests in review/files.txt:98-116, read from the tree and in their diff hunks, with tests/unit/ui-sharing-copy.test.ts read in full at diff.patch:6951-7061; plus AC-92's two observed logs), 14 live criteria (AC-85's step is skipped by D-10, work.json:881-889)

## Findings
none

Checked against the tree and the engine's record:
- AC-85 has left the verdict. work.json:883 records a skip of tdd:AC-85 by the person, with D-10 (work.json:1097-1103) as its reason. That removes round 6's only defect (ruling.round6.json, tests/unit/ui-sharing-copy.test.ts:99). probes/criteria.md:13 still lists AC-85 as a live preserve. The file was not regenerated after the skip, so it no longer matches work.json. This affects the record only, not the tests.
- AC-92 (observed) holds for tests/unit/ui-sharing-copy.test.ts. The file's diff (diff.patch:6955-7061) changes only what AC-92 names:
  - the configured-server sentences, with their added server-name expectations at :6974 and :6986;
  - the saveSettings call (:6975);
  - the two signature regexes (:7053, :7058);
  - the Servers card's cases and the dock's Receive only case (:6993-7043).
  The unnamed case "says how many projects share, and the last change" is untouched.
- AC-92's recorded reason holds (Q4). Its claim is that existing tests pass unchanged, and no red run can exist for that: an unchanged test that fails proves nothing about this change. A before run on the base's schema could not be recorded, as the reason says.
- The observed runs are green on the final tree:
  - logs/tdd-AC-92-observed-1794368788773.txt: 748 pass, 0 fail, across 31 files.
  - logs/tdd-AC-92-observed-1794368757331.txt: 23 pass, 0 fail, in 1 file.
- The other knowledge and sharing test files in files.txt that AC-92 does not name are new files, not changes to existing ones: tests/unit/knowledge-sync-writer.test.ts, tests/unit/sharing-per-server.test.ts and tests/unit/sharing-server-writes.test.ts.
- Two advisories stand as filed and are not repeated here, since neither is a defect under the rubric:
  - round 6: the Sharing card's call into serverChange and its fallback name are untested (ui/src/components/settings/Sharing.vue:99);
  - round 5: the Servers card's class search runs over the whole file.

## Outside the change
none

## Not answerable
- Q1 for AC-90's screen states (/settings#servers, #sharing and /projects at 360, 768 and 1280, light and dark, motion none) · these are visual captures, and none was given to this reviewer.
- Q4 for AC-91's measurement of the sharing v1→v2 copy on the 50 MB fixture · the delivery's evidence was not among the files given.
- Q4 for AC-92's "against the base's run" · only the final tree's runs were given. Without the base's run, "unchanged" was checked against the diff, not against a baseline log.
- Q7 (mutation) · no mutation report was named.
