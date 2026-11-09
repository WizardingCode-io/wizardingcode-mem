# Probe: `doctor`'s knowledge check against a `knowledge/projects` it cannot read, run against the fixed code

The same case as `doctor-unreadable-projects.md`, run on 2026-11-09 after round seven's code-quality defect was fixed, on macOS, as a user who is not root.

```
folders under knowledge/projects: 1

knowledge/projects readable (mode 700)
  with the database:    ok: 2 repositories, 2 entries, 0 drafts, 0 open proposals
  with no database:     ok: 2 repositories, 2 entries, 0 drafts, 0 open proposals; no database: the checks that read it were skipped

knowledge/projects at mode 000
  with the database:    warn: could not be checked: <tmp>/wcm-probe-GP1Opk/knowledge/projects cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone
  with no database:     warn: could not be checked: <tmp>/wcm-probe-GP1Opk/knowledge/projects cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone

knowledge/projects at mode 600 (listed, not searched)
  with the database:    warn: could not be checked: <tmp>/wcm-probe-GP1Opk/knowledge/projects/3131ba4bc674f915 cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone
  with no database:     warn: could not be checked: <tmp>/wcm-probe-GP1Opk/knowledge/projects/3131ba4bc674f915 cannot be looked at (EACCES); check the permissions of that path and of the folders above it. The knowledge store never takes what it cannot see for gone
```

What it shows: on the same disk the check gives the same answer with and without a database: a warning that names the folder and the error's code.

What it does not show: Linux; a disk fault; the no-tables fallback, which runs the same listing as "with no database".

The same case is held by the test "a projects folder it cannot read is a warning that names it, with a database and with none" in `tests/unit/doctor-knowledge.test.ts`; a link or a file where a project's repository was, and an `entries/` folder it cannot read, by the two tests after it.
