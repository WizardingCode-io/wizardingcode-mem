# Probe: rows the withdrawn module wrote into core tables

Asked by the data reviewer in rounds two and three, under "Not answerable": whether the withdrawn knowledge module wrote rows into core tables (`meta` keys, `injections` rows) that migration 6 leaves behind as orphans.

Run on 2026-11-09 in the item's worktree. The withdrawn module's code is on the branch `archive/knowledge-module`.

```
$ git grep -n -E "setMeta|getMeta|deleteMeta|claimLease|INSERT INTO (meta|injections|memories|turns|projects)|UPDATE (meta|injections|memories|turns|projects)" archive/knowledge-module -- src/modules/knowledge
promote.ts:7:import { claimLease, getMeta, releaseLease, setMeta } from "../../store/meta.ts";
promote.ts:58:    const value = JSON.parse(getMeta(db, CURSOR_KEY) ?? "null") as Partial<Cursor> | null;
promote.ts:72:    const value: unknown = JSON.parse(getMeta(db, NOT_STANDING_KEY) ?? "[]");
promote.ts:92:    setMeta(db, CURSOR_KEY, JSON.stringify(merged));
promote.ts:202:  if (!claimLease(db, PROMOTE_LEASE, owner, Date.now(), maxMs + 60_000)) return none;
promote.ts:347:            setMeta(db, NOT_STANDING_KEY, JSON.stringify(notStanding.slice(-MAX_REMEMBERED)));

$ git grep -n -E "CURSOR_KEY =|NOT_STANDING_KEY =|PROMOTE_LEASE =" archive/knowledge-module -- src/modules/knowledge
promote.ts:31:const CURSOR_KEY = "knowledge.promote.cursor";
promote.ts:35:const NOT_STANDING_KEY = "knowledge.not-standing";
promote.ts:38:export const PROMOTE_LEASE = "knowledge.promote.lease";
```

(The path prefix `archive/knowledge-module:src/modules/knowledge/` is cut from each line.)

What it shows:

- The withdrawn module wrote no row into `injections`, `memories`, `turns` or `projects` from its own folder. Its two indexes on `injections` are in `withdrawn-module-objects.md`, and migration 6 drops both.
- It wrote up to three rows into `meta`, on a store where its promotion pass ran: `knowledge.promote.cursor`, `knowledge.not-standing` and `knowledge.promote.lease`. Migration 6 does not delete them, so they stay as orphans.
- Nothing in the code under review reads them. The new leases are `knowledge.lease:<repository path>`, and `knowledgeLeaseActive` (src/store/meta.ts:140) reads the keys from `knowledge.lease:` up to, not including, `knowledge.lease;`. `knowledge.promote.lease` sorts after that range (`p` follows `l`), so a stale promotion lease is never read as a knowledge lease, and `anyLeaseActive` names its other leases one by one.

## Added in round four: other writers, and releases

The data reviewer asked in round four whether another file wrote those keys, and whether a release carried the module.

```
$ git grep -n -E "knowledge\.promote\.cursor|knowledge\.not-standing|knowledge\.promote\.lease|PROMOTE_LEASE|CURSOR_KEY|NOT_STANDING_KEY" archive/knowledge-module -- src scripts
scripts/proof/knowledge.ts:603:    const before = getMeta(db, "knowledge.promote.cursor");
scripts/proof/knowledge.ts:615:    if (run.proposed === 0 && getMeta(db, "knowledge.promote.cursor") === before) break;
src/links/rules.ts:113:const CURSOR_KEY = "rules.cursor";            (another key, of another pass)
src/modules/knowledge/promote.ts:31, 35, 38, 58, 72, 92, 202, 207, 347   (the lines above)

$ git log -1 --format=%H archive/knowledge-module -- src/modules/knowledge/promote.ts
69a31afd898e144c88ea5553ac8c7552419b9a07
$ git tag --contains 69a31afd898e144c88ea5553ac8c7552419b9a07
v0.6.0
$ git ls-tree -r --name-only v0.6.0 -- src/modules/knowledge
(nothing)
```

What it shows:

- Across `src/` and `scripts/` of the archived branch, the three keys are written only by `src/modules/knowledge/promote.ts`. A proof script reads one of them. `src/links/rules.ts` has a constant of the same name for another key, `rules.cursor`, which migration 6 does not touch.
- The only release tag whose history holds the module's last commit is `v0.6.0`, and the tree of `v0.6.0` has no file under `src/modules/knowledge/`: the module was removed before that release. No release carried it. A store holds these rows only if it was opened by a build made from `main` between the module's arrival and its withdrawal.

What it does not show: whether any such build was run against a store that is still in use.
