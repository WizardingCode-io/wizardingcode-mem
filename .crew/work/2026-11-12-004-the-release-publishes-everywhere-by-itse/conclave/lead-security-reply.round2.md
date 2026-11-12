# security lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: spec
verdict: returned
## Returns
- R-1 · .crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md:136 · The `npm` job must check out the commit `plan` judged, not the tag by name. Add an output `sha` (the tag's commit as `plan` resolved it) to the outputs at spec.md:105, have `npm` check out that SHA into `release/` at spec.md:136, and pin it in AC-30 (spec.md:229: `npm`'s checkout `ref` is `plan`'s `sha` output, through `env:`/`with:`, never `inputs.tag`) and in AC-25 (spec.md:224: an accepted tag gives its commit). Proof: refusal 4 (spec.md:110) tests the tag's commit when `plan` runs, but spec.md:100 states that `v*` tags are not restricted and spec.md:212 leaves the tag ruleset optional. A person with write access can therefore force-move the tag to a branch commit after `plan` passes and before `npm` checks out "the tag". The version check at spec.md:138 passes if their `npm/package.json` carries the same version, and their package content is published under the trusted publisher. `--ignore-scripts` (spec.md:140) stops lifecycle scripts, not the content. The window is every release run, since `npm` waits for `plan` and for the environment. This is the gap round 1's R-1 named, left open by a check that is not bound to what is later read; Goal 3 (spec.md:32) is not yet met.

## Notes
- Round 1 R-1 (tag not on `main`): addressed as far as the decision goes. Refusal 4 is at spec.md:110, J-8 at spec.md:65, AC-25 at spec.md:224, and `--ignore-scripts` at spec.md:140 and AC-27. The remaining gap is the return above.
- Round 1 R-2 (the door's precondition): closed.
  - spec.md:99 states the ruleset, which matches the settings read the coordinator reported (pull_request, required_status_checks, deletion, non_fast_forward, no bypass actor).
  - spec.md:187 and AC-32 have the author check it.
  - spec.md:100 says tags are unrestricted.
  - The revision goes further than asked: `plan`'s refusal 9 (spec.md:115) and `token.yml`'s `door` job (spec.md:160, AC-31) stop any job from naming an environment that is missing or has no rule, and the runbook orders the rule before the secret (spec.md:188).
- Round 1 R-3 (the token's path): closed. spec.md:151 passes it only through the child's environment (`GIT_CONFIG_*` extraheader), never in a URL, an argument or a file of the clone. AC-33 (spec.md:232) limits `secrets.MARKETPLACE_TOKEN` to the `env:` of steps in `tap`, `marketplace` and `check`. AC-34 (spec.md:233) proves the commands and remote URL carry no token. `persist-credentials: false` is at spec.md:81 and in AC-33.
- Round 1 R-4 (pinned actions): closed. spec.md:80 and AC-33 require a 40-character SHA for every `uses:` in `distribute.yml` and `token.yml`. The new `distribute` job in `release.yml` has no checkout and no `uses:` (spec.md:73), so it adds no unpinned action next to a secret.
- Round 1 R-5 (interpolation): closed. spec.md:79 and AC-33 ban `${{` in every `run:`, and the NFR at spec.md:249 matches.
- The same mutable-tag window touches two other places; neither is a return.
  - The marketplace `ref` names the tag, as the hand procedure does today, so a moved tag repoints the plugin with or without this item.
  - The tap's checksums come from release assets a writer can replace; signatures are a non-goal (spec.md:42).
  - A ruleset on `v*` tags (no update, no deletion) would close all three at once. The spec keeps it as an optional runbook step (spec.md:212); I would make it step 1b of the setup, but that is a preference.
- `plan` reads the environment with `actions: read` (spec.md:87). Whether the run's token may read `/environments/release` and its branch policies with that permission is deferred to the build's first task (spec.md:101). If it cannot, refusal 9 fails closed (no distribution), which is the safe side.
- O-1 and O-2 stay advisory. "Expiry unknown" is now a `::warning::` (spec.md:158, AC-28), and the `door` job removes the silent pass on a missing secret once the environment exists (spec.md:160).
