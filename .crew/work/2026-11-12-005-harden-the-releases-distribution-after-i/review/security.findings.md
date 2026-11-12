# security findings for 2026-11-12-005-harden-the-releases-distribution-after-i
reviewer: review-security
read: 6 files, risk areas: infra

## Findings
- F-1 · advisory · scripts/release/push.ts:39 · `redact` replaces only the base64 header form (the one form this file builds), not the raw `MARKETPLACE_TOKEN`. No path in the diff prints the raw token: git never echoes it, and the runner masks it as a registered secret. A later change that sends the raw value into a git text would therefore get through the script's own redaction. The ADR names this limit, so this is hardening only.

## Outside the change
- scripts/release/push.ts:117 · `gitEnv(token, process.env)` hands the authed git calls the whole inherited environment. A home `.gitconfig`, `GIT_CONFIG_GLOBAL` or system configuration on the runner can still change where the token's git goes or what it logs. Only the inherited `GIT_CONFIG_KEY_n` is overwritten. This is named and deferred in docs/real-use/findings.md (debt).
- scripts/release/push.ts:101 · the tag read and the git calls that carry no header still inherit `MARKETPLACE_TOKEN` in their environment. This is named and deferred (debt).
- .github/workflows/distribute.yml:140 · the git calls of `push.ts` have no time limit of their own beyond the job's. This is named and deferred (debt).

## Not answerable
- none

Answers to the rubric's questions:
- **Boundary.** The diff narrows input. The command no longer reads `PUSH_REMOTE` or `PUSH_ORIGIN`. The destination is the `REMOTES` constant plus `https://github.com/${GITHUB_REPOSITORY}.git`, which the runner sets.
- **Secrets.** The test tokens (`"secret"`, `"a>?"`) and their encoded headers are synthetic fixtures, not credentials.
- **Infra.**
  - No permission is widened. `distribute` keeps `actions: write` and only gains `timeout-minutes: 5`.
  - No secret moves into configuration or an image.
  - The token still travels only in the child's environment, as the extraheader scoped to `https://github.com/`.
  - Redaction wraps the runner inside `commitAndPush`, so every ReleaseError sentence and every dry-run line is built from redacted text. That covers what `command()` writes to stderr and to `GITHUB_STEP_SUMMARY` (scripts/release/lib.ts:49-76).
  - A spawn failure in `run` (lib.ts:39-44) yields only the exception message, and that also passes through `exec`.
  - The ADR's account of the runner's base64 masking holds: the prefix `x-access-token:` is 15 bytes, so the token's own base64 sits aligned inside the header.

Files read:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-005-harden-the-releases-distribution-after-i/review/diff.patch
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-005-harden-the-releases-distribution-after-i/review/files.txt
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/lib.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.github/workflows/distribute.yml
- the security rubric
