# ui-ux findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-ui-ux
read: 16 images, 11 files, contract: none, audit: not captured

## Findings
- F-1 · defect · ui/src/components/settings/Backups.vue:115 · Settings → Backups, restore success: the diff adds a reachable branch to the restore toast (" Sharing levels were reset to Nothing (<n> projects); set them again." when `sharingReset > 0`). The spec mentions it only in its restore section. It has no entry in the viewer's state list (spec lines 279–280) and no row or capture in the manifest, so this changed branch is undeclared and unseen. The same wording also reads "(1 projects)" when n is 1. (review/ui/manifest.json: no backups row)
- F-2 · advisory · ui/src/components/settings/Sharing.vue:213 · Settings → Sharing, problems/error state: the projects line reads "1 projects share knowledge, 0 share knowledge and memories." The noun is never made singular, while the CLI's status and doctor lines do make it singular. (settings-sharing-problems@1512.png, settings-sharing-error@1512.png)
- F-3 · advisory · ui/src/components/settings/Sharing.vue:184 · Settings → Sharing, problems state: the warning alert shows the loader's problem strings as they are. They start in lower case and name the environment variable (`the environment's WIZARDINGCODE_MEM_SHARE_ROOTS names 1 more than the file; ignored · areas not in the taxonomy, ignored: workspace:legal`), which reads as a doctor/CLI line rather than the page's sentence voice. This is not a raw error or path, and the spec asks for the problems joined by " · ". (settings-sharing-problems@1512.png)
- F-4 · advisory · ui/src/components/ProjectsView.vue:223 · Across projects, row pill: the sharing pill is drawn inside the links cell, under the "LINKS" column header ("Knowledge", "Knowledge and memories"), and it replaces the "—". The spec says "after the links cell". A row with links would show the link text and the sharing level in one cell under a heading that names only links. (projects-row-pill-knowledge@1512.png, projects-dock-success@1512.png)
- F-5 · advisory · ui/src/components/settings/Sharing.vue:164 · Settings → Sharing, error state: the console holds one `log:error`, "Failed to load resource: the server responded with a status of 500 (Internal Server Error) (/api/settings)". This is Chrome's network log of the deliberately caused write failure (read-only data directory), not an exception from the page. The page itself shows only the plain toast. Read literally, question 10 makes any console error a defect, so the judge should rule whether an injected failure's own network log counts. The other 15 console files are empty. (console-settings-sharing-error.json)

## Outside the change
- ui/src/components/ProjectsView.vue:84 · The links decision toast "Not changed" still shows `error.message` as its description. This is older code than the sharing dock, which now uses a plain sentence for its own "Not changed" toast (line 121); debt.

## Not answerable
- 2 States (settings-sharing loading, saving) · notCaptured: "transient states of under a second; the screenshot tool cannot be timed inside them" (declared, listed as missing)
- 3 Keyboard and focus · no accessibility snapshot (.aria.yml) and no focus-visible capture for any page; from source only: the dock's radio group has a legend ("What this project shares", sr-only) and the switches carry labels, but focus order and the visible ring are not shown
- 4 Measured accessibility · no axe files; the contrast of the 12px `--ink-muted` help and statement text on the dark surface cannot be measured from the captures
- 6 The design contract · no design contract (no DESIGN.md; CLAUDE.md's viewer paragraph is followed visually: 40px top bar, 56px rail, 216px settings sidebar, 32px rows, 320px dock)
- 7 Responsive · every capture is 1512 wide, dark only; the standard's 360, 768, 1280 (and 320 for the form and table) were not captured
- 8 Motion against the standard · no motion samples and no reduced-motion pass. The design lint's inventory is empty (no animated declaration in the four files), and the spec says "no animation added", so nothing is owed here
- 10 Vitals · no vitals recorded (CLS, INP, LCP)
- 11 Audit · no audit/ folder

Read against the criteria, the captures show AC-10 and AC-23 in place:
- The Sharing page replaces Collaboration, with no soon mark.
- The dock's three labels show in full as a radio list at 320px.
- Save is dimmed while nothing has changed (default, success, locked and empty-taxonomy) and bright in the error capture, where a change is pending.
- The three plain failure sentences appear: "Sharing not saved / The settings file could not be written.", "Sharing could not be loaded.", "Not changed / The level could not be saved.".
- The five added states are captured with a manifest row each: problems, load-error, inert-area with Remove, not-changed and row-pill-knowledge.
- The disabled sentences appear for the no-remote and memory-off projects.
