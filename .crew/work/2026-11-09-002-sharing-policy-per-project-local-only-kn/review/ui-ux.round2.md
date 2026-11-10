# ui-ux findings for 2026-11-09-002-sharing-policy-per-project-local-only-kn
reviewer: review-ui-ux
read: 16 images, 26 files, contract: none, audit: not captured

## Findings
- F-1 · advisory · ui/src/components/settings/Sharing.vue:213 · Settings → Sharing, problems state: the projects line has no singular form and reads "1 projects share knowledge, 0 share knowledge and memories.", although the page's own `entries()` helper (line 37) already handles the singular for entries (settings-sharing-problems@1512.png)
- F-2 · advisory · src/settings/settings.ts:232 · Settings → Sharing, problems state: the warning alert shows the loader's raw problem strings joined by " · ". The text starts in lower case and quotes the variable name ("the environment's WIZARDINGCODE_MEM_SHARE_ROOTS names 1 more than the file; ignored · areas not in the taxonomy, ignored: workspace:legal"). The spec allows it (problems joined by " · ") and it is not an error message or a path, but it reads as developer text next to the page's plain sentences (settings-sharing-problems@1512.png)
- F-3 · advisory · ui/src/components/ProjectsView.vue:223 · Across projects, row pill at Knowledge: the spec places the level pill after the links cell, but the code puts it inside the links cell and hides that cell's "—" (line 222). On a project with no links, a blue "Knowledge" / "Knowledge and memories" pill then sits alone under the LINKS header and can be read as a kind of link (projects-row-pill-knowledge@1512.png, projects-dock-success@1512.png)
- F-4 · advisory · ui/src/components/settings/Sharing.vue:158 · Settings → Sharing, error state: the console holds one `log:error`, Chrome's own "Failed to load resource: … 500 … /api/settings" for the write failure the session caused on purpose (a read-only data directory). The page logs nothing itself and shows only the plain toast. Read literally, the rubric counts any console error as a defect, so the judge should rule on this one (console-settings-sharing-error.json, settings-sharing-error@1512.png)
- F-5 · advisory · ui/src/components/settings/Sharing.vue:189 · Settings → Sharing, locked state: the manifest's `observations` says the Workspace count reads "1 entry" with the switch off, but the retaken capture shows "0 entries would leave" under both roots and "0 projects share knowledge". The note describes the first-round seed, not the code under review, and the capture agrees with the policy (settings-sharing-locked@1512.png, manifest.json)

Checked against AC-10 and AC-23 with no defect found:
- The Sharing page replaces the Collaboration card, with no soon mark, the design's texts and the new nav footer (settings-sharing-default@1512.png).
- The dock's Sharing section is a radio list of three 32px rows (`item: 'h-8'`), each label shown in full at 320px with no `truncate`, and the two disabled sentences show (projects-dock-default, projects-dock-no-remote, projects-dock-memory-off).
- The row pill shows only above Nothing (projects-row-pill-knowledge).
- The plain sentences are in place: "Sharing not saved" / "The settings file could not be written.", "Sharing could not be loaded.", "Not changed" / "The level could not be saved.". Neither toast shows an error message or a path (settings-sharing-error, settings-sharing-load-error, projects-dock-not-changed).
- Save looks dimmed while nothing has changed (default, problems, success, locked, empty-taxonomy) and fully lit after a switch moves (error).
- The five added states are declared and captured.
- 15 of the 16 console files hold no messages (F-4 is the exception), and the design lint has no hits and no animated declarations.

## Outside the change
none

## Not answerable
- 2. States (loading, saving on settings-sharing) · declared, listed under `notCaptured`: "transient states of under a second; the screenshot tool cannot be timed inside them"
- 3. Keyboard and focus · no accessibility snapshot (`.aria.yml`) and no `focus-visible` capture for settings-sharing or projects-dock. From the source, every control is a USwitch, URadioGroup (with an sr-only legend, "What this project shares"), UButton or native button, but focus order and visibility are not evidenced.
- 4. Measured accessibility · no axe files for any page
- 6. The design contract · no design contract (no DESIGN.md). CLAUDE.md's viewer conventions were read as context only: the dock is 320px, its rows 32px, the colours are `--ink`/`--ink-muted`/`--blue-soft` tokens, and no raw colour was added in the diff's interface lines.
- 7. Responsive · only 1512-wide captures. 360, 768 and 1280 are not captured for either changed page, nor 320 for the settings form and the projects table.
- 8. Motion against the standard · no motion samples and no reduced-motion pass. The design lint's inventory is empty and the spec says "no animation added", so nothing was there to sample.
- 10. Console and vitals · no vitals (CLS, INP, LCP) recorded
- audit · no audit/ folder

Evidence folder: /Users/andreagroferreira/AIProjects/ai-mem/.crew/worktrees/ai-mem-2026-11-08-001-j-knowledge-base-and-team-collab/.crew/work/2026-11-09-002-sharing-policy-per-project-local-only-kn/review/ui/
