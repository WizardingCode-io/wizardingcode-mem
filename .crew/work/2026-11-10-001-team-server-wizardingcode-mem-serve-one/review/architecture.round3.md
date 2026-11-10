# architecture findings for 2026-11-10-001-team-server-wizardingcode-mem-serve-one
reviewer: review-architecture
read: the rubric; review/architecture.round2.md and review/ruling.round2.json; docs/adr/0026-team-server.md in full (D-1, "One process, one store boundary", "The mirror", "Follow-ups"); CLAUDE.md line 16 (the team-server bullet); src/team/audit.ts, src/team/db.ts, src/team/store.ts (imports, the audit section 905-960), src/team/routes.ts in full up to the handler; the import lines of every src/team/*.ts file; every caller of insertAudit, readAudit and AuditSource in src/; the high-water writers (writeHighWater, onWrite); tests/unit/team-store-boundary.test.ts; a search for importers of src/team/ outside the folder (only src/cli/commands/serve.ts)

Round 2 advisories, now:
- F-1 (db.ts runs SQL the ADR did not name) is answered. D-1 (ADR line 17) and "One process" (line 48) now list what db.ts keeps: the version read, the schema check, `secure_delete` and migration 1's identity write. They also say a second engine replaces db.ts too. That matches db.ts:27, 50, 61-67 and 74. A small mismatch remains in the wording elsewhere (F-2 below).
- F-2 (the server takes helpers from the knowledge module's repo.ts) is answered: "The mirror" (line 74) now names `writeFileAtomic` and `headOf`. But the clause it added, "and nothing else of the module", is narrower than the code (F-1 below).
- F-3 (narrower pruning of the client store's upgrade copies) is answered. "Follow-ups" (line 114) states the change, says more is kept and nothing is lost, and gives the prefix grammar.

The audit move holds the boundary:
- src/team/audit.ts is now a reader only. It imports a type from db.ts and `listAudit` from store.ts, and holds no SQL.
- `insertAudit` and `AuditSource` live in store.ts:919-945, beside the store's other row types (`Role`, `ChangeOp`, `AuditRow`). That fits store.ts's role as the place for row shapes.
- store.ts still imports only `../store/db.ts` and `../store/meta.ts` from outside the folder, and nothing from inside it. That satisfies the test's rule (only ./db.ts and ./errors.ts allowed).
- Every writer calls the store function directly: routes.ts, members.ts:392, instance.ts:63/84, mirror.ts:654 and serve.ts:247. Each one is a caller of the store, which ADR line 48 allows ("every other module of `src/team/` calls those functions").
- Nothing changed in how the high-water mark is kept. The routes still call `ctx.onWrite`, instance.ts writes the mark itself, and serve.ts:255/508 writes it after the CLI's writes. The old `audit()` only forwarded, so moving the calls changed no behaviour.
- No new import crosses into src/store/ from outside store.ts and db.ts. No hook imports src/team/.

## Findings
- F-1 · advisory · docs/adr/0026-team-server.md:74 · The new sentence says that, beside the runner, the server takes `writeFileAtomic` and `headOf` from repo.ts "and nothing else of the module". The code takes more from the knowledge module:
  - from repo.ts: `hashOf` (src/team/validate.ts:13; D-20 names it), and `projectFolderName`, `commitPaths`, `stagePaths` and `removePaths` (src/team/mirror.ts:8-17);
  - from entry.ts: `slugify` (mirror.ts:7), `parseEntry`, `checkSlug`, `ENTRY_MAX_BYTES`, `AREA_ID`, `AREA_MAX` and `UUID` (validate.ts:5-12), and `ENTRY_MAX_BYTES` again in src/team/server.ts:3;
  - from types.ts: the `Identity` and `KnowledgeEntry` types.

  The rest of the ADR states most of these (D-20, the runner), so this is a wording issue, not a boundary crossed. Fix: either drop "and nothing else of the module", or say the server reads the module's entry format (entry.ts) and its git helpers (repo.ts), naming the two the round asked about.
- F-2 · advisory · src/team/db.ts:4 · db.ts's header comment says it holds "the two reads an open needs". CLAUDE.md:16 says the same ("`db.ts` is the schema, the three opens and the two reads an open needs"). ADR 0026 D-1 and line 48 now name four statements: the version read, the schema check, `secure_delete` and the identity write. The two short statements now say less than the ADR, so a reader who goes by CLAUDE.md alone misses the write. Fix: make the db.ts header and the CLAUDE.md clause match the ADR's list.

## Outside the change
none

## Not answerable
none
