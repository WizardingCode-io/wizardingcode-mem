# frontend lead's validation of 2026-11-11-005-share-a-project-without-a-git-remote-tod: delivery
verdict: validated
## Returns
none
## Notes
- Evidence is complete on the engine's files. review/ui/manifest.json:1-49 declares 23 states: 20 on /projects (manifest.json:7-28) and 3 on /settings#servers (manifest.json:35-37). Viewports are 1280, 768 and 360 (manifest.json:41-45), in dark and light (46-49). Motion is "none" (50), so no interaction of a thesis is owed a row or a reduced-motion pass. The 360-light glob returned all 23 states, and the report line you gave (16 of 16 expected, 7 extra) is consistent with the 23 declared states.
- The capture arithmetic holds: 23 states × 3 viewports × 2 schemes = 138, with a console file beside each. I confirmed the per-state files for 360-light only; I did not count all 138 files.
- Every capture row I read carries `by: "session"` (manifest.json:2, 68). The probe `probes/capture-005.ts` drives headless Chrome (DevTools protocol) against the real viewer and team-server routes, and manifest.json:3 describes that. I count this as the session's capture by the project's standing e2e skip (author's decision of 2026-11-09, report.md:60 and :292), not as a hand-made screenshot.
- Every state of the spec's capture line (spec.md:229) is declared. Round 2's one defect, the undeclared `exists` state, is declared (manifest.json:17) and captured. The `created`, `exists`, `removed`, `missing`, `recreated`, `purged`, `imported-stay` and `held` states are all present.
- I read two captures myself:
  - review/ui/projects-exists@360-light.png shows the "Join a shared name?" dialog at 360px. The title, question, Cancel and "Join and share" fit with no overflow. The Shared name field with its "Joins … created by Bruno" sentence and the four levels sit behind it.
  - review/ui/settings-held@768-dark.png shows the Servers card with the warn sentence "Shared names are held: the server speaks contract 1. Upgrade it first." and one line per name. The controls are all visible.
- Design lint review/design-lint.json:9-12 lists the three interface files, with skipped, hits, unresolved, inventory and disabled all empty.
- Ruling: review/ruling.json has the ui-ux gate `proven` on round 4. It carries eight advisories, none a defect, and all are deferred in docs/real-use/findings.md. The judge read the manifest and the default-state capture itself.
- Carried advisories, noted and not returned:
  - ui/src/api.ts:404: the browser logs "Failed to load resource: 409" once per capture of the created, exists and removed states. The status is the one spec.md:219 pins, and the dock shows the body's sentence.
  - ui/src/components/ProjectsView.vue:182: literal Markdown backticks in the New, Joins, taken, removed and created sentences, while the bound sentence uses `<code>`.
  - ProjectsView.vue:342: the dialog turns into "Join a shared name?" after a create without saying why.
  - ProjectsView.vue:536: "Set the level again" does not name the path that works.
  - ProjectsView.vue:542: in dark, the disabled Shared name field looks like the enabled one.
  - Servers.vue:283: name lines wrap to two or three lines at 360px, and a counts line starts with "·".
  - ProjectsView.vue:534: a read-only "Shared as" sentence stands where spec.md:208 describes a read-only field.
  - ProjectsView.vue:361: two strings reuse captured templates but no capture shows them.
- Design contract: there is no DESIGN.md, so the contract is the app pattern in CLAUDE.md (dark frame, 320px dock, compact type scale). The captures show the new fields inside the existing frame and dock. Nothing contradicts the pattern.
- I did not re-run the probe or re-read the 130-odd captures I did not open. The manifest, the console files and the ruling, which says the judge checked the state coverage, back this verdict.
