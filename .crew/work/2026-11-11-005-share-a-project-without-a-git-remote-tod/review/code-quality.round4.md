# code-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-code-quality
read: 1 file in full (src/ui/api.ts, `setProjectSharing` and its neighbours), 1 hunk. I did not read the other 97 files of the diff in this round, so this is not a full review.

## Findings
- F-1 · advisory · src/ui/api.ts:1315 · The comment says "adds what it did (named, created, joined) to the four every answer carries", which restates the code below it, and the `answered` object already shows the four fields (question 10).
- F-2 · advisory · src/ui/api.ts:1296 · `contextOf(db, projectId, named.alias, destination)` is computed before `prepareBinding`, so it runs on every call including the success path where only a refusal reads it (question 5). This is a minor cost and not a defect.

No defect found in `setProjectSharing`. The no-`as` bind now goes through `prepareBinding` then `commitBinding`, as the CLI does, so there is no second path. The `prepared.action === "none"` branch is reachable, since a level change on an already-bound name needs no server step.

## Outside the change
none

## Not answerable
- Questions 1 to 11 for the other files in the diff (tests, docs, runbook, ADR 0028) · I did not read them in this round, and rounds 1 to 3 already returned advisories only. I can neither confirm nor rule out defects there.
