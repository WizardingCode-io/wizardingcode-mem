# test-quality findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-test-quality
read: 1 test file read in full where it changed (tests/unit/sharing-policy.test.ts, the decide section, lines 520-860), plus targeted searches over the 10 other sharing test files; 20 criteria in force (AC-1 to AC-12, AC-18 to AC-25)

## Findings
none

## Outside the change
none

## Not answerable
none

## Notes behind the verdict (for the judge)

**What I checked: AC-25, the only test change since round four**
- Code: `levelRefusal` in `/Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/src/sharing/policy.ts`, lines 306-321.
  - It returns `level-knowledge` for a project at knowledge.
  - For a level that reads local, it returns the reason `effectiveLevel` gave.
  - It throws on a local row whose reason is `allowed`. The message names the project and the destination.

**The new test, "a local row that claims allowed is a broken rule, never read as Nothing" (`tests/unit/sharing-policy.test.ts:687`)**
- Inputs: a policy built by hand with `levelRow(DOWN, "local", "allowed")`, run against a project entry and a memory.
- It expects a throw matching `/local.*allowed.*9.*team/`, which names the project and the destination.
- The red log `logs/tdd-AC-25-red-1794259007760.txt` shows this one test failing ("Received function did not throw"; 50 pass, 1 fail) against the old arm `reason === "allowed" ? "level-local" : reason`. Reverting the change makes it fail.

**The loop test, "stays with what downgraded its project's level, named as effectiveLevel named it" (`tests/unit/sharing-policy.test.ts:676`)**
- It runs over `level-local`, `disabled` and `unbound-alias`, for an entry and a memory, and expects `keep(reason)` each time.
- It passed at red. That is expected, not a defect: the old code already passed these three reasons through unchanged, so this part of AC-25 pins the behaviour rather than drives it.
- It still catches a rewrite. For example, a `levelRefusal` that always answered `level-local` would fail on `disabled` and `unbound-alias`.
- It tests what a caller sees: it asserts `decide`'s returned ruling, not internal names.

**Spot checks: each criterion's test still exists**
| Criterion | Test |
|---|---|
| AC-19 (`LEDGER_RECORD_KEYS`, `DECISION_KEYS`) | `tests/unit/sharing-contract.test.ts:157-170` |
| AC-20 (host-led alias, path remote refused) | `tests/unit/sharing-store-writes.test.ts:422,441` and `tests/unit/sharing-levels.test.ts:137` |
| AC-21 (knowledge module behind or ahead) | `tests/unit/sharing-report.test.ts:286` |
| AC-22 (a value on one line) | `tests/unit/settings.test.ts:204` and `tests/integration/ui-sharing.test.ts:629` |
| AC-23 (no `error.message`, no `truncate`) | `tests/unit/ui-sharing-copy.test.ts:138-148` |

**The two observed criteria**
- AC-18: its red run on the base is recorded in `probes/check-docs-at-base.md`.
- AC-24: its preservation reason is recorded in `evidence.json`.
- Both are unchanged since round four. Only doc comments in `src/sharing/levels.ts` and `src/sharing/report.ts` moved, and neither probe reads those comments.

**Other**
- I found nothing in the sibling item's paths (2026-11-09-001) to report.
- Fixtures use neutral names (`remote:x`, `workspace:sales`, `ab12cd34`).
