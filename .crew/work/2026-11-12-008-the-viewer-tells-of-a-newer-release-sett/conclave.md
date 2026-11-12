# Gap round

Checklists read: `endpoint` and `screen`.

## Assumed by good practice

- The two routes sit behind the viewer's token like every `/api/` route, on the loopback address only; `GET /api/update` reads and `POST /api/update/dismiss` writes one `meta` key. Neither takes input beyond the method. AC-8, AC-9.
- An error is the project's shape: a report that cannot be built is said in the card's own line, never a stack. AC-8.
- The link the banner names, Settings → About, exists (`Settings.vue`'s `about` page). The four channels' commands are the ones `src/update/channels.ts` holds, which `tests/unit/update-docs.test.ts` already ties to the README. AC-8, AC-11.
- No field is exposed that the terminal does not already print: versions, times, the path of the staged binary inside a line, the commands. No personal data.
- Every state the card and the banner reach is enumerated on AC-11 and captured at 360, 768 and 1280 in both schemes, with the console file beside each capture; the switch is a labelled control, keyboard-operable, and the copy buttons have names. No animation is added, so no reduced-motion branch is owed.
- The copy is English, as the viewer's is. The page makes one call more per load, `/api/update`, shared by the banner, the card and the list.
- The viewer asks the network nothing: held by a boundary test and by a count of `fetch` calls. AC-10.

## Decisions only the user can make

- D-1, the author's: About and a dismissible banner at the top.
- D-2, the author's: the viewer only reads `update.json`; no "check now".
- No focal motion: the screen checklist's question has "none" for its answer, the conservative one, and nothing animated is added.

## Proposals

none

## Warnings

- The banner is on every view until dismissed, above the History and Links offers on the memories view: three banners can stack on a first run. Advisory: the offers show once each, and the release banner is one line.
- `GET /api/update` runs the staged binary's `--version` at each page load. Advisory: guarded as ADR 0030 says, and the same call `status` makes.
