# ui-ux findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-ui-ux
read: 16 images, 24 files (rubric, round-four findings, manifest, files.txt, design-lint.json, criteria-round-five.md by grep, the 16 console files, ProjectsView.vue:214-303, Sharing.vue and api.ts by grep), contract: none, audit: not captured

Scope: this item has one interface change, `knowledgeShown: number` on `CompactReport` at /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/api.ts:137. AC-25 (criteria-round-five.md:99) asks only that "the viewer's route carry the count". No screen draws it. Every other ui/ file in the diff belongs to sibling item 2026-11-09-002, and all sixteen captures are that item's evidence. Since round four (93af04f), no interface file changed: b54a579 and be1f6b7 touch only src/sharing/ and docs/. The captures, the consoles and the lint therefore read the same as in round four. Each finding says which item it belongs to.

## Findings
- F-1 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue:213 · [sibling 2026-11-09-002] On Settings → Sharing in the problems and error states, the projects line reads "1 projects share knowledge". "projects" has no singular form here, although the same page pluralises "entry/entries" correctly. (settings-sharing-problems@1512.png, settings-sharing-error@1512.png)
- F-2 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue:184 · [sibling 2026-11-09-002] The problems alert joins the server's strings with " · ". It begins in lowercase and reads like a log line, not a sentence in the viewer's voice: "the environment's WIZARDINGCODE_MEM_SHARE_ROOTS names 1 more than the file; ignored · areas not in the taxonomy, ignored: workspace:legal". Naming the variable is defensible on a page keyed by those names. (settings-sharing-problems@1512.png)
- F-3 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue:223 · [sibling 2026-11-09-002] In Across projects, the sharing-level pill ("Knowledge", "Knowledge and memories") is drawn in the LINKS column. Line 222 hides the "—" whenever the level is not local, so a project with no links but a sharing level reads as if the level were a link. (projects-row-pill-knowledge@1512.png, projects-dock-success@1512.png)
- F-4 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue:158 · [sibling 2026-11-09-002] In the error state the console holds one `log:error`: "Failed to load resource: the server responded with a status of 500 (Internal Server Error) (http://127.0.0.1:4731/api/settings)".
  - This is the browser's network log of the 500 the state was set up to provoke (a read-only data directory).
  - The page handles it with the plain toast "Sharing not saved / The settings file could not be written."
  - Question 10 makes any console error a defect. I file it as advisory because it is the deliberate failure of the state under test, not a fault of the page. The judge decides.
  (console-settings-sharing-error.json, settings-sharing-error@1512.png)
- F-5 · advisory · /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue:299 · [sibling 2026-11-09-002] In the dock's no-remote and memory-off states, the disabled radio list (`:disabled="sharingLocked || sharingBusy"`) looks almost the same as the enabled one. Only the reason paragraph below shows that the control is locked. (projects-dock-no-remote@1512.png, projects-dock-memory-off@1512.png)

What holds on the evidence:
- Every declared, captured state shows what its manifest note says:
  - settings: default, problems, inert-area, load-error, error, confirm, success, empty-taxonomy, locked
  - dock: default, not-changed, confirm, success, no-remote, memory-off
  - the row pill
- The dock's three level labels show in full at 320px.
- The error toasts are plain sentences, with no path and no raw error message.
- The other fifteen console files are empty.
- The design lint has no hits and an empty animation inventory, so the diff adds no motion.

## Outside the change
- /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Retention.vue:28 · [this item, debt] The compact preview lists turns, sessions and hook runs, but not the `knowledgeShown` count this item adds to `CompactReport` (ui/src/api.ts:137). A person previewing a compact is not told that shown-knowledge rows will be pruned. AC-25 asks only that the route carry the count, so this is not a criterion miss.

## Not answerable
- 1 (criterion in the capture), this item · No criterion of this item names a viewer page. The one interface change (`CompactReport.knowledgeShown`) is drawn by no screen and has no capture.
- 2 (states), sibling · The manifest's notCaptured lists settings-sharing `loading` and `saving`: "transient states of under a second; the screenshot tool cannot be timed inside them".
- 3 (keyboard and focus) · No `.aria.yml` accessibility snapshot and no `focus-visible` capture for any page.
- 4 (measured accessibility) · No axe files. Contrast is not measured.
- 6 (design contract) · No design contract: DESIGN.md is none.
- 7 (responsive) · Every capture is 1512 wide and dark only. There are none at 360, 768 or 1280, none in the light scheme, and none at 320 for the Sharing form or the projects table.
- 8 (motion against the standard) · No motion samples and no reduced-motion pass. The lint's inventory is empty, so the diff animates nothing.
- 10 (vitals) · No vitals recorded (CLS, INP, LCP).
- audit · No audit/ folder.
