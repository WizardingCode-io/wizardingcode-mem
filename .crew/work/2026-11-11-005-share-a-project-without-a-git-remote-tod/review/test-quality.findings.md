# test-quality findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-test-quality
read: 3 test files (the cut's new cases in ui-sharing, sync-names and share-names-cli; the rest of the item's tests as read in rounds 1 to 3 and unchanged since), 17 criteria

## Findings
none

I read the four changes of this cut. Each fails if its behaviour is reverted.

- **ui-sharing, `PUT` without `as` (tests/integration/ui-sharing.test.ts:1065-1091).**
  - If `setProjectSharing` went back to calling `setLevel` directly when `as` is absent, the first PUT would no longer answer 400 `needs-confirm`, because Receive only needs no confirm.
  - With confirm, the test asserts `boundAlias`, `sharedName`, `joined: true` and `created: false`. It also asserts that the level row holds the registry's `name_id` (`w.nameId`), which the old direct `setLevel` path did not set. The "no POST" claim is checked by the count of `POST /v1/names` request lines before and after.
- **sync-names, the 101st alias (tests/integration/sync-names.test.ts:234-274).**
  - It seeds 100 real name-bound levels that sort before the project's name. It asserts the exact `projects=` list of the main pull, that the project's name is absent from it, that a `scope=project` pull names it, and that the stored cursors hold 100 aliases in the main set and `[NAME, ALIAS]` in the extras.
  - Putting names outside the 100-alias cap would change one of these.
- **sync-names, no hold on the `name` push (tests/integration/sync-names.test.ts:295-299).** It asserts `held: 0` and `readHold` null in addition to the earlier no-refusal, no-failure and `retryAt` null checks. Reintroducing a D-10 hold for a name refusal fails it.
- **share-names-cli, `one-server` (tests/integration/share-names-cli.test.ts:68-108).** `folderProject` makes a path-only project, so `setLevel(as name:docs)` reaches the bind to `s2`.
  - The CLI call with `--server <other>` asserts exit 1 and `bound to s2` on stderr.
  - It asserts that the request-event count is unchanged, so the refusal comes before any request.
  - It asserts that the level row is still bound to `s2`'s name.
  - This pins the refusal order `one-server` before network access.

## Outside the change
- none

## Not answerable
- none
