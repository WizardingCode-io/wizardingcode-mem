# Probe: `doctor`'s knowledge check against a `knowledge/projects` it cannot read

Asked by the code-quality reviewer in round seven (F-1, a defect) and by the architecture reviewer (F-2, an advisory, the same lines `src/doctor/checks.ts:589-598`), and by the risk reviewer (F-3, an advisory): each reasoned that `doctor`, with no database, reads an unreadable `knowledge/projects` as empty and reports "ok", while with a database it warns. None ran it.

Run on 2026-11-09 against the code under review, on macOS, in a temporary data directory, as a user who is not root. The data directory holds the workspace repository and one project repository, one entry each. "With no database" is the check run with a store directory that holds none, as the test "with no database, the checks that need it are skipped and said" does.

```
folders under knowledge/projects: 1

knowledge/projects readable (mode 700)
  with the database:    ok: 2 repositories, 2 entries, 0 drafts, 0 open proposals
  with no database:     ok: 2 repositories, 2 entries, 0 drafts, 0 open proposals; no database: the checks that read it were skipped

knowledge/projects at mode 000
  with the database:    warn: could not be checked: <tmp>/wcm-probe-aFKhIB/knowledge/projects cannot be looked at (EACCES); check the permissions of that folder and of the ones above it. The knowledge store never takes what it cannot see for gone
  with no database:     ok: 1 repository, 1 entry, 0 drafts, 0 open proposals; no database: the checks that read it were skipped

knowledge/projects at mode 600 (listed, not searched)
  with the database:    warn: could not be checked: <tmp>/wcm-probe-aFKhIB/knowledge/projects/3131ba4bc674f915 cannot be looked at (EACCES); check the permissions of that folder and of the ones above it. The knowledge store never takes what it cannot see for gone
  with no database:     ok: 1 repository, 1 entry, 0 drafts, 0 open proposals; no database: the checks that read it were skipped
```

What it shows:

- The reviewers' reading holds. On the same disk, the check warns and names the folder when there is a database, and reports "ok, 1 repository" when there is none: the project repository is left out with no warning.
- Nothing is written or deleted by the check in either case.

What it does not show: Linux; a disk fault; the no-tables fallback (`checks.ts:680`), which runs the same hand listing.

## A fact for architecture F-1, read and not run

`src/util/paths.ts:10-21`: `WIZARDINGCODE_MEM_DATA_DIR` moves only this product's data directory; `WIZARDINGCODE_HOME` moves the brand's home (`~/.wizardingcode`), of which the data directory is the `mem` folder. `README.md:430` says the same. ADR 0024:87 and the refusal at `src/modules/knowledge/repo.ts:125` name `WIZARDINGCODE_HOME` only (the ADR) or no variable (the message: "move or link the data directory itself"). ADR 0010's "Data directory ≠ store directory" is at `docs/adr/0010-settings-storage-and-backups.md:18`.
