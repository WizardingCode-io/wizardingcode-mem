# architecture findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-architecture
read: the rubric; CLAUDE.md "Shared names" bullet (as loaded); round 4's changed surface in src/ui/api.ts (`setProjectSharing`, `forgetProjectName`, lines 1250-1344), src/cli/commands/share.ts (lines 240-310), src/sync/binding.ts (`prepareBinding`, `commitBinding`, optional `remoteAlias`), and the sync-boundary test's quiet-file list. I did not re-read the full diff, the earlier rounds or the docs edits (runbook, ADR 0028).

## Findings
- F-1 · advisory · src/ui/api.ts:1299 · The viewer's PUT now runs `prepareBinding` then `commitBinding` with or without `as`. This is the same two-phase rule as the CLI at src/cli/commands/share.ts:265-291, and it matches the spec's "The viewer" and ADR 0028. The round-3 drift is closed. The only difference from the CLI is that the viewer passes no `remoteAlias` (the CLI passes `remoteAliasOf(cwd)`). That is fine, since the field is optional in `binding.ts` and the viewer has no working directory.
- F-2 · advisory · src/ui/api.ts:1309 · The answer always carries `level`, `old`, `boundAlias` and `sharedName`, and adds `named`, `created` and `joined` only when the server was asked. This is an additive contract change: the existing fields stay and the new ones appear only on a server step. The route's shape is also kept in the viewer's types and docs, so it is worth a check that ui/src types and docs name the three optional keys.

## Outside the change
- none

## Not answerable
- none
