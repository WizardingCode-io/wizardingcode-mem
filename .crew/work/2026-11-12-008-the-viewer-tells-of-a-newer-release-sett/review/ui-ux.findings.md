

## Clarifications
- # ui-ux findings for 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett
  reviewer: review-ui-ux
  read: 72 images, 9 files, contract: none, audit: not captured
  
  ## Findings
  - F-1 · defect · src/ui/update.ts:74 · About, state unbuilt, all three widths in both schemes: rubric question 5 says no raw error may reach the user, but the status line shows the system error itself: "Not checked: EIO: i/o error, read" (warning tone, triangle), drawn at ui/src/components/settings/About.vue:57. spec.md:16 asks for this wording (`not checked: <the error's first line>`), so the judge has to choose between the spec and the rubric. One fix is a plain sentence ("Could not read the release state") with the error kept for the log or `doctor`. (settings-about-unbuilt@1280-dark.png, settings-about-unbuilt@360-light.png)
  - F-2 · advisory · ui/src/update.ts:74 · About, state unbuilt: when the report cannot be built, the server sends `mode: "check"` and `fromEnvironment: false` (src/ui/update.ts:70 and :77). `checksDaily` then ignores the key's real value, so the switch shows on and enabled even if the env file or the environment says off. The captures show it on; a person with the check turned off would see a false state. (settings-about-unbuilt@1280-dark.png)
  - F-3 · advisory · ui/src/update.ts:37 · About, state off-env: the new viewer wording is right, but the status line ("Off (WIZARDINGCODE_MEM_UPDATE in the environment this viewer was started with)") and the switch description right under it (About.vue:73, "Set by WIZARDINGCODE_MEM_UPDATE in the environment this viewer was started with.") now say the same thing twice. (settings-about-off-env@1280-dark.png, settings-about-off-env@360-light.png)
  - F-4 · advisory · ui/src/components/settings/About.vue:57 · About, state off: the status line prints the data directory's full path ("…/var/folders/n3/…/data/env"), which takes five lines at 360. "Off (in the settings file)" would read better, with the path left to Storage. (settings-about-off@360-dark.png, settings-about-off@1280-light.png)
  
  Round 1 findings checked against the new evidence, all resolved:
  - F-1: the banner now sits under the top bar across the window (App.vue:161). At 360 "0.9.0 is out.", "How to update" and "Dismiss" are all visible on the memories view. (memories-update-out@360-dark.png, memories-update-out@360-light.png, memories-update-out-copy@360-dark.png)
  - F-2: all five states are declared (spec.md:30-31, AC-15) and captured at 3 widths × 2 schemes: settings-about ahead, off-unknown, ci and unbuilt, and memories update-out-copy, whose banner reads "This copy is 0.8.0.".
  - F-3: at 768 the full banner line is uncut. (memories-update-out@768-dark.png)
  - F-4: the agents line is gone in the out state.
  - F-5 and F-9: the commands wrap at slashes and hyphens, with each copy button beside its command at every width. (settings-about-out@360-dark.png, settings-about-out@768-light.png)
  - F-6: failed and unbuilt show a triangle; out keeps the arrow.
  - F-7: the off-env line now uses the viewer's own words (see F-3 above for the repetition this created).
  - F-8: Plugin, Script and the plugin sentence now start with a capital.
  
  The "new" mark on About is visible in the out state at 1280 and 768, and at 360 the page selector reads "About (new)". All 72 console files have empty `messages`.
  
  ## Outside the change
  - ui/src/App.vue:165 · Memories view at 768 and 360, existing code, not touched: the 216px projects panel stays open. At 768 the memory title column shrinks to one letter; at 360 main runs past the viewport. The banner no longer depends on it. (memories-update-out@768-dark.png, memories-update-out@360-light.png)
  - ui/vite.config.ts:60 · In the light scheme the off track of a USwitch is barely visible on the white card. This applies to every switch in Settings, not only this one. (settings-about-off-unknown@1280-light.png, settings-about-off-env@768-light.png)
  
  ## Not answerable
  - 3 keyboard and focus · no accessibility snapshot (.aria.yml) and no focus-visible capture for settings-about or memories
  - 4 measured accessibility · no axe files in review/ui/
  - 6 design contract · no DESIGN.md (spec.md:33 "design: none"); review/design-lint.json was not re-read this round (round 1: no hits)
  - 8 and 9 motion · manifest "motion": "none"; the diff adds no animation and there is no reduced-motion pass
  - 10 vitals · the manifest has no vitals summary, so CLS cannot be read; the console is clean on all 72 captures
  - audit · no audit/ folder in review/ui/
  - manifest · the evidence is the session-written review/ui/manifest.json ("by": "session"); there is no engine-written review/ui-evidence.json
