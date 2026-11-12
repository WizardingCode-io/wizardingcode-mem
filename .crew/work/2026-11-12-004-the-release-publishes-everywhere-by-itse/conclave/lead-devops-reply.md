# devops lead's validation of 2026-11-12-004-the-release-publishes-everywhere-by-itse: spec
verdict: validated
## Returns
none
## Notes
- The round-3 changes hold for the pipeline. `plan` gives the output `sha` (`spec.md:105`). The `npm` job checks out that commit into `release/`, never the tag by name (`spec.md:136`); refusal 4 (`spec.md:110`) guarantees the commit is on `main`, so a checkout by commit can fetch it. AC-37 (`spec.md:231`) pins that the checkout's `ref` comes from `plan`'s `sha` and that no checkout takes `inputs.tag`. AC-36 (`spec.md:226`) has the plan's decision give the tag's commit.
- `push.ts` refuses before any write when the tag no longer names that commit (`spec.md:151`), proven by AC-38 (`spec.md:235`) against a local bare repository. That covers `tap` and `marketplace`, the two jobs whose output names the tag.
- The permission question I left for the build's first task in round 2 is closed in the text. `spec.md:101` cites GitHub's "Manage environments" page for the creation without rules, and names the two reads under `actions: read`; `plan` has that permission (`spec.md:87`). `door` has `contents: read` and `actions: read` (`spec.md:162`), so it can check out the script it runs.
- My round-1 returns R-1 to R-5 still hold in the revised text: `spec.md:101`, `spec.md:115` and `spec.md:162` for R-1 and R-4; "The first release" for R-2; `spec.md:93` and `spec.md:132` for R-3; `spec.md:83` for R-5.
- For the plan, not a return: the `git ls-remote` in `push.ts` (`spec.md:151`) must compare the peeled commit (`refs/tags/<tag>^{}`) when the tag is annotated; otherwise it reads the tag object's id and refuses every annotated tag. AC-38's test should include an annotated tag.
- For the plan, not a return: that `ls-remote` reads this repository, so it must run without `MARKETPLACE_TOKEN` (the token is granted to the other two repositories only), using the run's own token or none. This keeps the rule at `spec.md:153` on where the secret travels.
- Carried from round 2, not a return: AC-37 pins `ubuntu-latest` for `distribute.yml` only; the shape test for AC-31 (`spec.md:232`) should assert `runs-on` for `token.yml`'s two jobs too.

Files read this round: `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/spec.md` (lines 83-166 and 224-237, plus a search of the whole file) and `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/conclave.md` (lines 50-54).
