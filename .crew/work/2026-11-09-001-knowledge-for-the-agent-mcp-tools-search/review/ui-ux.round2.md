# ui-ux findings for 2026-11-09-001-knowledge-for-the-agent-mcp-tools-search
reviewer: review-ui-ux
read: 16 images, 9 files, contract: none, audit: not captured

Scope: none of this item's criteria (AC-1, AC-9, AC-18 to AC-29, AC-31) names a viewer page. The spec puts the viewer's Knowledge views in part 3 (spec.md:32). AC-25's "the viewer's route carry the count" is a server route (src/ui/api.ts), not a page. Every interface file in the diff is the sibling sharing item's (2026-11-09-002): ui/src/api.ts, ProjectsView.vue, Settings.vue, settings/Backups.vue, settings/Sharing.vue (new), settings/Team.vue (deleted) and ui/src/settings.ts. So every finding below is on the sibling's pages, and none is a defect of this item. The design lint has no hits and no animated declarations; Team.vue was skipped because it is deleted. Fifteen of the sixteen console files are empty. The captures match the round-two fixes the manifest claims: the dock's level control is a radio list with all three labels in full, and the error toasts show a plain sentence.

## Findings
- F-1 · advisory · ui/src/components/settings/Sharing.vue:158 · Sibling's page, settings-sharing error state. The console has one error, "Failed to load resource: … 500 (Internal Server Error) (/api/settings)". It is the browser logging the write failure the capture caused on purpose (read-only data directory). The user sees only the toast "Sharing not saved / The settings file could not be written." Read literally, question 10 makes this a defect; the judge rules whether a failure the capture caused counts, as in round one. (console-settings-sharing-error.json, settings-sharing-error@1512.png)
- F-2 · advisory · src/settings/settings.ts:232 · Sibling's page, settings-sharing problems and error states. The warning alert is built at Sharing.vue:184 by joining with " · ". Problems:
  - it starts in lowercase;
  - it names the raw variable WIZARDINGCODE_MEM_SHARE_ROOTS ("names 1 more than the file; ignored");
  - it joins a second fragment from src/sharing/policy.ts:100 ("areas not in the taxonomy, ignored: workspace:legal") that is also shown in its own row (Sharing.vue:200), so the inert area is said twice.

  It reads as a log line, not the page's voice. (settings-sharing-problems@1512.png, settings-sharing-error@1512.png)
- F-3 · advisory · ui/src/components/settings/Sharing.vue:213 · Sibling's page, settings-sharing problems state. The line reads "1 projects share knowledge": the noun does not change for a count of one. The same pattern is at ui/src/components/settings/Backups.vue:115 ("Sharing levels were reset to Nothing (1 projects)"); no capture shows that restore toast, so it is cited from the diff. (settings-sharing-problems@1512.png, diff.patch)
- F-4 · advisory · ui/src/components/settings/Sharing.vue:196 · Sibling's page, settings-sharing confirm and success states. The Sales row under "Workspace knowledge" reads "7 in the area", but with only Sales on, the dialog says "6 knowledge entries would leave" and the root then reads "6 entries would leave". The area total seems to count something beyond the root's own entries (perhaps the remote project's sales entry). Nothing on the page explains the gap of one. (settings-sharing-confirm@1512.png, settings-sharing-success@1512.png)
- F-5 · advisory · ui/src/components/settings/Sharing.vue:216 · Sibling's page, settings-sharing success and locked states. The last-change line shows raw ids and the log's wording: "Last change: areas none → workspace:sales, just now, from the viewer." Both the policy's "none" and the "root:area" id are used where the page elsewhere uses labels (Sales, Workspace knowledge). (settings-sharing-success@1512.png, settings-sharing-locked@1512.png)
- F-6 · advisory · ui/src/components/ProjectsView.vue:224 · Sibling's page, projects list, row-pill-knowledge and dock states. The sharing-level pill ("Knowledge", "Knowledge and memories") is drawn in the cell headed LINKS. When a level is set, the "—" is hidden (line 223). So a row with no links shows no link state, and the sharing state sits under a heading that does not name it. (projects-row-pill-knowledge@1512.png, projects-dock-success@1512.png)
- F-7 · advisory · ui/src/components/settings/Sharing.vue:195 · Sibling's page, settings-sharing default state. The off switches of the 18 area rows and both roots are near-black tracks on the dark card and barely visible. With no axe file, their contrast against the standard's 3:1 for interface components cannot be measured. The styling is Nuxt UI's switch, not a new token. (settings-sharing-default@1512.png)
- F-8 · advisory · ui/src/components/ProjectsView.vue:182 · Sibling's pages, settings-sharing success and error, projects-dock success and not-changed. The toast sits bottom left, over the sidebar's footer note and the rail's settings icon. In not-changed it is cut at the bottom edge. This is the app's existing toaster position and reads in context. (settings-sharing-success@1512.png, projects-dock-not-changed@1512.png)
- F-9 · advisory · ui/src/components/Settings.vue:68 · Sibling's change. removed: the "Collaboration" settings page (Team.vue, marked "soon") and its `#settings/team` link target. A saved `#settings/team` link now falls back to Agents. This is an intended replacement by Sharing, noted only because a removal is read. (diff.patch, settings-sharing-default@1512.png)

## Outside the change
none

## Not answerable
- 1 The criterion in the capture · no criterion of this item names a viewer page. What the agent is shown is hook output text, pinned by tests/unit/knowledge-module.test.ts and tests/unit/hook-snapshots.test.ts, not by captures.
- 2 States · settings-sharing loading and saving are under notCaptured ("transient states of under a second; the screenshot tool cannot be timed inside them"). projects-dock no-remote and memory-off are captured but not in `declared`. The spec declares no page states for this item.
- 3 Keyboard and focus · no accessibility snapshot (.aria.yml) and no focus-visible capture for any page.
- 4 Measured accessibility · no axe files for any page.
- 6 The design contract · no DESIGN.md (no design contract).
- 7 Responsive · only width 1512 and the dark scheme were captured; no mandatory narrow widths and no light scheme.
- 8 Motion against the standard · no motion samples and no reduced-motion pass. The lint inventory is empty, so the diff animates nothing.
- 9 Motion against the thesis · the spec has no motion thesis, and this item changes no interface file.
- 10 Vitals · no vitals (CLS, INP, LCP) in the evidence.
- audit · no audit/.

Evidence folder: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-001-knowledge-for-the-agent-mcp-tools-search/review/ui/
