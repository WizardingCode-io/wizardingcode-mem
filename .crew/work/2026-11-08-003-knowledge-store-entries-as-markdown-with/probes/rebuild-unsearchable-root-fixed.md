# Probe: `rebuild` against an unreadable `knowledge/projects`, run against the fixed code

The same case as `rebuild-unsearchable-root.md`, run on 2026-11-09 after round six's defect was fixed, on macOS, as a user who is not root.

```
before: repositories [{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}] entries 2
folders under knowledge/projects: 1
knowledge/projects at mode 000: rebuild refused: <tmp>/…/knowledge/projects cannot be looked at (EACCES); check the permissions of that folder and of the ones above it. The knowledge store never takes what it cannot see for gone
  after: repositories [{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}] entries 2
  folders still under knowledge/projects: 1
knowledge/projects at mode 600 (listed, not searched): rebuild refused: <tmp>/…/knowledge/projects/3131ba4bc674f915 cannot be looked at (EACCES); check the permissions of that folder and of the ones above it. The knowledge store never takes what it cannot see for gone
  after: repositories [{"scope":"project","path":"knowledge/projects/3131ba4bc674f915"},{"scope":"workspace","path":"knowledge/workspace"}] entries 2
  folders still under knowledge/projects: 1
```

What it shows: in both modes `rebuild` is refused with the folder and the error named, and the two repository rows and the two entry rows are as they were. With mode 600, where the folder lists and its entries cannot be looked at, the refusal names the entry.

What it does not show: Linux; a disk fault, which gives another error code and takes the same path in the code.

The same case is held by the test "a folder it cannot look into is refused, and no row is forgotten for it" in `tests/unit/knowledge-index.test.ts`, which also covers `knowledge/` itself.
