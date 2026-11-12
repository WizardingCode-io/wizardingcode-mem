# The viewer tells of a newer release

## Problem

Since ADR 0030 the client learns once a day which release is the latest and keeps the answer in `<data dir>/update.json`. `status`, `doctor` and `update` say it in a terminal. The viewer says nothing: its About card shows only the version this viewer runs, and the setting that turns the daily check off, `WIZARDINGCODE_MEM_UPDATE`, is one of the two the README says have no field and are set by hand. A person who lives in the viewer is never told that a release is out, nor which command gets it on their channel.

## Design

Two decisions, the author's, on 2026-11-12:

- D-1: the notice is in Settings → About and in a dismissible banner at the top of the viewer.
- D-2: the viewer only reads what the daily check kept. It never asks the network, and it has no "check now" button; `wizardingcode-mem update` stays the way to ask at once.

The server (`src/ui/`):

- `GET /api/update` answers what `updateReport` (`src/update/report.ts`) builds from the data directory, in the viewer's shape: `running`, `staged`, `latest`, `checkedAt`, `failedAt`, `reason`, `mode` (`check`, `off`, `off-unknown`, `ci`), `out`, `line` (the report's first line without its `update: ` label), `agents` (its second line, or null), `commands` (one `{ channel, command, shell }` per channel when a release is out, none otherwise), `fromEnvironment` (whether the setting comes from the environment) and `banner` (whether the banner shows: a release is out and this release was not dismissed). The answer is built by `viewerUpdate` in a new `src/ui/update.ts`, which takes the report's builder as a seam, as `status` does: when the builder throws, the answer is 200 with the same shape, `line` saying why (`not checked: <the error's first line>`), `out` and `banner` false, `mode` `check`, the versions and times null and no commands. The page never loses the card for it.
- `POST /api/update/dismiss` keeps the latest release `update.json` names at that moment (read strictly, as `readState` does) in the store's `meta` under `update.dismissed`. The request's body is ignored. The banner stays away for that release and comes back for a later one. Dismissing with no release known keeps nothing.
- The viewer loads no code that asks for a release. Today `report.ts` imports the rule of the mode from `check.ts`, the one file that holds the request, so loading the report would load it. `mode` and `Mode` move to a leaf, `src/update/mode.ts`, which `report.ts`, `check.ts` and `src/cli/commands/update.ts` import; `check.ts` keeps no export of them. A new test in `tests/unit/update-boundary.test.ts` walks every file of `src/ui/` through its static and dynamic imports and fails when `src/update/check.ts` is reached.
- The setting is already a key of `PUT /api/settings` (`check or off`); nothing changes there.

The page (`ui/`):

- `ui/src/update.ts` holds the pure texts, which the tests load without a browser: the banner's line, the card's status and its tone, the list's mark. `ui/src/update-state.ts` holds the one load of `/api/update` per page load, shared by the banner, the card and the Settings list.
- `UpdateBanner.vue`, the page-level info banner the History and Links offers already are (Sales OS SystemStates SYS-060: 36 px, the width of main, blue-soft, a 16 px icon, one line that truncates, the actions on the right). It shows on every view while `banner` is true, above the two offers. Line: `wizardingcode-mem <latest> is out.` followed by who runs what (`The agents run <staged>.` or `This copy is <running>.`). Actions: `How to update`, which opens Settings → About, and `Dismiss`. At a phone's width the line is the release alone (`<latest> is out.`), so that the one fact is not cut beside the two actions.
- `About.vue` gains, above its links, a "Release" block: the status line with a tone (out, could not check, and a report that could not be built: the warning tone; latest, ahead: quiet; off, off with a value that is neither `check` nor `off`, not checked yet, not checked in CI: muted), the agents line when there is one, and, when a release is out, one row per channel with the channel's name, its command in the monospace face and a copy button for the three shell commands (the plugin's is an instruction, with no button). Under it the switch `Check for new releases once a day`, described as `After a session's memories are saved, github.com is asked which release is the latest. Nothing is downloaded.`, bound to `WIZARDINGCODE_MEM_UPDATE` (`check` or `off`) and disabled, with the usual note, when the environment sets it.
- The Settings list's About item carries the meta `new` in the warning tone while a release is out.

Screens:

screen: /settings#about · states: latest, out, off, off-env, unchecked, failed · viewports: 360, 768, 1280 · scheme: light, dark
screen: /memories · states: update-out · viewports: 360, 768, 1280 · scheme: light, dark
motion: none
design: none (the viewer follows the Sales OS pattern in `ui/src/app.css`; no `DESIGN.md` in this repository)

Alternatives rejected: a "check now" button (D-2: the viewer would start a network request of its own); the notice in About alone (D-1); a toast at page load (it goes away by itself, and a person who was not looking never sees it).

## Acceptance criteria

The tests start the viewer with an environment and a clock of their own (`startUi`'s `env` and `now`): the suite's preload turns the check off, and a runner sets `CI`.

- AC-8: `GET /api/update` answers the report in the viewer's shape for each state: a release out (the four channels' commands, `banner` true); the running version the latest; the check off in the file; the check off by the environment (`fromEnvironment` true); a value that is neither `check` nor `off` (`off-unknown`); `CI` set (`ci`); not checked yet; a last check that failed. A staged binary of another version gives the `agents` line (that case needs an executable under `<data dir>/bin`: skipped on Windows, and not run as root, as the report's own test). A builder that throws gives 200 with the shape, `line` saying why, `out` and `banner` false and no commands.
- AC-9: `POST /api/update/dismiss` keeps the release dismissed: `banner` is false for it afterwards and true again when `update.json` names a later release; with no release known it keeps nothing (no `update.dismissed` in `meta`); a body that names another version changes nothing of that.
- AC-10: No file of `src/ui/` reaches `src/update/check.ts` through static or dynamic imports, at any depth. And with a check due (no `update.json`, an environment with neither `WIZARDINGCODE_MEM_UPDATE` nor `CI`), answering `GET /api/update` and `POST /api/update/dismiss` makes no request to any host but the viewer's own loopback address, counted by a wrapped `fetch`.
- AC-11: The banner's line, the card's status and tone and the Settings list's mark, as `ui/src/update.ts` writes them, for each state: out with a staged copy, out with none, latest, ahead, off, off by the environment, off-unknown, not checked in CI, not checked yet, could not check, and a report that could not be built. The About card, the banner over the memories view and the marked list show them at the three widths in both schemes (the screens above).
- AC-12: The switch's two values go through `PUT /api/settings`: `WIZARDINGCODE_MEM_UPDATE=off` and `=check` are written to the env file, and `GET /api/update` then says the mode it was set to.
- AC-13: The README says in neither of its two places (the settings paragraph and the settings table) that `WIZARDINGCODE_MEM_UPDATE` is set by hand, and says where the viewer tells of a release; `CLAUDE.md` names the two routes and the files; in `docs/real-use/findings.md` the row of the missing About line and Settings field says that part is answered, its other remark kept.
- AC-14 (preserve): `tests/integration/ui.test.ts`, `tests/integration/ui-settings.test.ts` and the tests `tests/unit/update-boundary.test.ts` holds today pass as before.

What no test or capture holds: the clicks of `How to update`, `Dismiss` and the copy buttons in a browser. The routes behind them are tested; the buttons are read in the captures and in the review.

## Risks

`GET /api/update` runs the staged binary's `--version` once per page load, under the guards ADR 0030 gave it (never as root, never from another user's folder). The viewer already runs as the person.

Rollback: remove the two routes, the banner and the block.

## Out of scope

- Asking the network from the viewer (D-2), and replacing the binary from it.
- A field for `WIZARDINGCODE_MEM_AUTHOR`, the other setting with none.
- The team server's upgrader (piece 3 of ADR 0029).
