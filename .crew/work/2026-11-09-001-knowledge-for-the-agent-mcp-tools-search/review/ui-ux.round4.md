# ui-ux findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-ui-ux
read: 16 images, 26 files (rubric, standard, manifest, files.txt, design-lint.json, criteria-round-four.md, spec.md by grep, the diff's ui/ hunks, ui/src/components/settings/Retention.vue, the 16 console files), contract: none, audit: not captured

Scope: this item's only interface change is the added `knowledgeShown: number` on `CompactReport` in ui/src/api.ts:137 (AC-25, "the viewer's route carry the count"). No screen draws it, so it has no capture. Every other ui/ file in the diff (ProjectsView.vue, Settings.vue, settings/Backups.vue, settings/Sharing.vue, settings/Team.vue deleted, api.ts's sharing types, settings.ts) belongs to sibling item 2026-11-09-002, and all sixteen captures are that item's evidence. Each finding says which item it belongs to.

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue:213 · [sibling 2026-11-09-002] On the Settings → Sharing page in the problems state, the projects line reads "1 projects share knowledge" because "projects" is hard-coded with no singular. The same file pluralises "entry/entries" correctly at its `entries` helper. (settings-sharing-problems@1512.png, settings-sharing-error@1512.png)
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue:184 · [sibling 2026-11-09-002] The problems alert joins the server's problem strings with " · ". It starts lowercase and names the raw variable: "the environment's WIZARDINGCODE_MEM_SHARE_ROOTS names 1 more than the file; ignored · areas not in the taxonomy, ignored: workspace:legal". It reads as a log line rather than a sentence in the viewer's voice. The variable name is defensible on a settings page keyed by those names. (settings-sharing-problems@1512.png)
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue:223 · [sibling 2026-11-09-002] In Across projects, the project's sharing level pill ("Knowledge", "Knowledge and memories") is drawn in the LINKS column, under a "Links" header. The `—` placeholder is hidden whenever the pill shows (line 222), so a project with no links and a sharing level reads as if the level were a link. (projects-row-pill-knowledge@1512.png, projects-dock-success@1512.png)
- F-4 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue:217 · [sibling 2026-11-09-002] In the error state, the console holds one `log:error`: "Failed to load resource: the server responded with a status of 500 (Internal Server Error) (http://127.0.0.1:4731/api/settings)". This is the browser's own network log of the 500 that the state was set up to provoke (the data directory made read-only). The page handles it with the plain toast "Sharing not saved / The settings file could not be written." The rubric's question 10 makes any console error a defect. I file it as advisory because it is the deliberate failure of the state under test, not a fault of the page; the judge decides. The line is approximate: the `notSaved` toast near the `commit` function. (console-settings-sharing-error.json, settings-sharing-error@1512.png)
- F-5 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue:357 · [sibling 2026-11-09-002] In the dock's no-remote and memory-off states, the disabled radio list looks almost the same as the enabled one. Only the reason paragraph shows that the control is locked. The line is approximate: the `URadioGroup` `:disabled` binding. (projects-dock-no-remote@1512.png, projects-dock-memory-off@1512.png)

What holds on the evidence:
- All sibling states the manifest declares and captured show what their notes say: default, problems, inert-area, load-error, error, confirm, success, empty-taxonomy, locked; the dock's default, not-changed, confirm, success, no-remote and memory-off; the row pill.
- The dock's three level labels show in full at 320px.
- The error toasts are plain sentences, with no path and no error message.
- The other fifteen console files are empty.
- The design lint has no hits and an empty animation inventory, so the diff adds no motion.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Retention.vue:28 · [this item, debt] The compact preview's summary lists turns, sessions and hook runs, but not the new `knowledgeShown` count that this item adds to `CompactReport` (ui/src/api.ts:137). The person previewing a compact is not told that shown-knowledge rows will be pruned. AC-25 asks only for the route to carry the count, so this is not a criterion miss.

## Not answerable
- 1 (criterion in the capture), this item · No criterion of this item names a viewer page, and no capture shows the one interface change (`CompactReport.knowledgeShown`). Nothing on screen draws it.
- 2 (states), sibling · The manifest's notCaptured lists settings-sharing `loading` and `saving`: "transient states of under a second; the screenshot tool cannot be timed inside them".
- 3 (keyboard and focus) · No `.aria.yml` accessibility snapshot and no `focus-visible` capture for any page.
- 4 (measured accessibility) · No axe files. Contrast is not measured.
- 6 (design contract) · No design contract: DESIGN.md is none.
- 7 (responsive) · Every capture is 1512 wide and dark only. There are none at the standard's 360, 768 and 1280, and none at 320 for the Sharing page's form or the projects table.
- 8 (motion against the standard) · No motion samples and no reduced-motion pass. The lint's inventory is empty, so the diff animates nothing.
- 10 (vitals) · No vitals recorded (CLS, INP, LCP).
- audit · No audit/ folder.
