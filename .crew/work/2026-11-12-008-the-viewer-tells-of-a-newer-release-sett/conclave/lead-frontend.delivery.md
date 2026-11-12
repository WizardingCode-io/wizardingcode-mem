# frontend lead's validation of 2026-11-12-008-the-viewer-tells-of-a-newer-release-sett: delivery
verdict: validated
## Returns
none
## Notes
- **Hand-made evidence, flagged.** There is no engine-written `review/ui-evidence.json`. All 72 rows of `.crew/work/2026-11-12-008-the-viewer-tells-of-a-newer-release-sett/review/ui/manifest.json` carry `"by": "session"` (file-level at `manifest.json:2`, first row at `manifest.json:51`). I do not return it, because the author's standing decision of 2026-11-09 skips the e2e gate and names the session's captures as the UI evidence (`report.md:48`, `report.md:142`). The judge applied the same rule and lowered the one ui-ux defect to advisory for it (`review/ruling.json:1`, `report.md:61`).
- **No frontend validation of the spec is on record.** `report.md:109-112` lists only lead-qa and lead-security at the spec, although `report.md:99` seats lead-frontend. This delivery validation is the frontend lead's first look at the item.
- **No state is missing.** `spec.md:30-31` declares 10 states on `/settings#about` and 2 on `/memories`, at 360, 768 and 1280, light and dark. The manifest declares the same 12 (`manifest.json:7-25`) and holds 12 × 3 × 2 = 72 rows, so every state is captured at every width in both schemes. The 12 files at 360 light are on disk.
- **Motion needs no rows.** The thesis is `motion: none` (`spec.md:32`), the manifest agrees (`manifest.json:37`), and `ui/src/components/UpdateBanner.vue:32-38` and `ui/src/components/settings/About.vue:52-74` add no transition.
- **The ui-ux ruling is proven on the report's fingerprint.** `report.md:57` gives ui-ux proven with 6 findings, all advisory (`report.md:61-66`); the fingerprint is at `report.md:170`. The round 2 findings confirm all nine round 1 findings resolved (`review/ui-ux.findings.md:14-22`).
- **The design lint passed.** `report.md:43`; `review/design-lint.json:3-10` covers the four `.vue` files with no hits. The design line is `none`, on record at `spec.md:33`.
- **The biome lint gate proves nothing for the page.** It read none of the nine `ui/` and `src/ui/` files (`probes/lint-by-name.md:24`); typecheck and build hold them (`report.md:44`, `report.md:47`). This is recorded as deferred at `docs/real-use/findings.md:88`.
- **I opened seven captures and they match the spec.**
  - `memories-update-out@360-light.png`: the banner sits under the top bar across the window, reading "0.9.0 is out." with both actions uncut (`spec.md:24`; `ui/src/App.vue:161`; `UpdateBanner.vue:34-35`).
  - `memories-update-out-copy@768-dark.png`: the full line "This copy is 0.8.0." is uncut.
  - `settings-about-out@1280-light.png`: warning tone, four channel rows, three copy buttons, the plugin row as an instruction, and the `new` mark on About (`spec.md:25-26`; `About.vue:61-72`; `ui/src/components/Settings.vue:74`).
  - `settings-about-out@360-dark.png`: commands wrap with each copy button beside its command, and the page selector reads "About (new)".
  - `settings-about-unbuilt@768-light.png`: triangle sign, the card and switch stay.
  - `settings-about-off@360-dark.png` and `settings-about-off-env@1280-light.png`: muted tone, switch off, and disabled with the environment note in the second.
- **The banner follows the pattern.** `UpdateBanner.vue:32` uses the same classes as `ui/src/components/HistoryOffer.vue:67` (36 px, blue-soft, 16 px icon, truncating line). The banner, the card and the Settings list share one read per page load (`ui/src/update-state.ts:11-19`).
- **What is left is written down.** The four ui-ux advisories are at `docs/real-use/findings.md:85`, the two debts outside the change at `:86`, and the untested clicks of `How to update`, `Dismiss` and the copy buttons at `:87` (also `spec.md:50`).
- **Preference, not a return.** The raw error line in the unbuilt state ("Not checked: EIO: i/o error, read") and the five-line env path at 360 in the off state should be the first things a follow-up takes. The first needs a spec change (`spec.md:16`, AC-8), as the judge says at `report.md:61`.
- **Preference, not a return.** At 768 the open projects panel shrinks the memories title column to one letter (`memories-update-out-copy@768-dark.png`). It predates this item (`ui/src/App.vue:166`), but it is the page the banner now sits over.
