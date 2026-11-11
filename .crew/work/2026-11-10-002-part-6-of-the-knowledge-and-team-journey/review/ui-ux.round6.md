# ui-ux findings for 2026-11-10-002-part-6-of-the-knowledge-and-team-journey
reviewer: review-ui-ux
read: 30 images, 10 files, contract: none, audit: not captured

## Findings
- F-1 · advisory · ui/src/components/settings/Servers.vue:322 · /settings#servers rejoining: the Rejoin modal's Invitation code field is a password input outside any `<form>`, so Chrome logs "[DOM] Password field is not contained in a form" on all six rejoining captures. The add form (Servers.vue:282) wraps its field in a form and logs nothing. The entries are `log:verbose`, not errors or warnings, so Q10 still holds. The cost is that Enter in the code field does not submit Rejoin the way Join submits the add form. Note on the evidence: the merged console-settings-rejoining.json holds 24 entries from four capture runs (ports 49409, 50943, 52338 and 53343). The merged files are not reset between runs. Round 5's line that no console file holds a message was not true for this state (review/ui/console-settings-rejoining.json, review/ui/console-settings-rejoining@360-dark.json, review/ui/settings-rejoining@1280-dark.png, review/ui/settings-rejoining@360-light.png)
- F-2 · advisory · ui/src/components/settings/Servers.vue:59 · /settings#servers held and resuming (carried from rounds 3 to 5): the only hold captured is the empty one. The row reads "A hold since the restore: the next sync withdraws nothing until you resume." No capture shows holdLine's branch with n withdrawals held, or resumeDescription's per-project lines (Servers.vue:213). Resume… with nothing held says "Nothing is held for 127.0.0.1:53341 now; the hold is released." before the person presses Resume, so the sentence states the result ahead of the action (review/ui/settings-held@1280-light.png, review/ui/settings-held@360-dark.png, review/ui/settings-resuming@768-dark.png)
- F-3 · advisory · ui/src/components/settings/Servers.vue:107 · /settings#servers confirming, pending and listed (carried from rounds 4 and 5): the "Not added · The server refused the code." toast stays on screen after the join succeeds. In listed, three toasts stack (Not added, Left pending, Server added). At 360 they cover the lower third of the screen and at 1280 the nav footer, but they hide no control a state needs (review/ui/settings-confirming@1280-light.png, review/ui/settings-confirming@360-light.png, review/ui/settings-pending@768-dark.png, review/ui/settings-listed@1280-dark.png, review/ui/settings-listed@360-light.png)
- F-4 · advisory · ui/src/components/settings/Servers.vue:332 · /settings#servers removing and rejoining (carried from round 5): Remove… and Rejoin… open a plain UModal with no icon tile. Resume… and the dock's "Share more of site?" use the Confirm shape with an icon. The change's confirmations therefore come in two shapes, and the destructive one has the plainer shape. This is cosmetic: both read clearly (review/ui/settings-removing@768-light.png, review/ui/settings-removing@360-dark.png, review/ui/settings-rejoining@1280-dark.png, review/ui/settings-resuming@768-dark.png, review/ui/projects-widening@768-dark.png)

Nothing the person sees has changed since round 5. The Sharing card's last-change line, now built by `serverChange` in ui/src/sharing-text.ts, still reads "Last change: server 127.0.0.1:53341 unmuted, just now, from the viewer." (review/ui/settings-one@768-dark.png, review/ui/settings-several@1280-dark.png, review/ui/settings-one@360-light.png).

At 360, every server-row action is whole inside the card:
- held: Resume…, Mute, then Rejoin… and Remove… (review/ui/settings-held@360-dark.png)
- stopped and token-missing: Mute and Rejoin…, then Remove… (review/ui/settings-stopped@360-light.png, review/ui/settings-token-missing@360-dark.png)
- pending: Remove… alone in confirming (review/ui/settings-confirming@360-light.png)

AC-90's states read as the criterion says:
- empty: "No server listed yet…" (review/ui/settings-empty@1280-dark.png)
- adding: the add form (review/ui/settings-adding@768-light.png)
- error: the fields are kept after a refused code (review/ui/settings-error@360-dark.png)
- muted: a neutral Muted pill with Unmute (review/ui/settings-muted@768-light.png)
- stopped: the remedy line in the danger tone (review/ui/settings-stopped@768-dark.png)
- unavailable: "Servers could not be loaded.", with no raw error (review/ui/settings-unavailable@1280-light.png)
- several: the Server selector (review/ui/settings-several@360-light.png)
- choosing: "Choose a server", with the levels dimmed and disabled (review/ui/projects-choosing@360-light.png)
- bound and receive: "Bound to 127.0.0.1:53341." (review/ui/projects-bound@768-dark.png, review/ui/projects-receive@1280-light.png, review/ui/projects-receive@360-dark.png)
- sent: "A level set here binds this project to 127.0.0.1:53341." (review/ui/projects-sent@1280-dark.png)
- widening: "…would leave for 127.0.0.1:53341." (review/ui/projects-widening@360-light.png)

Apart from rejoining's verbose entries (F-1), every console-*.json file has an empty messages list. The design lint has no hits and an empty inventory.

## Outside the change
- ui/src/components/ProjectsView.vue:241 · at 768 the project list drops the project names and shows the avatar only. The row's sharing badge ("Knowledge", "Receive only") is drawn over the avatar. This is debt from the list's earlier layout, which this diff did not touch (review/ui/projects-bound@768-dark.png, review/ui/projects-widening@768-dark.png)
- ui/src/components/ProjectsView.vue · at 360 the toolbar's "No links yet" is cut to "No li…" and the header's description to "What your projects shar…". This is debt from the page header (review/ui/projects-choosing@360-light.png, review/ui/projects-receive@360-dark.png)
- ui/src/components/settings/Sharing.vue:220 · in the light scheme the off switches are near-white on near-white, below WCAG 1.4.11's non-text contrast. This is debt from the earlier Sharing card's switch styling (review/ui/settings-several@360-light.png, review/ui/settings-one@360-light.png)
- the top bar at 360 · the search control shrinks to a pill squeezed between the "mem" badge and "⌘K". This is debt from the shell (review/ui/settings-held@360-dark.png)

## Not answerable
- 2 states, engine's list · review/inputs.json's captures list still has no -light.png file and reads settings-token-missing as state "missing" (inputs.json:389). The light captures are listed only in review/ui/manifest.json
- 3 keyboard and focus · no accessibility snapshot (`<page>-<state>.aria.yml`) and no focus-visible capture for settings or projects. The Page select, the Server selector, the dock's server picker and the Rejoin code field are labelled in the captures, but how they work by keyboard is not in evidence
- 4 measured accessibility · no axe files for any page or state
- 6 design contract · no DESIGN.md. CLAUDE.md's Sales OS pattern and ADR 0025 D-18 are prose, not tokens
- 8 and 9 motion · the manifest's motion is "none", the design lint's inventory is empty, and there is no reduced-motion pass and no spec.md motion thesis. The diff adds no animation
- 10 vitals · no vitals captured (CLS, INP, LCP)
- 11 audit · no audit/ (audit/audit.json absent)
- read coverage · 30 of the 126 captures were read: every one of the 21 states at least once, in both schemes and all three widths. The other 96 were not opened in this round
