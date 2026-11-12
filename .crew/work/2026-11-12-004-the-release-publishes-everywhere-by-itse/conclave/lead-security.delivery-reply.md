# security lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: delivery
verdict: validated
## Returns
none
## Notes
- Round 2, on the changed tree. All paths are under `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/`. I re-read the changed files and did not re-run any gate or recompute the fingerprint.
- Gates my team owns passed on the new tree: `secrets` is `pass` at `.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/report.md:62`, and the security judgement is `proven` with one advisory finding at `report.md:77` (`review/security.findings.md:6`).
- The override I noted in round 1 is closed: on a runner (`GITHUB_ACTIONS === "true"`) `scripts/release/push.ts:215-222` no longer reads `PUSH_REMOTE` or `PUSH_ORIGIN`. `tests/integration/release-commands.test.ts:485-490` sets both overrides with `GITHUB_ACTIONS: "true"` and asserts the `ls-remote` still goes to `https://github.com/o/r.git`.
- A ruleset's refusal is now named: `scripts/release/push.ts:127` matches `GH013` and "repository rule violations" beside `GH006`, with both cases tested at `tests/integration/release-push.test.ts:189-192`. The push still fails closed either way.
- Nothing I validated in round 1 regressed in `.github/workflows/distribute.yml`:
  - the secret appears only in the `env:` of four steps of `tap` and `marketplace` (`:128,140,160,167`);
  - every `uses:` is a 40-character SHA and every checkout has `persist-credentials: false` (`:56-193`);
  - `id-token: write` is only in `npm` (`:80`) and `packages: write` only in `latest` (`:178`);
  - the three secret-bearing jobs name `environment: release` (`:77,117,149`).
- The runbook's setup order is unchanged (`docs/runbooks/release.md:18-24`). The new advice to make the first tag a pre-release (`docs/runbooks/release.md:28`) narrows the first real exercise of trusted publishing to the `next` dist-tag, which I welcome.
- The fourth round's advisory stands, deferred: `scripts/release/push.ts:43` builds the base64 form of the token's header without registering it with `::add-mask::`, and Actions masks only the raw secret.
  - No path prints it today: only git's stderr reaches the error sentences (`push.ts:104,138,144,149`) and git redacts the header in its traces.
  - It is recorded as first of the follow-up at `docs/real-use/findings.md:70`.
  - I accept the deferral, on the condition that it is done before anyone turns on `GIT_TRACE_CURL`, `GIT_CURL_VERBOSE` or a debug re-run of `tap` or `marketplace`. That is a preference, not a return.
- The other deferred advisories are on record at `docs/real-use/findings.md:65-69`: `latest` holds `packages: write` outside the environment and retags by name; `release.yml` still uses unpinned actions and persisted credentials; `plan` does not check the `v*` tag ruleset. The `latest` exposure must be taken up in piece 3, before anything follows that tag.
- Not provable from files: the repository's real settings (the environment's rule, both rulesets, the token's scope), whether `plan`'s token can read the environment with `actions: read` (it fails closed if not), and that each pinned SHA is the version its comment names.
