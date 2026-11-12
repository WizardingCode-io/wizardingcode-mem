# ui-ux findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-ui-ux
read: 5 images (projects-new@1280-dark, projects-created@360-dark, projects-named@360-dark, settings-names@360-dark, projects-exists@1280-dark), 6 files (the rubric, ui-ux.round3.md, the console files by grep, manifest.json by grep, the evidence folder listing), contract: none, audit: not captured

I did not re-read all 138 captures. The dock code and the probe are unchanged since round 3, and the five captures I read match round 3's reading. The `/projects` states `new`, `created`, `named` and `exists`, and `/settings#servers` (`settings-names`), still show what AC-43 and the spec describe.

- **Round 3's fixes:** the dialogs and the created, taken, joins, bound and exists sentences are as round 3 left them. The two-phase bind change in `src/ui/api.ts` adds nothing visible. The "Memory is off … was created on the server" warning is correct for the Nothing level (projects-created@360-dark.png). The Servers page shows its name lines with counts (settings-names@360-dark.png).
- **Console:** the only logged lines are "Failed to load resource … 409". They appear in 21 console files, all of them `created`, `exists` or `removed` (12 per merged file, 1 per capture file). I found no other error or warning (grep of console-*.json).
- **Round 3's open advisories:** they still hold.
  - Backtick slugs show as literal Markdown in `projects-new@1280-dark.png`: "New: you create `docs-mobile` on …". F-3 below is that carried advisory.
  - The `created` sentence uses the same "set the level again" wording as before.

## Findings
- F-1 · advisory · ui/src/api.ts:404 · /projects `created`, `exists` and `removed`: each capture logs one browser line, "Failed to load resource … 409", from PUT /api/projects/<id>/sharing. It is the status the spec pins (spec.md:219). The dock shows the refusal as a sentence, so no raw error reaches the user. Unchanged from round 3. (console-projects-exists.json, console-projects-created.json, console-projects-removed.json)
- F-2 · advisory · ui/src/components/ProjectsView.vue:342 · /projects `exists`: after "Create and share", the dialog quietly becomes "Join a shared name?". Nothing says the create was refused because a teammate created the name a moment ago. One clause would explain the switch. (projects-exists@1280-dark.png)
- F-3 · advisory · ui/src/components/ProjectsView.vue:182 · The New, Joins, taken, removed and created sentences and both confirmation questions (lines 184 and 311) show the slug in literal Markdown backticks. The bound sentence shows it in `<code class="wz-mono">`, so the two styles are inconsistent. (projects-new@1280-dark.png, projects-exists@1280-dark.png against projects-named@360-dark.png)
- F-4 · advisory · ui/src/components/ProjectsView.vue:536 · /projects `missing`, `recreated` and `created`: "set the level again" does not name the path that works, which is Nothing first and then a level. The wording is the spec's and the route's. (projects-created@360-dark.png)
- F-5 · advisory · ui/src/components/ProjectsView.vue:542 · /projects `held`: in the dark scheme the disabled "Shared name" field looks like the enabled one. Only the warn sentence and the dimmed radios show the held state. Carried from round 3. (projects-held@1280-dark.png, read in round 3, not re-read)
- F-6 · advisory · ui/src/components/settings/Servers.vue:283 · /settings#servers at 360: each name line wraps into 2 to 3 lines. The counts line starts with "·", and "0" is split from "members". It is crowded but still reads. (settings-names@360-dark.png)
- F-7 · advisory · ui/src/components/ProjectsView.vue:534 · Once a project is bound, the "Shared as" sentence replaces the read-only field the spec describes. It reads clearly. (projects-named@360-dark.png)
- F-8 · advisory · ui/src/components/ProjectsView.vue:361 · The reserved-file-name refusal (line 206) and the post-confirm "Not changed" toast (line 361) reuse captured templates with strings no capture shows. Carried from round 3.

## Outside the change
- ui/src/components/ProjectsView.vue:41 · At 768px with the dock open, the list's "Project · where" column collapses (read in round 3, projects-exists@768-light.png). The diff did not touch the list code.
- ui/src/components/settings/Servers.vue:57 · The server's pill reads a green "Ok" beside name lines flagged missing, re-created or removed (read in round 3, settings-flagged@360-dark.png). The diff did not touch the pill.

## Not answerable
- 3. Keyboard and focus · no accessibility snapshot (`.aria.yml`) for /projects or /settings#servers, and no focus-visible capture.
- 4. Measured accessibility · no axe files.
- 6. The design contract · no DESIGN.md. The app.css tokens are used and the design lint lists no hits.
- 7. Responsive (320) · the dock has a form field and the standard asks for 320px. Only 360, 768 and 1280 were declared and captured.
- 8. Motion against the standard · motion none: no motion samples and no reduced-motion pass. The lint's inventory is empty and the diff adds no animation.
- 10. Console and vitals · no vitals (CLS) recorded. The console half is answered above (F-1).
- audit · no audit/
