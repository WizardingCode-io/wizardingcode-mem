# Probe: the journal mode of a store after a restore

Asked by the risk reviewer in round one (F-1, a defect, with one thing to confirm before acting): `resetSharingInCopy` runs `PRAGMA journal_mode = DELETE` on the unpacked copy, `openDb` turns WAL on only when it creates a database, so the store that replaces the live one after a restore would stay in rollback-journal mode. The reviewer asked whether the copy was already in that mode before this item, which would make it existing debt that this item's path triggers for certain.

Run on 2026-11-09 against the code under review, with Bun 1.4.2's SQLite, in temporary folders: a store made by `openDb`; a copy by `VACUUM INTO` as `backup` takes it; the copy opened raw and read; the copy after the item's `PRAGMA`; the copy moved to a data directory and opened by `openDb`, as the live store is after the swap; and the same without the item's `PRAGMA`.

```
live store made by openDb: wal
the VACUUM INTO copy, opened raw: delete
the copy after PRAGMA journal_mode = DELETE: delete
the restored store, opened by openDb: delete
a restore before this item (no PRAGMA), opened by openDb: delete
```

What it shows:

- A `VACUUM INTO` copy is in rollback-journal mode as SQLite writes it, before this item does anything to it. The item's `PRAGMA` changes nothing about that.
- After a restore, with or without this item, `openDb` opens the store in rollback-journal mode and does not turn WAL back on. The reviewer's consequence holds, and it predates this item: every restore since backups exist has left the store this way.

What it does not show: how much SQLITE_BUSY the hooks meet in that mode under real load; whether a 0.6.0 restore behaves otherwise (the same `VACUUM INTO` and the same `openDb` rule, so the reading says the same).

The way out is the one the reviewer named: `openDb` turns WAL on whenever the file is not in WAL mode, not only when it creates the database; one `PRAGMA journal_mode` read per open.
