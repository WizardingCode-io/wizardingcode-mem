# ui-ux findings for 2026-11-11-005-share-a-project-without-a-git-remote-tod
reviewer: review-ui-ux
read: 10 images (projects-exists@1280-dark, @360-dark, @768-light; projects-created@1280-dark, @360-light; projects-taken@1280-dark; projects-remote-too@1280-dark, @360-light; projects-held@1280-dark; settings-flagged@360-dark), 9 files (the rubric, ui-ux.round2.md, ruling.round2.json, review/ui/manifest.json, review/inputs.json, design-lint.json, probes/capture-005.ts, ui/src/components/ProjectsView.vue, and all console files by grep), contract: none, audit: not captured

Round 2's upheld defect is fixed. The manifest now declares `exists` as the 20th /projects state, and inputs.json lists its captures at 360, 768 and 1280. The capture matches the branch at ProjectsView.vue:338-343: the probe has Bruno create the same name after the create confirmation opened, the dock switches to "Joins `taken-…` · created by Bruno · 0 entries, 0 memories", and the confirmation reopens as "Join a shared name?" with "Join and share". The text is correct for the Receive only level the probe chose (projects-exists@1280-dark.png, @360-dark.png, @768-light.png).

Round 2's two copy fixes also show in the captures:
- The created sentence now starts with a capital and ends with a full stop, built at ProjectsView.vue:353 (projects-created@1280-dark.png, @360-light.png).
- The taken sentence ends with a full stop (line 211, projects-taken@1280-dark.png).

The remote-too state now shows one "set Nothing" instruction, since line 540 is gated on `!selected.remote` (projects-remote-too@1280-dark.png, @360-light.png). The design lint has no hits and an empty inventory.

## Findings
- F-1 · advisory · ui/src/api.ts:404 · /projects `created`, `exists` and `removed`: each of the 18 captures logs one browser line, "Failed to load resource … 409", from PUT /api/projects/<id>/sharing. Round 2 had 12 of these; the new `exists` state adds its six. This is the status the spec pins (spec.md:219), and the manifest's observation records it. The dock shows the refusal as a sentence, so no raw error reaches the user. The round-2 ruling lowered this to advisory, and nothing has changed since. (console-projects-exists.json, console-projects-created.json, console-projects-removed.json)
- F-2 · advisory · ui/src/components/ProjectsView.vue:342 · /projects `exists`: after "Create and share", the dialog quietly becomes "Join a shared name?". Nothing says that the create was refused because a teammate created the name a moment ago. Only the "created by Bruno" in the new field sentence hints at it. The spec's wording ("the dock shows the join state and asks again") is met; one clause would explain the switch. (projects-exists@1280-dark.png, projects-exists@360-dark.png)
- F-3 · advisory · ui/src/components/ProjectsView.vue:182 · Round 2's backtick advisory still holds. The New, Joins, taken, removed and created sentences and both confirmation questions (lines 184 and 311) show the slug in literal Markdown backticks. In the taken sentence this gives "`brand`'s". The bound sentences (line 536) show the slug in `<code class="wz-mono">`. (projects-taken@1280-dark.png, projects-exists@1280-dark.png, projects-created@1280-dark.png against projects-remote-too@1280-dark.png)
- F-4 · advisory · ui/src/components/ProjectsView.vue:536 · /projects `missing`, `recreated` and `created`: "set the level again" does not name the path that works, which is Nothing first and then a level. The created sentence now carries the same words ("set the level again to use it", projects-created@1280-dark.png). The wording is the spec's and the route's. Carried from round 2.
- F-5 · advisory · ui/src/components/ProjectsView.vue:542 · /projects `held`: in the dark scheme the disabled "Shared name" field looks the same as the enabled one. Only the warn sentence and the dimmed radios show that it is held. (projects-held@1280-dark.png) Carried from round 2.
- F-6 · advisory · ui/src/components/settings/Servers.vue:283 · /settings#servers at 360: each name line wraps into three or four lines. The counts line starts with "·", "0" is split from "members", and the state suffix sits on its own line. Crowded, but it still reads. (settings-flagged@360-dark.png) Carried from round 2.
- F-7 · advisory · ui/src/components/ProjectsView.vue:534 · Once a project is bound, the spec's read-only field is replaced by the "Shared as" sentence. It reads clearly. (projects-remote-too@1280-dark.png; spec.md "The viewer") Carried from round 2.
- F-8 · advisory · ui/src/components/ProjectsView.vue:361 · Two reachable variants reuse captured templates with strings no capture shows: the reserved-file-name refusal (line 206) and the post-confirm "Not changed" toast that carries the route's sentence (line 361). (projects-refused@1280-dark.png, projects-not-changed@1280-dark.png) Carried from round 2.

## Outside the change
- ui/src/components/ProjectsView.vue:41 · At 768px with the dock open, the list's "Project · where" column collapses: the Links pills cover the avatars and no project name shows. This is list code the diff did not touch. (projects-exists@768-light.png)
- ui/src/components/settings/Servers.vue:57 · The server's pill reads a green "Ok" next to name lines flagged "missing on the server", "re-created by Bruno" and "removed by the operator". The diff did not touch the pill. (settings-flagged@360-dark.png)

## Not answerable
- 3. Keyboard and focus · no accessibility snapshot (`.aria.yml`) for /projects or /settings#servers, and no focus-visible capture. The only focus ring seen is on the join dialog's close button (projects-exists@1280-dark.png, @768-light.png).
- 4. Measured accessibility · no axe files. The contrast of the `--warn` sentences on the light background is not measured (projects-created@360-light.png).
- 6. The design contract · no DESIGN.md. The diff uses the app.css tokens (`--ink`, `--ink-muted`, `--warn`, `wz-mono`), and the design lint lists no hits.
- 7. Responsive (320) · the dock has a form field, and the standard asks for 320px on a page with a form. Only 360, 768 and 1280 were declared and captured.
- 8. Motion against the standard · motion none: no motion samples and no reduced-motion pass. The lint's inventory is empty and the diff adds no animation.
- 10. Console and vitals · no vitals (CLS) recorded. The console half is answered above (F-1).
- audit · no audit/
