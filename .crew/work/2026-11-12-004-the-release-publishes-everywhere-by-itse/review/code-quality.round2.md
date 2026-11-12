# code-quality findings for 2026-11-12-004-the-release-publishes-everywhere-by-itse
reviewer: review-code-quality
read: 38 files, 47 hunks

## Findings
- F-1 · defect · scripts/release/push.ts:134 · Any failed first push that does not match the two patterns is treated as "someone else pushed meanwhile" and retried after `pull --rebase`, and the stderr of the first push, the rebase and the second push is thrown away ("refused and the rebase failed" at :137, "refused twice" at :140). A network, DNS or auth failure therefore reaches the author as a vague sentence, which is a fallback that hides why the first path failed (Q9). AC-72 asks for one rebase after a non-fast-forward refusal, not for every unrecognised failure. Gate the rebase on the rejection (`non-fast-forward` / `fetch first`) and keep `first.stderr` in the thrown sentence.
- F-2 · advisory · scripts/release/push.ts:208 · `PUSH_REMOTE` / `PUSH_ORIGIN` are environment overrides in the production command that exist only so `tests/integration/release-commands.test.ts` can point it at local repositories. This is a configuration knob no criterion asked for, and it sits beside the `runner` seam that `commitAndPush` already takes (Q5).
- F-3 · advisory · CLAUDE.md:29 · "`plan` (what may be distributed: ten refusals, …)" gives a count that neither the spec nor the code supports. `decidePlan` in `scripts/release/lib.ts` has twelve refusal sentences (eleven checks if the environment's two count as one). Drop the number, or make it agree with AC-65 (Q11).
- F-4 · advisory · scripts/release/lib.ts:345 · `editManifests`, `decidePlan` (lib.ts:453) and `previousPlain` (lib.ts:497) each rank versions with an inline `Bun.semver.order` sort, while comparisons go through `olderThan` from `src/util/version.ts`. The ADR presents that module as the single order, so a small "highest version" helper there would keep the order in one place. Boilerplate-level duplication, not logic divergence (Q2).

## Outside the change
none

## Not answerable
- Q7 (dependency the criteria did not ask for) · `review/inputs.json` was not read. The diff touches no `package.json`, so no manifest gains a dependency; the new scripts import only `node:*` built-ins, Bun and repository files (`scripts/build.ts` imports only `node:fs` / `node:path`).

Files referenced:
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/push.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/scripts/release/lib.ts
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/CLAUDE.md
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-12-004-the-release-publishes-everywhere-by-itse/review/diff.patch
