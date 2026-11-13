# The team server restores its own copy safely, an image says what it is, and `latest` moves once

## Problem

A team server follows no release by itself, and the next item builds a timer for that. This item is what that timer, and any upgrade by hand, stands on. Three things are wrong or missing today:

- **`latest` is pushed at build time.** `release.yml`'s `docker/metadata-action` step has no `flavor`, and its default adds `:latest` to a plain release: the log of the 0.8.0 run shows `pushing manifest for …:latest`. That happens before npm, the Homebrew tap and the marketplace are published and before `distribute.yml` decides whether `latest` must stay on the previous release for the sake of older clients. ADR 0029 and ADR 0026 say `latest` moves last; until this change that is false for every release.
- **An image cannot be asked what it would bring.** `serve status` says the binary's version and the schema of the database it reads, but it needs the data directory, and says nothing of the schema the binary itself runs. Whether an image would migrate a `team.db`, or could still open one, can only be learned by starting it on the data. The `listening` line of a start names no version.
- **The documented rollback can lose what members sent, and leaves the server in a state nobody checked.** The runbook's hand procedure copies `team.db` alone and deletes `team.db-wal`; after an unclean stop the writes since the upgrade are in that WAL. It leaves the operator to pick the copy by its file name and checks neither file. The copy it puts back is in rollback-journal mode (`probes/sqlite-facts.md`), and the server sets WAL only on a new file. It says nothing of the erasures and revocations the restore undoes, of the invitations it makes usable again, or of the mirror's repositories, which keep what the restore removed.

## Goals

1. `latest` moves once, last, in `distribute.yml`, and a test holds the mechanism that moved it early.
2. An image says its version and the team schema it runs to a command that opens no database, and the server says both at start.
3. One command of the binary puts back the copy an upgrade made: it checks before it writes, keeps the present database whole, never leaves the newer file's WAL beside the copy, and says what is lost and which commands must be run before the server starts.
4. The runbook's Rollback is that command and those commands, in order.

## Non-Goals

- The host's script, its timer and the rule of which release may be applied: the next item (`probes/returns-for-the-script.md` holds what it must take up).
- A restore without a person: never. The author decided on 2026-11-13 (D-1) that no data is touched unattended.
- A signature or provenance check of the image.
- Keeping more than the two upgrade copies `src/store/db.ts` keeps.

## Open Questions

None.

## Terms

- **The upgrade copy**: `backups/team-<ms>-v<n>-<pid>.db`, made by a binary before it migrates `team.db`; `<n>` is the schema before the migration and `<ms>` the time.
- **The aside file**: `backups/team-before-rollback-<ms>.db`, the present `team.db` moved away by the restore.
- **The staging file**: `team.db.restoring`, the upgrade copy being prepared beside `team.db`.
- **The newer image** runs the restore (only it can open the newer file); **the older image** is the one gone back to.

## Critical User Journeys

1. **A release.** Given a tag `v0.9.0`, when `release.yml` builds the image, then the registry gains `0.9.0` and `latest` does not move; when `distribute.yml` has published every other target and the release is not held, then `latest` is `0.9.0`.
2. **An operator asks what an image would bring.** Given an image pulled and not started, when they run `docker run --rm <image> serve version`, then they read its version and its team schema with no volume mounted; beside `serve status` of the running server, that says whether the image would migrate.
3. **A rollback across a migration.** Given a server upgraded from schema 2 to schema 3 that the operator wants to leave, when they stop it and run `serve restore --to-schema 2`, then no data file changes and they read which upgrade copy would come back, from when, what members sent since, and the commands to run afterwards. When they run it with `--yes`, the present database is the aside file and `team.db` is the upgrade copy, in WAL mode. They set `.env` back and run, with the older image, the commands the restore printed: the renewal first, then every repeated action, then the mirror's rebuild. Then they start the server: it serves a new instance, every client pulls from zero, a device revoked since the copy is still revoked, an item erased since is still erased, and the mirror holds what the database holds.
4. **A wrong copy.** Given a `backups/` folder where the file named for schema 2 is not a team database at schema 2, or a `team.db` that is itself still at schema 2, when `serve restore --to-schema 2 --yes` runs, then it refuses and no data file changes.
5. **A restore cut half way.** Given a restore killed between its two renames, when the operator runs `serve restore --to-schema 2 --yes` again, then the swap is finished from the staging file and the output says so.

## Design

### `latest`

`release.yml`'s metadata step gains `flavor: latest=false`. Two tests in `tests/unit/deploy-files.test.ts`:

- every step of every workflow that uses `docker/metadata-action` sets `flavor` to a value containing `latest=false`. This holds the mechanism: the action adds `latest` without the word appearing in the file.
- no workflow but `distribute.yml` holds an image reference ending in `:latest`. This one already passes today; it is a guard against the other way of pushing the tag.

What neither reaches: a tag pushed on an older commit runs that commit's `release.yml`, which still pushes `latest`, and a branch's workflow can ask for `packages: write`. So everyone who can push a tag or a branch to the repository can move `latest`. Nothing follows `latest` yet; ADR 0031 and the runbook say so in those words, and the next item, which makes something follow it, must name its control.

### What an image says

`wizardingcode-mem serve version` prints, one `key=value` a line: `version` (the package's), `team_schema` (this binary's `TEAM_LATEST`), `contract` and `accepts` (the accepted contracts, comma-separated; the next item's script reads the four). It reads no data directory and opens no database.

The `listening` event gains `version` and `teamSchema`. `serve status` is unchanged.

### `serve restore`

`wizardingcode-mem serve restore --to-schema <n> [--yes]`, run with the server stopped, by the newer image: `docker compose run --rm server serve restore …` while `.env` still names it. `--to-schema` is required: the operator names the schema of the image they go back to, which `serve version` of that image prints, and a restore to the wrong schema is refused by that image at start.

**Where the code lives.** `src/team/restore.ts` holds the steps over files and no SQL. Every statement it needs is a function of `src/team/store.ts`, as the `team-store-boundary` test requires; the checkpoint is the existing `checkpointWal`, whose answer says whether a reader held the log. The opens are in `src/team/db.ts`, which gains three beside the three it has. The checks read the present file through the existing read-only open, `openTeamExisting`; a file ahead of this binary's schema, which that open refuses, is reported as a refusal of the restore in its own words.

- `openTeamPresent(dir)`: read-write, never migrating, refusing any schema but this binary's `TEAM_LATEST`. The two writing opens that exist migrate, and a migration prunes `backups/` to the newest two copies, which could delete the upgrade copy being restored.
- `openTeamCopy(file)`: read-only, never migrating, for a file under `backups/`.
- `openTeamStaging(file)`: read-write, never migrating, for the staging file alone.

**The checks.** Every check, with `--yes` or without, runs through read-only opens; the writing open comes only once all passed. A writing connection to a WAL database checkpoints the WAL into `team.db` when it closes, and a refused run must not do that. A refusal changes no byte of `team.db`, of `feed.seq` or of any file under `backups/`, and none of `team.db-wal` when it exists. SQLite's own side files (`-shm`, an empty `-wal`) are outside that promise: a read-only open may create them, and which it does differs between platforms (`probes/sqlite-facts.md`).

1. A fresh `serve.lease` is held, by a server or by another restore: refused, naming the owner and when the lease ends. After a kill a server's lease stays fresh for up to 30 seconds.
2. The present `team.db` must be exactly at this binary's `TEAM_LATEST`. A file behind it means the wrong image is restoring.
3. `<n>` must be below `TEAM_LATEST`.
4. The upgrade copy: the newest `backups/team-<ms>-v<n>-<pid>.db` whose `v` is `<n>`; none, or no `backups/` folder, is refused naming the folder. Its name is no proof: it is opened and must pass three checks, each its own refusal: `user_version` equal to `<n>`; the team schema's own mark, the `meta` row `team.schema = 'team'` that `requireTeamSchema` reads (a client's store under that name fails here); and `PRAGMA quick_check`. Any error of that open or of those reads is a refusal naming the file.
5. Free space on the data directory's filesystem must be at least the upgrade copy's size plus 1 GiB. The copy is the one file the restore writes; the margin is what the older server's first start and the mirror's rebuild then need, five times the 200 MiB under which the server refuses writes (ADR 0026, D-15).

**What is lost**, printed before the yes and again after a restore. The time that splits before from since is the upgrade copy's `<ms>`.

- `would_restore=<file>` (after a restore, `restored=<file>` and `aside=<file>`), `copied_at=<iso time>`.
- Counts read from the present database: `lost.entries_created`, `lost.entries_revised`, `lost.memories` (by the server's own `received_at`), `lost.names`, `lost.members`, `lost.devices`, and `lost.changes`, the greater of the feed's `changes` mark in `feed.seq` and the present database's own, less the upgrade copy's.
- The commands to run after the restore, each as `docker compose run --rm server serve …`, the form that works with the server stopped:
  1. `serve instance renew`, once, or `floor(lost.changes / 1_000_000) + 1` times when `lost.changes` is a million or more (below).
  2. One line per audit row since the copy: when, who, the action, its target, its detail. An action the operator can repeat carries its command: a revoked device, a disabled or enabled member, a role, a withdrawal, a reinstatement, a revoked invitation, a purge. A token rotated since the copy has no command of its own, and the restore brings the old token back to life: its line carries `serve revoke <device>`, with the note that the device then joins again with a new invitation. For a device, a member and an invitation the upgrade copy is asked, by primary key, whether the target is in it; one that is not (a device enrolled since the copy, then revoked) is printed as lost with the restore, with no command. For an entry, a memory and a shared name the command is always printed: the older image answers `no such item` or `no such name` for one that arrived after the copy, and the line says that this answer is fine.
  3. Every invitation created before the copy, used after it and not expired, as `serve invitation revoke <id>`. The upgrade copy holds it unused, so the person who joined with it could join again with the same code. An invitation created after the copy is printed as lost, with no command.
  4. `serve mirror --rebuild`, last.

**With `--yes`**, in this order:

1. Whether `team.db` is there is looked at first. If it is missing, an earlier restore was killed during its swap, and this run does one of two things and ends: when a staging file and an aside file are both there, it moves any `team.db-wal` or `team.db-shm` left at the present name to the aside file's names (they belong to the file that was moved away), renames the staging file into place, checks it as in step 7, prints `finished=` and `aside=`, and exits 0; when no staging file is there, it refuses, naming the newest aside file and the two `mv` commands that put it back. Only when `team.db` is there does the run go on, and it then removes a staging file left by an earlier run.
2. The checks above.
3. `openTeamPresent`, and `serve.lease` claimed as owner `restore` for 15 minutes: the server's own 30 seconds would end during the copy of a large database.
4. The upgrade copy is copied to the staging file (mode 0600), which is then opened by `openTeamStaging`, set to WAL mode, checked with `PRAGMA integrity_check`, checkpointed and closed, its own side files removed, and synced.
5. The lease is claimed again. If the copy outlasted it and another owner holds it, the restore stops here: the staging file is removed and nothing else changed.
6. `checkpointWal` on the present database. If a reader held the log, the restore stops as in step 5. Otherwise the lease is released and the connection closed. From here no lease can be held, since it is a row of the file about to be moved: the server must stay stopped, and the runbook says so.
7. `team.db` is renamed to the aside file, its `-wal` and `-shm` with it when they exist, as the client's own restore does (`src/backup/backup.ts`); the staging file is renamed to `team.db`; the folder is synced. Then `team.db` is opened read-only: `integrity_check` must pass and the journal mode must be `wal`. If that check fails, the restore exits non-zero, says that `team.db` is the upgrade copy and names the aside file; the runbook gives the two renames that put the aside file back.
8. The list of what is lost, once more.

A failure in step 4 removes the staging file and its side files, releases the lease and closes the connection. No aside file exists before step 7.

**The renewal.** The restore writes nothing into the restored file and never writes `feed.seq`. Left alone, the server's next start would find `feed.seq` ahead of the file and renew the instance by itself. But the commands above are run before that start by the older image, whose every admin command ends by overwriting `feed.seq` with the database's own marks; the first of them hides the restore from the server. No change to this binary can fix what an older image runs. So the renewal is a command the older image already has, run first: `serve instance renew` sets a new instance and moves the feed's sequence a million (`SEQUENCE_MARGIN`) past the restored file's own mark. Every client then pulls from zero. A number is reused only if a million or more changes were written since the copy, which `lost.changes` shows; the restore then prints the renewal as many times as it takes to pass the old mark.

**The mirror.** The repositories under `repos/` hold commits for everything written since the copy, and the restored database records exports only up to the copy. `serve mirror --rebuild`, run last by the older image, removes the repositories and writes them again from the database.

### The runbook

`docs/runbooks/team-server.md`:

- **The image** paragraph says `latest` was pushed at build time until this change, that it is now moved last, and that everyone who can push a tag or a branch can still move it.
- **Rollback** has two cases, told apart by `serve version` of the two images. To a release of the same team schema: set `WIZARDINGCODE_MEM_VERSION` back and `docker compose up -d server`, as today; no restore is needed, and `serve restore` refuses it. Across a migration, in this order: check that the older tag is on the host (`docker image ls`); `docker compose stop server`; `docker compose run --rm server serve restore --to-schema <n>` and read it; the same with `--yes`; set `WIZARDINGCODE_MEM_VERSION` back; then every command the restore printed, in the order printed, each `docker compose run --rm server serve …`: the renewal, the repeated actions and the invitations, the mirror's rebuild; only then `docker compose up -d server`. It says that `docker compose exec` does not work while the server is stopped and that the server is not started to make it work. It says that between the stop and the final start no `docker compose up` may be run at all, of the server or of `caddy`: `caddy` depends on the server, so `up -d caddy` starts it; `docker compose restart caddy` restarts Caddy alone. It says why the order matters: the restored file holds tokens and rows as they were at the copy, so once the server is up a device revoked since authenticates again and every restored row, an erased one included, goes to every member. It says what to do when the older image answers `unknown subcommand` to one of the commands: that action cannot be kept across this rollback, the server stays stopped, and the way is forward again (`.env` on the newer tag, the two renames that put the aside file back, start).
- It says what members meet afterwards: a device enrolled since the copy reads `revoked` and its person needs a new invitation (`lost.members` and `lost.devices` count them); a client keeps as sent what the server lost and does not send it again by itself, so entries and memories written since the copy are on the members' machines and in the aside file, and nowhere on the server.
- It says what to do when the restore refuses for want of an upgrade copy (two later migrations pruned it): there is no way back by this command; the choice is a restore of the whole volume from the operator's own backup, or forward.
- It says that the aside file and the upgrade copies hold everything as it was, erased rows included, that no purge reaches them, that they count against the disk, and that the aside file is deleted by hand (`rm` through `docker compose run --rm --entrypoint sh server`) once the rollback is settled.

The hand `cp` and `rm` of the old procedure are gone from it.

## Alternatives considered

- **Keep the hand copy-back and fix its text.** Rejected: it leaves the choice of the copy, the checks, the lease, the journal mode and the order of the swap to a person reading a runbook during an outage.
- **A second full copy of the present database (`VACUUM INTO`) as the aside file.** Rejected for the rename the client's restore already uses: the present file moved away whole needs no room, cannot fail half way, and is what was there.
- **`serve restore` runs the repeated actions itself.** Rejected: they must be run by the older image, which is not the one that restores, and an erasure run by a restore nobody read is an erasure nobody decided twice.
- **The server detects the restore at its next start**, with a rule in this binary that an admin command never lowers `feed.seq`. Rejected: the commands between the restore and the start are the older image's.
- **Choosing the copy by its file name alone.** Rejected: the folder is pruned and written by hand.
- **Holding the lease across the swap.** Rejected: the lease is a row of the file moved away (step 6), and writing one into the staging file would break the rule that the restore writes nothing into the restored file.
- **`--to-schema` defaulting to the newest copy.** Rejected: the newest copy is not always the one the older image opens (two migrations in a row leave two), and a wrong guess swaps the database for one the server then refuses.
- **The whole of piece 3 in one item.** Rejected: the script's risks and the data's risks are two reviews.

## Acceptance criteria

- AC-31: Every step of every workflow that uses docker/metadata-action sets a flavor containing latest=false; release.yml's does.
- AC-32: serve version prints version, team_schema (this binary's TEAM_LATEST), contract and accepts, one key=value a line, with no data directory and no database opened; the listening event carries version and teamSchema.
- AC-33: serve restore --to-schema n without --yes changes no byte of team.db, feed.seq, any file under backups/ or team.db-wal when it exists, and prints would_restore, copied_at, the seven lost counts (entries created, entries revised, memories, names, members, devices, changes), then the commands in order: serve instance renew (as many times as lost.changes needs), one line per audit row since the copy, the invitations, and serve mirror --rebuild last.
- AC-35: serve restore refuses each of the following, without --yes and with it, on a database whose last rows are only in the WAL, changing no byte of team.db, team.db-wal, feed.seq or any file under backups/: a fresh serve.lease; a present team.db behind this binary's schema; n not below it; no backups folder; no upgrade copy for that schema; an upgrade copy whose user_version is not n; one without the team schema's mark; one that fails quick_check or cannot be opened; too little free space (the injected reading).
- AC-36: serve restore --to-schema n --yes: the aside file is the present database, with every row it held, those only in the WAL included; team.db holds the upgrade copy's rows and none written since, passes integrity_check and is in WAL mode; feed.seq is untouched; no staging file is left; a server started while the restore holds its lease, with the clock 31 seconds on, is refused.
- AC-37: After a restore, run with the admin commands writing feed.seq as they do today: serve instance renew, serve purge of an entry that is in the upgrade copy, serve revoke, serve mirror --rebuild, then a server start: the server holds no stale lease, serves an instance other than the one before the restore, the feed's sequence is above the mark feed.seq held before the restore, and the mirror's repository holds no file of an entry written since the copy; the same sequence without the renewal serves the upgrade copy's own instance.
- AC-42: In that list: a device, a member or an invitation that is in the upgrade copy carries its `docker compose run --rm server serve …` command, and one that is not is printed as lost with no command; a token rotated since the copy, of a device that is in the copy, carries `serve revoke` for that device; a purge, a withdrawal or a reinstatement of an entry or a memory, and a purge of a name, always carry their command, a purge of an entry created before the copy included; an invitation created before the copy and used after it carries `serve invitation revoke`, and one created after the copy is printed as lost.
- AC-43: A copy that fails after writing part of the staging file leaves every row of the present database readable with the same values, the lease free, `feed.seq` unchanged, and no staging or aside file; a restore whose lease was taken by another owner during the copy stops the same way; a run that finds `team.db` missing beside a staging file and an aside file, with a non-empty `team.db-wal` left at the present name, moves that WAL to the aside file's name, finishes the swap and prints `finished=`, and the restored file holds none of that WAL's rows; one that finds `team.db` missing and no staging file refuses, naming the aside file.
- AC-44: The runbook's Rollback has both cases: the same team schema by `.env` alone, and across a migration the restore command with, in order before `docker compose up -d server`, `serve instance renew`, the repeated actions and `serve mirror --rebuild`; its hand `cp` of `team.db` and `rm` of `team.db-wal` are gone; it says `exec` does not work while the server is stopped, that no `docker compose up` may run meanwhile and that `docker compose restart caddy` restarts Caddy alone, what members meet afterwards, what to do on `unknown subcommand` and when no upgrade copy is left, and what the aside file and the upgrade copies keep; the image paragraph says who can move `latest`.
- AC-40: ADR 0031 exists and records D-1, the restore's checks and order, the renewal by the older image, the mirror's rebuild and who can move latest; ADR 0029 and ADR 0026 say latest was pushed at build time until this change; ADR 0026's rollback points to ADR 0031; CLAUDE.md names src/team/restore.ts and the three new opens, and no longer says db.ts has three.
- AC-41 (preserve): Every test of tests/unit/deploy-files.test.ts and tests/unit/team-runbook.test.ts passes as before, but one: 'release.yml: docker pushes the version tag only, publish reads the full history, and distribute starts distribute.yml', which gains the flavor's assertion.

The restore is proven in the suite against real SQLite files in a temporary data directory. Rows that are only in the WAL come from a crash image: the files of a database copied while a writer still holds it open. No Docker is needed for anything in this item.

## Risks and their answers

- **A restore undoes more than it can name.** The audit names admin actions; a member's own pushes are only counted. Answer: the counts are printed before the yes, and the aside file keeps every row.
- **No upgrade copy left.** After two later migrations the copy of an older schema is pruned. Answer: the refusal names the folder, and the runbook gives the two ways left.
- **The aside files are never pruned and hold erased rows.** Answer: the runbook says so and how to delete one; the restore's output names the file each time.
- **A million changes since the copy.** Answer: `lost.changes` shows it and the renewal is printed as often as needed.
- **`latest` on an older commit.** Answer in this item: none but the words in ADR 0031 and the runbook; nothing follows `latest` yet. Owner: the next item.
- **A restore killed during its swap** leaves no `team.db`. Answer: the next `--yes` run finishes it, provided nothing started the server meanwhile; a server started on a folder with no `team.db` creates an empty one, and the restore then has nothing to finish.
- **The server started before the commands were run.** From the restore's end to the operator's final start, only the runbook keeps the server stopped; `docker compose up -d`, of `caddy` too, starts it. Answer: the runbook's warning and `docker compose restart caddy`; no mechanism in this item.
- **What members wrote since the copy is not re-sent.** Answer: the counts before the yes, the aside file, and the runbook's paragraph on what members meet.

Rollback of this change: `flavor: latest=false` is one line; the two subcommands change nothing unless called; the `listening` event's two fields are additions.

## Non-Functional Requirements

- A dry run and a refusal change no byte of `team.db`, `feed.seq`, any file under `backups/`, or `team.db-wal` when it exists.
- No row of the upgrade copy is written into the present file: the upgrade copy arrives by a rename and the present file leaves by one. The one write the restore makes to the present file is its own lease and the checkpoint that folds that file's WAL into it before it is moved.

# Plan: the team server restores its own copy safely, an image says what it is, and `latest` moves once

Read `spec.md` first, its Terms section above all (upgrade copy, aside file, staging file, newer and older image). Five phases; each leaves `bun run check` green. Tests run with the pinned Bun: `./node_modules/.bin/bun test <files>`. Inside a crew worktree the lint gate reads nothing, so lint by name after each phase: `./node_modules/.bin/biome check src scripts tests npm`.

Rules of the repository that bind every phase (`CLAUDE.md`):

- Every SQL statement of the team server lives in `src/team/store.ts`. `tests/unit/team-store-boundary.test.ts` fails on `.query(`, `.run(`, `.prepare(`, or an import of `bun:sqlite` or of a path containing `store/`, in any file of `src/team/` other than `db.ts` and `store.ts`.
- The opens of `team.db` live in `src/team/db.ts`.
- Imports carry an explicit `.ts`.
- A behaviour's test is written and seen failing before its code: `crew tdd red <id> AC-n -- <command>`, the code, `crew tdd green <id> AC-n -- <command>`. Where this plan says a test is a guard that passes already, no red is recorded for it and the item's notes say so.

Before anything: `crew tdd before <id> AC-41 -- ./node_modules/.bin/bun test tests/unit/deploy-files.test.ts tests/unit/team-runbook.test.ts`. After phase 5: `crew tdd after` with the same command.

## Phase 1: `latest` (AC-31, AC-41)

**Modify `tests/unit/deploy-files.test.ts`.**

- In the existing test "release.yml: docker pushes the version tag only, publish reads the full history, and distribute starts distribute.yml", after the assertion on the metadata step's `tags`, assert that the step's `with.flavor` contains `latest=false`. This is the one existing test that changes.
- Add "every use of docker/metadata-action turns the latest flavor off": parse every `.yml` under `.github/workflows/` with the YAML reader the file already uses; for every step of every job whose `uses` starts with `docker/metadata-action@`, expect `String(step.with?.flavor ?? "")` to contain `latest=false`; expect at least one such step in all.
- Add "no workflow but distribute.yml names an image's latest tag" (a guard: it passes today, no red is recorded): in every workflow file's text, the matches of `/[a-z0-9.\/_-]+:latest\b/` are empty, except in `distribute.yml`, which has at least one.

Red for AC-31: `./node_modules/.bin/bun test tests/unit/deploy-files.test.ts -t "metadata-action"` fails on `release.yml`.

**Modify `.github/workflows/release.yml`.** In the `docker` job's `docker/metadata-action` step add, under `with:`, `flavor: latest=false`, with the comment above it: `# The action's default adds latest to a plain release; latest is moved once, last, by distribute.yml (ADR 0029, ADR 0031).`

## Phase 2: `serve version` and the `listening` event (AC-32)

**Modify `tests/integration/team-serve-cli.test.ts`.** Add:

- "serve version answers with no data directory": `runCliWith(["serve", "version"], { env: { WIZARDINGCODE_MEM_TEAM_DATA: <a path under a fresh temp dir that does not exist>, WIZARDINGCODE_HOME: <the same> } })`. Expect exit 0; standard output is exactly four lines, in order: `version=<package.json version>`, `team_schema=<TEAM_LATEST>`, `contract=<CONTRACT>`, `accepts=<ACCEPTED_CONTRACTS.join(",")>`; the path still does not exist.
- "the listening event carries the version and the binary's schema": with the file's `team()` helper, parse `t.lines`, find the object whose `event` is `listening`; expect `version` equal to the package's and `teamSchema` equal to `TEAM_LATEST`.

Red: `crew tdd red <id> AC-32 -- ./node_modules/.bin/bun test tests/integration/team-serve-cli.test.ts -t "serve version|listening event"`.

The helper's signature is `runCliWith(options, ...args)` (`tests/helpers/cli.ts`); the file's own `cli()` wrapper, which also sets `WIZARDINGCODE_MEM_MIGRATE: "off"`, is what the new cases call, with the extra environment merged in.

**Modify `src/cli/commands/serve.ts`.** Add `function version(): number` writing the four lines with `out` and returning 0 (`CONTRACT`, `ACCEPTED_CONTRACTS` from `src/team/contract.ts`; `TEAM_LATEST` from `src/team/db.ts`; the version from `package.json`, imported as `src/team/status.ts` imports it). In `run`, handle it as the first statement after the `--help` branch: `if (argv[0] === "version") return version();`, before the shell (the data directory, the log) is built. Add to `USAGE`, after `instance renew`: `       version` and, at the end of the subcommands' paragraph, nothing else.

**Modify `src/team/server.ts`.** The `log.line({ event: "listening", … })` call gains `version: pkg.version` and `teamSchema: TEAM_LATEST`; add the two imports (`pkg` from `../../package.json` with `{ type: "json" }`, as `status.ts` has it, and `TEAM_LATEST` beside the names already imported from `./db.ts`). `serve --data <dir> version` is not supported: `version` is read as the first argument only, and `USAGE`'s header says "each but version and health takes --data <dir>".

**Modify `docs/runbooks/team-server.md`.** In "The log's events", the `listening` row names the two fields.

## Phase 3: the opens and the statements

These serve AC-33, AC-35 to AC-37, AC-42, AC-43 and are proven by the restore's tests in phase 4; their reds are those tests'. Write phase 4's tests first, then this phase and phase 4's code together.

**Modify `src/store/db.ts`.** Add `export function openForWrite(dir: string, file: string, options: { before?: (db: Db) => void; busyTimeoutMs?: number } = {}): Db`: `new Database(join(dir, file), { readwrite: true, create: false })`, `PRAGMA busy_timeout` (`options.busyTimeoutMs ?? 5000`), then `options.before?.(db)`, closing the handle and rethrowing if anything throws. It runs no migration and makes no copy.

**Modify `src/team/db.ts`.**

- Re-export `restrict` and `enableWal` from `../store/db.ts` (`export { enableWal, restrict } from "../store/db.ts";`), so `restore.ts` imports neither from the core store.
- `openTeamExisting(dir: string, latest = TEAM_LATEST)`: the existing open gains the parameter and passes it to `openExistingFile` in place of the constant; its callers are unchanged.
- `export function openTeamCopy(file: string): Db`: the core's `openExistingFile(dirname(file), basename(file), { before: requireTeamSchema })`; a null result throws `Error("no such file")`.
- `export function openTeamPresent(dir: string, latest = TEAM_LATEST): Db`: `openForWrite(dir, TEAM_DB_FILE, { before: prepareWriter })`; then the version is read with this file's own private `userVersion`, and if it is not `latest` the handle is closed and a new `SchemaMismatchError(found, latest)` is thrown (add the class to `src/team/errors.ts`, message `team.db is at schema <found>, this binary runs <latest>`). `latest` is a parameter for the tests, as `openTeamForWrite` has one.
- `export function openTeamStaging(file: string): Db`: `openForWrite(dirname(file), basename(file), { before: requireTeamSchema })`.
- The header comment's "the three ways to open the file" becomes six, each named in one line.

**Modify `src/team/errors.ts`.** Add `SchemaMismatchError` (above).

**Modify `src/team/store.ts`.** Add, each an exported function over a `Db`:

- `quickCheck(db): boolean` and `integrityCheck(db): boolean`: the pragma's first row is `ok`.
- `journalMode(db): string`.
- `lostSince(db, at): { entriesCreated: number; entriesRevised: number; memories: number; names: number; members: number; devices: number }`. `entriesCreated`: `entry_revisions` rows with `revision = 1 AND at > ?`. `entriesRevised`: `count(DISTINCT uuid)` of `entry_revisions` with `revision > 1 AND at > ?` whose `uuid` has a row with `revision = 1 AND at <= ?`. `memories`: `memories` rows with `received_at > ?`. `names`: `names` rows with `created_at > ?`. `members`, `devices`: `created_at > ?`.
- `auditSince(db, at): AuditRow[]`: audit rows with `at > ?`, by `id` ascending, no limit; the row type `listAudit` returns.
- `inCopy(copy, table: "devices" | "members" | "invitations", id: string): boolean`: `SELECT 1 FROM <table> WHERE id = ?`, the table name taken from that closed list (never interpolated from input). These three tables and their `id` column are unchanged since schema 1.
- `invitationsUsedSince(db, at, now): { id: string; createdAt: number }[]`: `invitations` with `used_at > ? AND expires_at > ? AND revoked_at IS NULL`.

`checkpointWal` and `sequenceHighWater` are used as they are.

## Phase 4: `serve restore` (AC-33, AC-35 to AC-37, AC-42, AC-43)

### The fixture

**Create `tests/helpers/team-restore.ts`.** All times are wall time (`Date.now()`); nothing here uses the fake clock.

- `PROBE_MIGRATION`: `{ version: TEAM_LATEST + 1, name: "restore_probe", sql: "CREATE TABLE restore_probe (x INTEGER)" }`, and `NEXT = TEAM_LATEST + 1`. The tests stand in for a newer binary by a schema one above the real one, so the upgrade copy is a real database at the real schema and the commands of the older image are this binary's own, run with no migration.
- `async function world()`: starts `startTestServer({ now: Date.now })`; with the helpers of `tests/helpers/team.ts` makes an admin, a member Ana with a device, a second member Rui with a device, pushes two shared entries from Ana (`old` and `doomed`) and one memory, mints one unused invitation (`api(t.server, admin.token, "POST", "/v1/invitations", body)`, the id read from the answer's body), and runs the real mirror once (`runMirror` with a context built as `tests/integration/team-mirror.test.ts`'s `mirrorCtx` builds it), so `repos/` holds the files of `old` and `doomed`; reads `server.instance` and `feed.seq`; stops the server (`t.close()` must not remove the directory: pass `overrides.dataDir` a directory the fixture made and removes itself). Returns `{ dir, ids }`.
- `function upgrade(dir)`: `openTeamForWrite(dir, Date.now(), { latest: NEXT, migrations: [...TEAM_MIGRATIONS, PROBE_MIGRATION] }).close()`. This is the real upgrade: it makes `backups/team-<ms>-v<TEAM_LATEST>-<pid>.db` and migrates. Returns the copy's path and `<ms>`; then waits 5 ms so later rows are strictly after `<ms>`.
- `function since(dir, ids)`: opens the present file with `bun:sqlite` directly (a helper is outside `src/team`, so the boundary test does not apply) and writes, each with `Date.now()`: a new entry (`entries`, `entry_revisions` revision 1, `changes`); revision 2 of `old`; a new memory; a name; a member Zoe and her device, with the unused invitation marked `used_at` and `used_by_device`; a second invitation created now and marked used by a second new device, also Zoe's (so one member and two devices are new); `revoked_at` on Rui's device; `disabled_at` on Rui; the rows of `doomed` deleted from `entries`, `entry_revisions` and a `purged` key written. For each act it calls `insertAudit` (from `store.ts`) with the action and target the product writes for it (`join`, `device revoked`, `member disabled` with detail `devices 1, withdrawn 0`, `purged` with target the entry's uid and detail `entry: 2 rows, 1 feed rows`, `invitation made`, and `token rotated` for Ana's device, written as `src/team/routes.ts` writes it). Its inserts into `changes` move `sqlite_sequence` by themselves; nothing else touches it. It then runs the real mirror again, so `repos/` gains the file of the new entry, and ends by writing `feed.seq` with the present database's marks (`writeHighWater(feedFile, currentMarks(db))`), as the server does after every write. Column lists are read from `src/team/migrations/0001_team_init.sql` and `0002_team_names.sql`; every NOT NULL column gets a value.
- `function crashImage(dir): string`: opens the present file with `bun:sqlite`, sets `PRAGMA wal_autocheckpoint = 0`, inserts one more audit row (`action: "wal only"`), and, without closing, copies `team.db`, `team.db-wal`, `team.db-shm`, `feed.seq` and `backups/` into a new temporary directory; then closes. The new directory is a database whose last row is only in its WAL. Returns it.
- Unless a case says otherwise, `restore` is called with `yes: false`.
- `function dataHashes(dir)`: sha256 of every file under `dir`, recursively, leaving out names ending `-shm`, and leaving out a `-wal` of size 0.

### The tests

**Create `tests/integration/team-restore.test.ts`.** Each case builds `world()`, `upgrade`, `since`, `crashImage` and works on the crash image, calling `restore({ dir, toSchema: TEAM_LATEST, latest: NEXT, yes, now: Date.now })` from `src/team/restore.ts` unless it says otherwise.

`describe("the dry run")`, AC-33 and AC-42:

- "changes no data file and prints the copy, the counts and the commands in order": `dataHashes` equal before and after. The lines, in order: `would_restore=<the copy>`; `copied_at=<new Date(ms).toISOString()>`; `lost.entries_created=1`, `lost.entries_revised=1`, `lost.memories=1`, `lost.names=1`, `lost.members=1`, `lost.devices=2`, `lost.changes=<n>` with `n > 0`; then exactly one line `run: docker compose run --rm server serve instance renew`; then the audit lines; then the invitation lines; and the last line is `run: docker compose run --rm server serve mirror --rebuild`.
- "a target in the copy carries its command, one that is not is lost": the `device revoked` line of Rui's device ends ` -> docker compose run --rm server serve revoke <id>`; the `member disabled` line ends ` -> docker compose run --rm server serve disable <id>`; the `join` lines end ` -> lost with the restore`; a `device revoked` row written for Zoe's device (add it in this test) ends ` -> lost with the restore`.
- "a purge is always printed, of an entry that was in the copy too": the `purged` line of `doomed` ends ` -> docker compose run --rm server serve purge entry <uid> --yes (the older image answers no such item if it arrived after the copy)`.
- "a token rotated since the copy revokes the device": the `token rotated` line of Ana's device ends ` -> docker compose run --rm server serve revoke <Ana's device id> (the device joins again with a new invitation)`.
- "an invitation used since the copy is revoked again, one made since is lost": the first invitation's line ends ` -> docker compose run --rm server serve invitation revoke <id>`; the second's ` -> lost with the restore`.
- "a million changes prints the renewal twice": write `feed.seq` with a `changes` mark `1_000_000` above the copy's; expect two `run: … serve instance renew` lines.

`describe("refusals")`, AC-35: `describe.each([false, true])` over `yes`; each case expects `restore` to throw `RestoreRefused` whose message contains the quoted words, and `dataHashes` equal before and after:

- a fresh `serve.lease` (the `meta` row set with `bun:sqlite` in the crash image, `until` one minute ahead, before the `dataHashes` snapshot is taken): "lease";
- the present file behind (call with `latest: NEXT + 1`): "schema";
- `toSchema: NEXT`: "nothing to go back to";
- no `backups/` folder (remove it): "backups";
- no upgrade copy for the schema (`toSchema: TEAM_LATEST - 1`): "no upgrade copy";
- a copy whose `user_version` differs (set `PRAGMA user_version = 7` on a copy of the copy placed under a newer `<ms>` name): "user_version";
- a copy without the team mark (a fresh SQLite file with `PRAGMA user_version = <TEAM_LATEST>`, named newer): "not a team database";
- a copy that cannot be read (the newest-named copy overwritten with 8 KiB of zeros): the copy's file name;
- too little free space (`freeBytes: () => 1`): "free".

`describe("the restore")`, AC-36:

- "moves the present database aside whole and puts the upgrade copy back in WAL mode": `yes: true`. The returned lines hold `restored=` and `aside=`. Opening the aside file read-only with `bun:sqlite`: `PRAGMA user_version` is `NEXT`, and the audit row `wal only` is there. Opening `team.db`: `user_version` is `TEAM_LATEST`; `integrityCheck` true; `journalMode` is `wal`; the entry `doomed` is there, Zoe is not, Rui's device has no `revoked_at`. `feed.seq`'s bytes are those before. No `team.db.restoring` exists. `meta` holds no `serve.lease` row whose owner starts `restore-`.
- "a server started while the restore holds its lease is refused": pass `copyFile: (from, to) => { <open the present file with openTeamForWrite(dir, Date.now() + 31_000, { latest: NEXT, migrations: [...TEAM_MIGRATIONS, PROBE_MIGRATION] }); expect holdLease(db, SERVE_LEASE, "serve", SERVE_TTL_MS, () => Date.now() + 31_000) to throw LeaseHeldError; close it>; copyFileSync(from, to); }`; the restore then finishes.

`describe("the commands before the start")`, AC-37, with `runCliWith(["serve", …, "--data", dir])`:

- "with the renewal, a new instance, a sequence past the old mark, and a mirror without what was written since": after `restore` with `yes`, run `instance renew`, `purge entry <doomed uid> --yes`, `revoke <Rui's device>`, `mirror --rebuild`; each exits 0. Then `startTestServer({ now: Date.now, dataDir: dir })`. Expect `getMeta(db, "server.instance")` different from the instance `world()` read; `sequenceHighWater(db, "changes")` above the `changes` mark `feed.seq` held before the restore; the shared repository under `repos/` (path from `teamPaths` and `repoFolder`, as `tests/integration/team-mirror.test.ts` builds it) held, before the restore, the files of `old`, of `doomed` and of the entry `since` created (asserted first); after the commands it holds the file of `old` and neither of the other two.
- "without the renewal, the upgrade copy's own instance is served": the same without `instance renew`; the instance equals the one read from the upgrade copy.

`describe("cut short")`, AC-43; every case passes `yes: true`:

- "a copy that fails half way": `copyFile` writes the first 1024 bytes and throws. `restore` throws that error. Through `bun:sqlite` read-only, every table's row count equals the count before and the `wal only` row is there; no `serve.lease` is fresh; `feed.seq` unchanged; no file named `team.db.restoring*` or `team-before-rollback-*` under the directory.
- "a lease lost during the copy": `copyFile` copies, then overwrites the `serve.lease` row with owner `serve-x` and `until` a minute ahead. `restore` throws `RestoreRefused` containing "lease"; `team.db` still at `NEXT`; no staging or aside file.
- "a restore killed during its swap is finished by the next run": on a fresh crash image, build the cut by hand: copy the upgrade copy to `team.db.restoring`; rename `team.db` to `backups/team-before-rollback-1.db` and leave its non-empty `team.db-wal` and its `team.db-shm` where they are. Run `restore` with `yes: true`. Its first lines are `finished=<path of team.db>` and `aside=<the aside file>`; `team.db` is at `TEAM_LATEST`, in WAL mode, and holds no `wal only` audit row; `backups/team-before-rollback-1.db-wal` exists and the aside file opened read-only shows the `wal only` row.
- "team.db missing and no staging file": remove `team.db` from a fresh crash image after placing a file `backups/team-before-rollback-1.db`. `restore` throws `RestoreRefused` naming that file.

**Add to `tests/integration/team-serve-cli.test.ts`**: "serve restore: usage, and a refusal's exit": the directory is a `team()` server's, closed with `t.close()` before the command runs so that no lease is fresh (`dataDir` given to `startTestServer` so the close leaves it). `serve restore` exits 64; `serve restore --to-schema <TEAM_LATEST> --data <dir>` exits 1 with standard error containing `restore refused` and `nothing to go back to`.

Reds: create `src/team/restore.ts` exporting `restore` that throws `Error("not built")` and `RestoreRefused`; then `crew tdd red` for AC-33 with `-t "changes no data file"`, AC-42 with `-t "a target in the copy|always printed|an invitation used"`, AC-35 with `-t "refusals"`, AC-36 with `-t "the restore"`, AC-37 with `-t "the commands before the start"`, AC-43 with `-t "cut short"`, each over `tests/integration/team-restore.test.ts`.

### The code

**Create `src/team/restore.ts`.** No SQL.

```
export interface RestoreInput {
  dir: string; toSchema: number; yes: boolean; now: () => number;
  latest?: number;                                  // TEAM_LATEST; tests pass one above
  freeBytes?: (path: string) => number | null;      // src/team/disk.ts
  copyFile?: (from: string, to: string) => void;    // node:fs copyFileSync
}
export const RESTORE_LEASE_MS = 900_000;
export class RestoreRefused extends Error {}
export function restore(input: RestoreInput): string[]   // the lines
```

Names: `present = join(dir, "team.db")`, `staging = present + ".restoring"`, `backups = join(dir, "backups")`.

1. If `yes` and `present` does not exist, the run finishes a cut restore or refuses, and returns. `asides` = the names in `backups` matching `^team-before-rollback-(\d+)\.db$`, `aside` the one with the greatest number. If `staging` exists and `aside` exists: for `-wal` and `-shm`, if `present + suffix` exists, `renameSync` it to `aside + suffix`; `renameSync(staging, present)`; fsync the directory; step 10's check with that `aside` in its message; return `["finished=" + present, "aside=" + aside, "note=the list of what is lost was printed by the run that was cut"]`. Otherwise throw `RestoreRefused("team.db is missing and there is no staging file" + (aside ? "; the database as it was is " + aside + ": put it back with docker compose run --rm --entrypoint sh server -c 'mv " + aside + " /data/team.db'" : "; no aside file was found in " + backups))`.
2. If `yes`: remove `staging`, `staging-wal`, `staging-shm` (`rmSync` with `force`).
3. The checks, inside one `try`/`finally` that closes every handle it opened. `db = openTeamExisting(dir, latest)`, with a `SchemaTooNewError` caught and rethrown as `RestoreRefused("team.db is at a newer schema than this binary: run the restore with the image that left it")`; null → refuse "no team.db in <dir>". `leaseOf(db, SERVE_LEASE)` with `until > now()` → refuse "serve.lease is held by <owner> until <iso>". `teamSchemaVersion(db) !== latest` → refuse "team.db is at schema <x>, this binary runs <latest>: run the restore with the image that left it". `toSchema >= latest` → refuse "nothing to go back to: this binary runs schema <latest>". `backups` missing → refuse "no backups folder at <path>". The upgrade copy: the names matching `^team-(\d+)-v<toSchema>-\d+\.db$`, greatest `(\d+)`; none → refuse "no upgrade copy for schema <n> in <path>". `copy = openTeamCopy(path)`, `teamSchemaVersion(copy) === toSchema` else refuse "…user_version is <x>"; `quickCheck(copy)` false → refuse "<file name> failed quick_check". The open and both reads sit in a `try` whose `catch` lets a `RestoreRefused` pass unchanged, rethrows a `NotATeamDatabaseError` as "<file name> is not a team database" and anything else as "<file name>: <first line of the message>". Free space: `free = freeBytes(dir)`; a number below `statSync(copyPath).size + 1_073_741_824` → refuse "not enough free space: <free> bytes free, <need> needed"; null → continue, and the output gains the line `disk=unknown` right after `copied_at`.
4. Still with `db` and `copy` open, build the lines:
   - `would_restore=<copyPath>`, `copied_at=<iso of ms>`, then `disk=unknown` when it applies.
   - the six counts of `lostSince(db, ms)` as `lost.entries_created`, `lost.entries_revised`, `lost.memories`, `lost.names`, `lost.members`, `lost.devices`; then `lost.changes=<Math.max(readHighWater(feedFile).changes, sequenceHighWater(db, "changes")) - sequenceHighWater(copy, "changes")>`, never below 0.
   - `run: docker compose run --rm server serve instance renew`, `Math.floor(lostChanges / SEQUENCE_MARGIN) + 1` times.
   - for each row of `auditSince(db, ms)`: `<iso of at> <source> <action> <target or -> <detail>` followed by ` -> ` and the right side from this table (`P` is `docker compose run --rm server serve `):

     | Action | Right side | Asked of the copy |
     | :- | :- | :- |
     | `device revoked` | `P revoke <target>` | `inCopy(copy, "devices", target)` |
     | `member disabled` | `P disable <target>`, plus ` --withdraw` when the detail matches `/withdrawn [1-9]/` | `inCopy(copy, "members", target)` |
     | `member enabled` | `P enable <target>` | members |
     | `role set` | `P role <target> <detail>` | members |
     | `token rotated` | `P revoke <target>` + ` (the device joins again with a new invitation)` | `inCopy(copy, "devices", target)` |
     | `invitation revoked` | `P invitation revoke <target>` | `inCopy(copy, "invitations", target)` |
     | `item withdrawn` | `P withdraw <first word of detail> <target>` + the note | not asked |
     | `item reinstated` | `P reinstate <detail> <target>` + the note | not asked |
     | `purged` | `P purge <detail up to its first ":"> <target> --yes` + the note | not asked |
     | `name purged` | `P purge name <target> --yes` + the note | not asked |
     | anything else, or a null target | `lost with the restore` | |

     Where the copy is asked and answers no, the right side is `lost with the restore`. The note is ` (the older image answers no such item if it arrived after the copy)`, with `no such name` for a name.
   - for each row of `invitationsUsedSince(db, ms, now())`: `invitation <id> used since the copy -> P invitation revoke <id>` when `inCopy(copy, "invitations", id)`, else `invitation <id> -> lost with the restore`.
   - `run: docker compose run --rm server serve mirror --rebuild`.
5. Close `db` and `copy` (the `finally`). If `!yes`, return the lines.
6. `w = openTeamPresent(dir, latest)`; `owner = "restore-" + newHexId()`; `claimLease(w, SERVE_LEASE, owner, now(), RESTORE_LEASE_MS)` false → close, refuse "serve.lease was taken".
7. In a `try` whose `catch` removes `staging` and its two side files, calls `releaseLease(w, SERVE_LEASE, owner)`, closes `w` and rethrows: `copyFile(copyPath, staging)`; `restrict(staging, 0o600)`; `s = openTeamStaging(staging)`; `enableWal(s, 5000)`; `integrityCheck(s)` false → throw `RestoreRefused("the staging file failed its integrity check")`; `checkpointWal(s)`; `s.close()`; remove `staging-wal` and `staging-shm`; fsync `staging` (`openSync` "r+", `fsyncSync`, `closeSync`). Then `claimLease(w, SERVE_LEASE, owner, now(), RESTORE_LEASE_MS)` false → throw `RestoreRefused("the lease was lost during the copy")`. Then `checkpointWal(w)` false → throw `RestoreRefused("a reader holds team.db's log")`.
8. `releaseLease(w, SERVE_LEASE, owner)`; `w.close()`.
9. `aside = join(backups, "team-before-rollback-" + now() + ".db")`; `renameSync(present, aside)`; for `-wal` and `-shm`: if `present + suffix` exists, `renameSync` it to `aside + suffix`; `renameSync(staging, present)`; fsync the directory (`openSync(dir, "r")`, `fsyncSync`, `closeSync`, ignoring an error whose code is `EISDIR`, `EPERM` or `EINVAL`).
10. `check = openTeamCopy(present)`; if `!integrityCheck(check)` or `journalMode(check) !== "wal"`: close and throw `Error("team.db is the upgrade copy but failed its check; the database as it was is <aside>")`. Close.
11. Return the lines with `would_restore=` replaced by `restored=<copyPath>` and `aside=<aside>` inserted after it.

**Modify `src/cli/commands/serve.ts`.** Import `restore as restoreTeam, RestoreRefused` from `../../team/restore.ts`. Add `function restoreCommand(shell: Shell, argv: string[]): number`: `parseFlags(argv, { "to-schema": "value", yes: "flag" })`; a missing or non-integer `--to-schema` → `usage("restore needs --to-schema <n>")`; call `restoreTeam({ dir: shell.dir, toSchema, yes, now: Date.now })`, `out` each line, return 0; catch `RestoreRefused` → `err("wizardingcode-mem serve: restore refused: " + message)`, return 1; anything else → `exitFor`. Add `case "restore": return restoreCommand(shell, rest);` and the `USAGE` line `       restore --to-schema <n> [--yes]` after `purge name`.

`src/team/lease.ts` is not changed: the restore claims with `claimLease` and `releaseLease`, since `holdLease` throws where the restore needs to refuse with its own words, and its owner prefix is a closed union.

## Phase 5: the documents (AC-44, AC-40)

**Modify `tests/unit/team-runbook.test.ts`.** Add "the rollback is the restore command, and every named command comes before the start". `section` is the text from the line `### Rollback` to the next line starting `### `. Assert: it contains `docker compose run --rm server serve restore --to-schema`; it contains neither `cp /data/team.db` nor `rm -f /data/team.db-wal`; `section.indexOf` of `serve instance renew`, of `serve purge`, of `serve mirror --rebuild` and of `docker compose up -d server` are each found and strictly increasing; it contains `docker compose exec`, `docker compose restart caddy`, `unknown subcommand`, `team-before-rollback-`, `erased`, `no upgrade copy`, `new invitation` and `same team schema`. And the text from `### Before the first start, once` to the next `### ` contains `everyone who can push a tag or a branch`.

**Create `tests/unit/server-restore-docs.test.ts`**: `docs/adr/0031-team-server-restore.md` contains `D-1`, `serve restore`, `serve instance renew`, `serve mirror --rebuild`, `openTeamPresent`, `everyone who can push a tag or a branch` and `0026`; `docs/adr/0029-release-distribution.md` and `docs/adr/0026-team-server.md` each contain `pushed at build time`; ADR 0026's paragraph containing `a previous image exits 3` also contains `ADR 0031`; `CLAUDE.md` contains `src/team/restore.ts`, `openTeamPresent`, `openTeamCopy` and `openTeamStaging`, and does not contain `the three opens`.

Reds: `crew tdd red <id> AC-44 -- ./node_modules/.bin/bun test tests/unit/team-runbook.test.ts -t "the rollback is the restore command"`; `crew tdd red <id> AC-40 -- ./node_modules/.bin/bun test tests/unit/server-restore-docs.test.ts`.

**Modify `docs/runbooks/team-server.md`**: the image bullet and the Rollback section as `spec.md`'s "The runbook" says, point by point, in that order. The sentence on the other commands reads "then every other command the restore printed, in the order printed". Keep the paragraph on what a rollback across the 0.8.0 bump loses, rewritten around the restore's own list.

**Create `docs/adr/0031-team-server-restore.md`**, in English, in ADR 0030's form: status draft; context (piece 3 of ADR 0029's three, the first concept and why it was cut, the author's D-1, the script as the next item); decisions (`latest` by flavor, the two tests, who can still move it; `serve version`; the restore's checks and order, each with its reason; WAL set on the staging file and the probe that showed the need; the aside file by rename; the renewal by the older image and why detection cannot be relied on, which closes for a rollback the undetected case ADR 0026's D-13 names; the mirror's rebuild); alternatives rejected (the spec's); limits (two upgrade copies, aside files never pruned, a million changes, the tests standing in for a newer binary by a schema one above); what the reviews found, in one paragraph.

**Modify `docs/adr/0029-release-distribution.md`** (Limits: `latest` was pushed at build time by `release.yml`'s default flavor until ADR 0031). **Modify `docs/adr/0026-team-server.md`** (the sentence that says `latest` is no longer tagged by the job: pushed at build time until ADR 0031; the rollback paragraph ends "The procedure is `serve restore` (ADR 0031)."). **Modify `CLAUDE.md`**, the team server bullet: `db.ts` "is the schema, the six opens (…named…)"; the subcommands' list gains `version` and `restore`; one sentence: "`serve restore` (`src/team/restore.ts`, ADR 0031) puts back the copy an upgrade made: its checks run through the read-only opens, the present file is moved aside whole, and the commands it prints are run by the older image before the start". **Modify `docs/real-use/findings.md`**: one row for what is left (the script and timer; `latest` on an older commit; aside files never pruned).

## Verify

`bun run check`; `./node_modules/.bin/biome check src scripts tests npm`; `crew gate run <id>`.

---

Published by `crew learn` from item `2026-11-12-009-piece-3-of-updated-everywhere-on-release`, reviewed before the code (ADR 0019).
