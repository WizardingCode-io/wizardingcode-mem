# ui-ux findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-ui-ux
read: 16 images, 24 files, contract: none, audit: not captured

## Findings
- F-1 · advisory · ui/src/components/settings/Sharing.vue:213 · On Settings → Sharing, the projects line does not change its noun for one project: the problems and error captures read "1 projects share knowledge, 0 share knowledge and memories.", while the same page handles the singular for entries ("1 entry"). (settings-sharing-problems@1512.png, settings-sharing-error@1512.png)
- F-2 · advisory · src/settings/settings.ts:232 · The problems alert (Sharing.vue:184) shows the server's raw problem strings as written. Each starts in lower case, one names the variable `WIZARDINGCODE_MEM_SHARE_ROOTS`, and they are joined by a tight "·": "the environment's WIZARDINGCODE_MEM_SHARE_ROOTS names 1 more than the file; ignored · areas not in the taxonomy, ignored: workspace:legal". The second part repeats the inert-area row just below it. This is developer-voiced copy in a person-facing alert, not a raw error. (settings-sharing-problems@1512.png)
- F-3 · advisory · ui/src/components/settings/Sharing.vue:189 · In the locked state the Workspace knowledge count reads "1 entry" next to a switch that is off. The manifest's own observation explains why: a project at Knowledge and memories releases it under the workspace's areas. With round two's wording ("1 entry would leave"), a person reads that next to an off switch as a contradiction, and no sentence explains it. (settings-sharing-locked@1512.png)
- F-4 · advisory · ui/src/components/settings/Sharing.vue:196 · The suffix "in the area" is repeated on all 18 area rows in monospace, which makes the right edge noisy. One column label, or the bare number, would say the same once. The page otherwise passes the squint test: roots, then areas, then Save, then the statements. (settings-sharing-problems@1512.png)
- F-5 · advisory · ui/src/components/settings/Sharing.vue:158 · The error state's console has one `log:error`, "Failed to load resource: the server responded with a status of 500 (Internal Server Error) (http://127.0.0.1:4731/api/settings)". This is the browser logging the induced write failure that the declared error state reproduces, not an error in the page's code. The rubric counts any console error as a defect, so the judge should rule on it. The toast itself shows only the plain sentence. (console-settings-sharing-error.json, settings-sharing-error@1512.png)

What the round-two captures confirm, for the judge's question 1:
- AC-23's plain sentences are on screen:
  - the toast "Sharing not saved" with "The settings file could not be written." (settings-sharing-error@1512.png)
  - the paragraph "Sharing could not be loaded." (settings-sharing-load-error@1512.png)
  - the dock toast "Not changed" with "The level could not be saved." (projects-dock-not-changed@1512.png)
- The dock's radio list shows Nothing / Knowledge / Knowledge and memories in full at 320px (projects-dock-default@1512.png).
- Save is disabled with nothing changed and enabled after a switch moves (settings-sharing-problems@1512.png against settings-sharing-error@1512.png).
- The inert row with Remove is shown (settings-sharing-inert-area@1512.png).
- The Knowledge row pill appears only on the project above Nothing (projects-row-pill-knowledge@1512.png).
- In the code, the sharing toasts no longer use error.message (Sharing.vue:157-159, ProjectsView.vue:121).

## Outside the change
- ui/src/components/ProjectsView.vue:84 · The links "Not changed" toast still shows `error.message` as its description. It shares a title with the new sharing toast, which is now plain.
- ui/src/components/ProjectsView.vue:110 · The "Not linked" toast shows `error.message` as its description.

## Not answerable
- 2 States (stale captures) · Nine states were captured in round one, before round two's code. They show the old copy ("0 entries" with no "would leave", area counts as "7 entries" instead of "7 in the area"), the old Save button (enabled with nothing changed in default, empty-taxonomy and locked) and the old truncated segmented control ("Knowledge ..."). So they do not show the interface under review:
  - Settings → Sharing: default, confirm, success, empty-taxonomy, locked
  - the dock: confirm, success, no-remote, memory-off

  Most affected: the default state of the Sharing page, and the dock's two disabled sentences on the new radio group.
- 2 States · settings-sharing: loading, saving · the manifest's notCaptured: "transient states of under a second; the screenshot tool cannot be timed inside them".
- 3 Keyboard and focus · No `.aria.yml` accessibility snapshot and no focus-visible capture for settings-sharing or projects-dock.
- 4 Measured accessibility · No axe results in review/ui/.
- 6 Design contract · No DESIGN.md (the CLAUDE.md viewer paragraph was read as context only).
- 7 Responsive · Every capture is 1512 wide, dark only. The standard's 360, 768 and 1280 widths (and 320 for a page with a form) are not captured.
- 8 Motion against the standard · No motion samples and no reduced-motion pass. The design lint's inventory is empty and the spec says "no animation added", so there is nothing to sample.
- 10 Vitals · No vitals (CLS) recorded. The round-one console files note that messages from the page's first load were not tracked.
- audit · No audit/ folder.

Files read: the rubric (/Users/andreagroferreira/.claude/plugins/cache/wizardingcode-plugins/wizardingcode-developer-crew/0.21.0/skills/crew/rubrics/ui-ux.md), the manifest and the 16 captures and console files under /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/review/ui/, design-lint.json (no hits), the spec's viewer section, criteria AC-10 and AC-23, and /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/settings/Sharing.vue and /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/ui/src/components/ProjectsView.vue.
