# security findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-security
read: 12 files, risk areas: personal-data, data-migration, auth

## Findings
none

## Outside the change
none

## Not answerable
none

Notes behind the verdict (fifth round; I only re-checked what commit b54a579 changed and the boundaries it touches):

- **personal-data.** `levelRefusal` (`/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/policy.ts:306-321`) now throws when a level reads local with reason `allowed`. No loaded policy can produce that pair:
  - `effectiveLevel` (`src/sharing/levels.ts:54`) maps a stored `local` row to `level-local` before it can ever return `allowed`.
  - `levelOf` maps a missing row to `level-local`.
  - So the throw can only come from a hand-built policy.
  - Even then it fails closed. No send path exists, and the throw stops `wouldLeave`, `status` and `GET /api/sharing` instead of approving an item.
  - Its message names only a project id and a destination. A 500 carrying it would go to the same person, who holds the token.
  - `decide` still reads only its arguments, and `redactForSend` is unchanged.
- **auth.**
  - `GET /api/sharing`, `POST /api/sharing/preview` and `PUT /api/projects/<id>/sharing` (`src/ui/server.ts:452-476`) all run after the Host check and the token check (`src/ui/server.ts:249-266`), the same as their neighbours.
  - A widening still needs `confirm`, which `setLevel` checks under its own transaction.
  - `validatePatch` refuses `\r` and `\n` under every key (`src/settings/settings.ts:403`).
- **data-migration.**
  - `0001_sharing_policy.sql` only adds tables, with no foreign key and no trigger on core tables. Nothing is destroyed.
  - On restore, the levels are reset inside the unpacked copy, under `BEGIN IMMEDIATE` on the live store and before the rename (`src/backup/backup.ts:114-185`). A failed reset throws before the swap.
- No finding falls in the sibling item's paths (2026-11-09-001), and I saw no credential in the touched sharing files.
