# ui-ux findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-ui-ux
read: 27 images, 11 files, contract: none, audit: not captured

## Findings
- F-1 · advisory · ui/src/components/settings/Servers.vue:59 · /settings#servers held and resuming (carried from rounds 3 and 4): the only hold captured is the empty one. The row says "A hold since the restore: the next sync withdraws nothing until you resume." and Resume… says "Nothing is held for 127.0.0.1:52336 now; the hold is released." No capture shows holdLine's branch with n withdrawals held and the per-project lines of the confirmation (review/ui/settings-held@768-dark.png, review/ui/settings-held@360-light.png, review/ui/settings-resuming@360-light.png)
- F-2 · advisory · ui/src/components/settings/Servers.vue:107 · /settings#servers confirming, pending and listed (carried from round 4): the refusal toast "Not added · The server refused the code." stays on screen after the join succeeds. It sits under "Joined 127.0.0.1:52336 … Confirm". In listed, three toasts stack (Not added, Left pending, Server added). At 360 they cover the lower third of the screen and at 768 the nav footer, but they hide no control the state needs (review/ui/settings-confirming@360-dark.png, review/ui/settings-pending@360-light.png, review/ui/settings-listed@360-dark.png, review/ui/settings-listed@768-light.png)
- F-3 · advisory · ui/src/components/settings/Servers.vue:332 · /settings#servers removing and rejoining: Remove… and Rejoin… open a plain UModal with no icon. Resume… opens the confirmation with an icon tile, and so does the dock's widening dialog. So the three confirmations the change adds come in two shapes, and the destructive one has the plainer shape. This is cosmetic: both shapes read clearly (review/ui/settings-removing@360-dark.png, review/ui/settings-rejoining@360-dark.png, review/ui/settings-resuming@360-light.png, review/ui/projects-widening@360-light.png)

Round 4's two upheld defects are closed:
- **Server row actions at 360.** The action group (Servers.vue:262, `basis-full` under 640px, wrapping inside) now takes its own line. Every action is whole inside the card in both schemes:
  - held: Resume…, Mute, Rejoin… and Remove… on two lines.
  - muted: Unmute and Rejoin…, then Remove….
  - listed, stopped and token-missing: Mute and Rejoin…, then Remove….
  - pending: Confirm and Remove….

  Evidence: review/ui/settings-held@360-dark.png, review/ui/settings-held@360-light.png, review/ui/settings-muted@360-dark.png, review/ui/settings-muted@360-light.png, review/ui/settings-listed@360-dark.png, review/ui/settings-stopped@360-light.png, review/ui/settings-token-missing@360-dark.png.
- **Sharing card's last-change line.** After the script's unmute it now reads "Last change: server 127.0.0.1:52336 unmuted, just now, from the viewer" (Sharing.vue:97-103 tells mute and unmute from add and removal). Evidence: review/ui/settings-one@1280-dark.png, review/ui/settings-several@1280-light.png, review/ui/settings-one@360-light.png.

Round 4's F-5 is also closed: at 360 the nav's footer sentence ("…The environment wins over the file; for sharing it can only narrow.") now shows under the cards (review/ui/settings-held@360-dark.png, review/ui/settings-unavailable@360-dark.png).

The criterion's other states also read as AC-90 describes them:
- The Server selector in several (review/ui/settings-several@360-dark.png).
- "Choose a server" with the levels disabled in choosing (review/ui/projects-choosing@1280-dark.png).
- "Bound to 127.0.0.1:52336." in bound and receive (review/ui/projects-bound@360-dark.png, review/ui/projects-receive@360-light.png).
- "A level set here binds this project to 127.0.0.1:52336." in sent (review/ui/projects-sent@768-light.png).
- The add form keeps its fields after a refused code (review/ui/settings-error@360-light.png).
- The unavailable sentence carries no raw error (review/ui/settings-unavailable@360-dark.png).

No console-*.json file holds a message.

## Outside the change
- ui/src/components/ProjectsView.vue:241 · at 768 the project list drops the project names (avatar only) under a LINKS / MEMORIES header. This is debt from the list's earlier layout (review/ui/projects-sent@768-light.png)
- ui/src/components/settings/Sharing.vue:220 · in the light scheme the off switches (Workspace knowledge, Sales, Code, Shared repository knowledge) are near-white on near-white, below WCAG 1.4.11's non-text contrast. This is debt from the earlier Sharing card's switch styling (review/ui/settings-several@1280-light.png, review/ui/settings-one@360-light.png)
- the top bar at 360 · the search control shrinks to a pill squeezed between the "mem" badge and "⌘K". This is debt from the shell (review/ui/settings-unavailable@360-dark.png)

## Not answerable
- 2 states, engine's list · review/inputs.json's captures list carries only the dark files of each state (no -light.png). It reads settings-token-missing as state "missing" (inputs.json:389). The light captures are listed only in review/ui/manifest.json
- 3 keyboard and focus · no accessibility snapshot (`<page>-<state>.aria.yml`) and no focus-visible capture for settings or projects. The Page select, the Sharing card's Server selector and the dock's server picker are labelled in the captures, but how they work by keyboard is not in evidence
- 4 measured accessibility · no axe files for any page or state
- 6 design contract · no DESIGN.md. CLAUDE.md's Sales OS pattern and ADR 0025 D-18 are prose, not tokens
- 8 and 9 motion · the manifest's motion is "none", the design lint's inventory is empty (no hits), there is no reduced-motion pass and there is no spec.md motion thesis. The diff adds no animation
- 10 vitals · no vitals captured (CLS, INP, LCP)
- 11 audit · no audit/ (audit/audit.json absent)
- read coverage · 27 of the 126 captures were read. They are weighted to 360 in both schemes, where round 4's defects were, plus 768 and 1280 forms of the held, muted, listed, one, several and project states. The other 99 were not opened in this round
