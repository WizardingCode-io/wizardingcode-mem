# Concept: harden the release's distribution after its first review

Mode: brainstorm. The hypothesis the lenses attack.

## Where this comes from

The item `2026-11-12-004` (the release distributes itself; the staged binary only moves forward; ADR 0029, `docs/runbooks/release.md`) was merged on 2026-11-12 as pull request 38. Its four rounds of judgement gates left advisories, recorded as deferred in `docs/real-use/findings.md` (rows dated 2026-11-12, "release distribution"). This item takes four of them: the ones that are small, touch code already written, and change nothing of what is distributed. Out of bounds here: `plan` checking the ruleset on `v*` tags or the tag's own `release.yml` run (a design of its own); the `latest` job behind the environment and the retag by digest (piece 3 of the parent item); `release.yml`'s older jobs (actions by moving tag, workflow-level `contents: write`), which is the backlog's debt point.

## The four changes

### 1. The token's encoded form is masked in the run's log

`scripts/release/push.ts` gives git the marketplace token as an HTTP header in the child's environment: `GIT_CONFIG_VALUE_0 = "Authorization: Basic " + base64("x-access-token:" + token)`. GitHub Actions masks the secret's raw value in logs, not this base64 form. No path prints it today (git redacts the header in its traces; only git's standard error reaches the script's error sentences), but `GIT_TRACE_CURL`, `GIT_CURL_VERBOSE` or a debug re-run would put a write credential for the tap and the marketplace in the log of a public repository. `actions/checkout` masks the same form for the same reason.

Hypothesis: `push.ts` exports `tokenMask(token)`, the workflow command `::add-mask::<base64 value>`, and its command prints that line first, before any git call, when a token is set and the process runs on a runner (`GITHUB_ACTIONS` is `true`). Off a runner it prints nothing, since printing the encoded credential on a person's terminal would be the leak itself.

### 2. The command reads no test override

The command of `push.ts` reads `PUSH_REMOTE` and `PUSH_ORIGIN` (off a runner only, since the last round) so that its test can write to local repositories. Three review rounds and the security lead named it: the writer that holds the token takes its destination from the environment.

Hypothesis: both variables go. The command's test reaches local repositories through git itself: it sets, in the environment it gives the command, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>` and `GIT_CONFIG_VALUE_<n>` with `url.<local path>.insteadOf` for the two https URLs the command uses. For that to hold when a token is set, `gitEnv` no longer overwrites `GIT_CONFIG_COUNT` with 1: it appends its header after whatever configuration the environment already carries (index = the existing count), which is also the correct behaviour on a runner whose environment sets git configuration that way.

### 3. The dispatching job has a time limit

`.github/workflows/release.yml`'s job `distribute` (one step, `gh workflow run distribute.yml …`) has no `timeout-minutes`; every job of `distribute.yml` has 15. A stalled call would hold the release's run for the runner's default of six hours.

Hypothesis: `timeout-minutes: 5` on that job, held by `tests/unit/deploy-files.test.ts`. The other jobs of `release.yml` are left as they are (the debt point).

### 4. One rule for "the version a staged binary answers"

Five writers of `<data dir>/bin/wizardingcode-mem` ask the staged binary `--version` to decide whether to replace it. Three already agree: the staged binary has a version only when it exits 0 and its whole answer, trimmed, is one version (`stagedVersion` in `src/install/binary.ts`; `installedVersion` plus `older()` in `npm/bin/wizardingcode-mem.js` and in the generated `plugins/opencode/binary.js`). Two differ: `version_of` in `scripts/install.sh` reads the first line and ignores the exit status; `installed()` in `scripts/templates/wizardingcode-mem.sh` (the plugins' script) ignores the exit status. So a staged file that prints a version and exits 1, or prints a version and a second line, is kept by one writer and replaced by another.

Hypothesis: the two shell readers take the same rule (exit 0, and an answer that is exactly one version), the plugins' scripts are regenerated, and each of the five writers has a test for the two cases (a higher version printed with exit 1; a higher version followed by a second line): each treats the staged file as having no version and replaces it.

## What is asked of each lens

Attack the four mechanics and their tests; check every claim about the code against the repository (`scripts/release/push.ts`, `scripts/install.sh`, `scripts/templates/wizardingcode-mem.sh`, `src/install/binary.ts`, `npm/bin/wizardingcode-mem.js`, `plugins/opencode/binary.js`, `.github/workflows/release.yml`, `tests/integration/release-commands.test.ts`, `tests/integration/release-push.test.ts`, `tests/integration/plugin-script.test.ts`).
