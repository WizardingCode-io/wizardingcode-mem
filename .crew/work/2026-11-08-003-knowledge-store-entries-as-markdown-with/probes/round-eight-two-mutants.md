# Probe: the two mutants the test-quality reviewer found by reading in round eight

Asked by the test-quality reviewer in round eight (F-1 and F-2, both filed as defects, and its "Not answerable": "F-1 and F-2 were found by reading, and neither was run").

Run on 2026-11-09 against the code under review (round eight), on macOS, after all six reviewers had answered. Each mutant changes one line, the test files that should hold it are run with the pinned Bun, and the file is written back. `git status` showed no tracked change after the run.

- F-1: `src/modules/knowledge/resolve.ts`, the manifest written into the folder a project's row names: the clause `&& headOf(path) === null` is dropped. Tests run: `tests/unit/knowledge-resolve.test.ts`, `tests/unit/knowledge-index.test.ts`.
- F-2: `src/doctor/checks.ts`, `foldersByHand`: `kindAt(path) !== "absent"` is put back to "is a folder" (`kindAt(path) === "folder"`). Tests run: `tests/unit/doctor-knowledge.test.ts`.

```
F-1: a manifest is written back into a repository that has commits: SURVIVED (tests green)
F-2: doctor's own listing of the fixed scopes skips a link or a file again: SURVIVED (tests green)
```

What it shows: the reviewer's reading holds for both. With either line undone, every test in the files named stays green.

What it does not show: the rest of the suite was not run against the two mutants.
