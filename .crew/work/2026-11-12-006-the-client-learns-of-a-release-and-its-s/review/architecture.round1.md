# architecture findings for 2026-11-12-006-the-client-learns-of-a-release-and-its-s
reviewer: review-architecture
read: rubric; CLAUDE.md (engine with modules, ADR 0010 settings, hook-path conventions); docs/adr/0029-release-distribution.md (head and piece list); docs/adr/0030-release-notice.md (new, in the diff); the spec (Design §1–4, Limits, AC list); review/diff.patch in full (35 files in files.txt); for context src/util/paths.ts, src/settings/settings.ts (publicSettings, Source), src/doctor/checks.ts (Check), and the importers of src/status/report.ts and src/update/.

## Findings
- F-1 · advisory · docs/adr/0030-release-notice.md:3 · ADR 0030 says it narrows ADR 0029's piece 2, but ADR 0029 is not changed. Its Status line and line 30 ("the client that learns of a release and follows it") still read as before. The project's own precedent, set when 0029 amended ADR 0008, is to note the amendment in the older ADR's Status line. Add "piece 2 narrowed by ADR 0030" to 0029's Status line.
- F-2 · advisory · src/update/report.ts:14 · `export type Source = "env" | "file" | "default"` restates `Source` from `src/settings/settings.ts:103`. This file already imports from settings, and the value it types comes from `updateSetting`. Import the type from settings so the two cannot drift apart.
- F-3 · advisory · src/status/report.ts:653 · The Design says `ago` is moved to `src/util/`. The status report instead keeps re-exporting it (`export { ago }`), and `src/cli/commands/share.ts:45` still imports `ago` from `../../status/report.ts`. That leaves two homes for one helper. Point share.ts at `src/util/ago.ts` and drop the re-export.
- F-4 · advisory · src/status/report.ts:24-25 · The status report now statically imports `src/update/report.ts`, which itself statically imports `src/install/binary.ts` and the settings. So the viewer process (`src/ui/server.ts` imports `statusReport`) and anything that loads `src/doctor/checks.ts` also load the update folder and the binary stager, though they never use them. This breaks no rule: the direction is status → update, which AC-27 allows, and nothing is on a hook's path. But only `updateLines`/`commandLines` and a type are needed. Formatting the update lines in `src/cli/commands/status.ts`, or importing the type only, would keep the status layer from depending on install code.

No defects. Every place the base and the Design name was checked against the diff:
- `src/update/` imports nothing from store, modules, engine, sync, status or doctor.
- `main.ts` imports only the leaf `reconciled.ts` statically and loads `reconcile.ts` with `await import()` after the early returns and the legacy migration.
- `distill` runs the check in its own guard after the drain, with dynamic imports, off the hook path.
- `update.json` lives in the data directory (`defaultDataDir()`, the same path `resolvePaths().dataDir` uses), outside the store and its schema.
- The key goes through `src/settings/` (SETTING_KEYS, RULES, `updateSetting` via `rawSettings`, so the environment wins), and `ui/src/api.ts`'s `SettingKey` is updated with it.
- doctor's `update` check is added in the command, not in `runChecks`.
- `install`'s hand-over goes through the shared `handOver`.
- `stagedPath`/`stagedVersion` come from `src/install/binary.ts` without changing `stageBinary`'s behaviour, and versions are ordered through `src/util/version.ts`.

## Outside the change
- src/cli/commands/share.ts:45 · imports `ago` from the status report rather than from a util; the diff left this in place (see F-3).

## Not answerable
none
