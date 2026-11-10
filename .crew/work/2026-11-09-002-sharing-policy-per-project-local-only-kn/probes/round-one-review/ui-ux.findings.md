# ui-ux findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-ui-ux
read: 11 images, 17 files, contract: none, audit: not captured

## Findings
- F-1 · defect · ui/src/components/ProjectsView.vue:295 · Projects dock, default and success states: the spec puts a segmented control "Nothing / Knowledge / Knowledge and memories" in the dock. The `truncate` class on equal-width buttons cuts the third label to "Knowledge …" at the dock's 320px. The two wider levels then read nearly alike, and the selected one cannot be read without hovering over its `title`. This is the session's own first observation. (projects-dock-default@1512.png, projects-dock-success@1512.png)
- F-2 · defect · ui/src/components/settings/Sharing.vue:150 · Settings → Sharing, error state: the toast "Sharing not saved" shows the raw system error, "EACCES: permission denied, open '/private/tmp/claude-501/…/scratchpad/capture/data/env.tmp'", with the full data-directory path. The standard says no raw error may reach the user. The spec's "with the server's message, as Backups does" asked for this, so the spec needs a plain sentence too. The same raw `error.message` pattern is at Sharing.vue:174 (load error) and ProjectsView.vue:138 and :150 (toast "Not changed"). (settings-sharing-error@1512.png, manifest observation 3)
- F-3 · defect · ui/src/components/settings/Sharing.vue:176 · States the diff makes reachable that the spec's state list does not declare (a gap in the spec), 5 in all, none captured. The problems alert (`UAlert`, line 176), the load-error paragraph (line 174), the inert-area row "<id> · not in the taxonomy; ignored" with its Remove button (lines 191–194; the design describes it in item 3 but the state list leaves it out), the dock's "Not changed" error toast (ProjectsView.vue:138/150), and the row pill at the "Knowledge" level (ProjectsView.vue:220; only "Knowledge and memories" was captured). (manifest.json "declared")
- F-4 · advisory · ui/src/components/settings/Sharing.vue:181 · Settings → Sharing, default and locked states: the number beside a root switch means "would leave under the policy", while the number beside each area means "entries in the area". Side by side they read as the same measure. In the default state, Workspace knowledge shows "0 entries" above Sales "7 entries". In the locked state, the Workspace switch is off yet shows "1 entry" (the session's observation 2). A short label for the root figure, such as "would leave", would remove the contradiction. (settings-sharing-default@1512.png, settings-sharing-locked@1512.png)
- F-5 · advisory · ui/src/components/settings/Sharing.vue:74 · Settings → Sharing, success state: a roots or areas change goes through untranslated. The last-change line reads "Last change: areas none → workspace:sales", showing the env file's tokens (`none`, `workspace:sales`). The same page names that area "Sales" under "Workspace knowledge", and the project branch already maps ids to names and labels. (settings-sharing-success@1512.png)
- F-6 · advisory · ui/src/components/ProjectsView.vue:220 · Across projects, success state: the level pill sits inside the LINKS cell and replaces its "—". It uses `--blue-soft` / `--blue-text`, the same tone as the "Uses" link relation (RELATION_TONE line 159). A project with no links but a level therefore shows a blue pill under the LINKS header, which reads as a kind of link. The spec said "after the links cell". (projects-dock-success@1512.png)
- F-7 · advisory · ui/src/components/settings/Sharing.vue:200 · Settings → Sharing: Save is enabled with nothing changed, because nothing tracks whether the switches differ from the policy. A click with no change writes the file and shows "Sharing saved". (settings-sharing-default@1512.png)

## Outside the change
- ui/src/components/ProjectsView.vue:232 · The "No links yet…" hint stays under the list in every capture, below a list that now also carries sharing levels. It is the existing component's text and is not wrong, only worth a look when that row is next touched.

## Not answerable
- 2 States: loading · "transient states of under a second; the screenshot tool cannot be timed inside them" (settings-sharing)
- 2 States: saving · same reason (settings-sharing); the dock's busy state (`sharingBusy`) was not declared either
- 3 Keyboard and focus · no accessibility snapshot and no focus-visible capture; "no keyboard pass was made". From the code: the controls are native buttons and Nuxt UI switches with labels, the segmented group has an aria-label and `aria-pressed`, and app.css:82 sets a global `:focus-visible` outline. None of this was observed.
- 4 Measured accessibility · no axe results in the evidence
- 6 Design contract · no DESIGN.md (the pattern in CLAUDE.md only)
- 7 Responsive · captures only "1512 pixels wide, dark theme"; no mandatory width below that and no light scheme
- 8/9 Motion · no motion samples and no reduced-motion pass; the design lint reports no animated declaration and the spec says "no animation added", so there is nothing to sample
- 10 Console of first load · "Tracking began after the page's first load, so messages of the load itself were not captured"; the eleven console files hold no message after load
- 10 Vitals · not measured
- 11 Audit · audit/ not captured
