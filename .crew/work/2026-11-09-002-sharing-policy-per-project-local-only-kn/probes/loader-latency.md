# Probe: the policy loader over ninety projects

Asked by the risk reviewer in round three (Not answerable, question 1): the spec names a 20 ms target for the loader over about ninety projects, and no gate report carried the figure, so the reviewer could not say whether `GET /api/overview` (which loads the policy) stays within the viewer's budget.

Run on 2026-11-09 against the code under review (commit 480952f), with Bun 1.4.2, in a temporary data directory: 90 projects, each with a host-led `remote:` alias and a `path:` alias; 30 of them above Nothing through `setLevel` (knowledge and all alternating); an env file with both lists (`workspace,shared`; `workspace:sales,shared:marketing`); a workspace knowledge folder with no taxonomy, so two problems are reported. `loadPolicy(db, dataDir, env)` and `policyInForce(db, dataDir, env, now)` (the two reconciles, then the load, as every route and command runs them) timed over 50 runs each after one warm run, by `scratchpad/probe-loader-latency.ts` (kept outside the repository).

```
projects 90, levels 30, problems 2
loadPolicy: p50 0.12 ms, p95 0.16 ms, max 0.18 ms (50 runs)
policyInForce (reconciles + load): p50 0.35 ms, p95 0.56 ms, max 1.07 ms (50 runs)
```

What it shows: the loader is two orders of magnitude under the 20 ms target at that size, and the reconciles add under half a millisecond. `GET /api/overview` adds `listProjects` (one query per project for the counts, as before this item) on top; `GET /api/sharing` adds `wouldLeave` with `fresh: true`, whose git refreshes are the cost the spec states grows with the person's choices, and which this probe does not measure.

What it does not show: a store with thousands of memories per project (the counts, not the loader), or the machine under load.
