# code-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-code-quality
read: 38 files, 59 hunks

## Findings
- F-1 · defect · scripts/release/push.ts:70 · `PushOptions.target` is required, and both the command and the test pass it, but `commitAndPush` never reads it (it destructures remote, origin, tag, sha, version and token only), so it is a dead parameter (question 4).
- F-2 · defect · scripts/release/lib.ts:241 · The diff writes the same string-aware brace scan three times (inside `entrySpan` as `depthAt` and as the forward loop at about line 265, and again in `topLevelValue` at about line 283), where one scanner would do (question 2, duplicated logic).
- F-3 · advisory · scripts/release/lib.ts:509 · In `previousPlain`, the `&& other !== tag` check can never matter: `olderThan` is strict (`Bun.semver.order(...) < 0`), so a tag equal to `tag` is already filtered out (question 9, a guard for a case the code cannot reach; it hides no cause).
- F-4 · advisory · scripts/release/lib.ts:407 · The `TAG` regex repeats the version shape that `src/util/version.ts` already exports as `isVersion`, and `editManifest` at line 332 already uses the form `startsWith("v") && isVersion(slice(1))` (question 2, a duplicated pattern).
- F-5 · advisory · scripts/release/lib.ts:623 · `decideToken` returns both `ok` and `level`, but `ok` is just `level !== "error"`, so the two fields can disagree if a later edit changes one and not the other (question 5).
- F-6 · advisory · scripts/release/push.ts:205 · `PUSH_REMOTE` and `PUSH_ORIGIN` are environment overrides in production code that exist only so the test can redirect the pushes (the comment says so). `commitAndPush` already takes `remote` and `origin` as parameters, so the command's test seam could go through those instead (question 5).
- F-7 · advisory · src/cli/commands/install.ts:252 · When `Bun.spawnSync` cannot start the newer staged binary, `binaryOrHandOver` returns code 1 and prints nothing. The person has just read that the install was handed over, and gets no reason why it failed, while `resolveBinary` beside it writes its failures to stderr (question 6).

## Outside the change
none

## Not answerable
none
