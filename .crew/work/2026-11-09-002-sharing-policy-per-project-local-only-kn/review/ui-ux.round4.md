# ui-ux findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-ui-ux
read: 16 images, 11 files, contract: none, audit: not captured

## Findings
- F-1 · defect · ui/src/components/settings/Backups.vue:115 · Restoring a backup reaches a branch the diff adds: the "Restored" toast now ends with "Sharing levels were reset to Nothing (<n> projects); set them again." The spec describes this sentence (spec.md:305), but the page's state list (spec.md:279–280) does not declare it, the manifest's `declared` list does not name it and `notCaptured` does not list it, and no capture shows it. It is a reachable branch with no state and no evidence. (review/ui/manifest.json)
- F-2 · advisory · .crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/review/ui/console-settings-sharing-error.json · The console file of the Sharing page's error state holds one `log:error`: "Failed to load resource: the server responded with a status of 500 (Internal Server Error) (…/api/settings)". This is Chrome's resource log of the 500 the session produced by making the data directory read-only, which is the failure the declared error state needs. It is not an exception or a log from page code. The other 15 console files are empty. I read it as advisory, but rubric question 10 counts any console error, so the judge should rule on it. (console-settings-sharing-error.json)
- F-3 · advisory · ui/src/components/settings/Sharing.vue:213 · Copy, problems state: the projects line reads "1 projects share knowledge, 0 share knowledge and memories." The noun is plural for a count of one. The line follows the spec's template, which has no singular. The restore toast at ui/src/components/settings/Backups.vue:115 has the same "(1 projects)" form. (settings-sharing-problems@1512.png)
- F-4 · advisory · ui/src/components/settings/Sharing.vue:184 · Copy, problems state: the warning alert shows the loader's problems as they come. It starts in lower case, names the raw key "WIZARDINGCODE_MEM_SHARE_ROOTS" and runs two problems together with " · " ("…names 1 more than the file; ignored · areas not in the taxonomy, ignored: workspace:legal"). The text is in English and plain, but it reads as developer text next to the page's sentences. (settings-sharing-problems@1512.png, settings-sharing-error@1512.png)
- F-5 · advisory · ui/src/components/ProjectsView.vue:222-223 · Across projects: the sharing pill is drawn inside the cell headed "LINKS", and it hides that cell's "—". So a project with no link but a sharing level shows "Knowledge" or "Knowledge and memories" where a link's relation would appear. The spec says the pill goes "after the links cell", and the column has no heading of its own. (projects-row-pill-knowledge@1512.png, projects-dock-success@1512.png)

What the captures confirm against AC-10 and AC-23:
- The Sharing page sits under App in the Settings nav, with no soon mark, and the nav footer has the new sentence.
- The page's texts match the design. The default state shows 0 counts and the projects line with zeros, and Save looks disabled in the default, locked and post-save captures (dimmed; no accessibility snapshot to read the disabled state).
- The confirm dialog shows the preview's count, and "Sharing saved" appears with the last-change line.
- The locked state shows "Set by the environment." with the root switches disabled.
- The empty taxonomy shows "No taxonomy yet: write a knowledge entry first."
- The inert row reads "workspace:legal · not in the taxonomy; ignored" with Remove.
- The load error shows only "Sharing could not be loaded."
- The error toast reads "Sharing not saved" / "The settings file could not be written."
- In the dock, the three labels are shown in full in a vertical radio list at 320px, with the two disabled sentences, the confirm dialog, the "Sharing changed" toast naming the old and new labels, and the "Not changed" toast with "The level could not be saved."
- The row pill appears only above Nothing.
- The design lint has 0 hits and an empty animation inventory, which matches the spec's "no animation added".

## Outside the change
- ui/src/components/ProjectsView.vue:110 · The existing "Not linked" toast shows `error.message` to the user. This is the pattern this item removed from its own toasts. (debt)

## Not answerable
- 2 (states) · settings-sharing `loading` and `saving`: in the manifest's words, "transient states of under a second; the screenshot tool cannot be timed inside them" (listed under notCaptured).
- 3 (keyboard and focus) · no page has an accessibility snapshot (`.aria.yml`) and there is no `focus-visible` capture.
- 4 (measured accessibility) · there are no axe results for any page.
- 6 (design contract) · no DESIGN.md. The CLAUDE.md conventions are matched as far as the captures show: dark frame, 56px rail, 216px settings sidebar, 32px dock radio rows, 320px dock.
- 7 (responsive) · only 1512 wide in the dark scheme was captured. The standard's 360, 768 and 1280 (and 320 for a page with a form or table), and the light scheme the viewer offers, have no capture.
- 8 (motion against the standard) · no motion samples and no reduced-motion pass. The lint inventory is empty, so no animated declaration is at stake.
- 10 (vitals) · no CLS, INP or LCP figures were captured.
- audit · no audit/ folder.
