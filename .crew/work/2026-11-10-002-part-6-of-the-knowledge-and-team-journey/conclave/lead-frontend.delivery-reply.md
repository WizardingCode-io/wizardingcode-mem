# frontend lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: delivery
verdict: validated
## Returns
none
## Notes
- R-1 is fixed. docs/adr/0027-sync-client.md:93 now says what was built: under 640px the nav becomes a select above the cards, the footer's sentence moves under them, and a server row folds into two lines with the actions on their own line. That matches ui/src/components/Settings.vue:79-93 and :129-130, ui/src/components/settings/Servers.vue:261-262, review/ui/manifest.json:52, review/ui/settings-listed@360-dark.png, and the ADR's own bullets at :95 and :97. Nothing in the ADR contradicts it any more.
- R-2 is fixed. .crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md:228 names AC-90 and declares the 21 states: settings 14, sharing 2, projects 5, with viewports 360/768/1280, light and dark, and motion none. spec.md:289 now carries AC-90's text, word for word what probes/criteria.md:17 says. It notes that AC-90 supersedes AC-24 and widens its states, and that it drops "resumes" from the actions clause, with the reason. Both lists match the declared sets in review/ui/manifest.json:10-37.
- I accept the reason for dropping "resumes": the resume route shows in the `resuming` captures (for example review/ui/settings-resuming@768-dark.png), and the Resume flow at Servers.vue:196-231 goes through `api.resumeServer`. No routes test asserts it, so that coverage rests on the session's captures alone. This is a note, not a return.
- Everything else from my first pass on this delivery still holds:
  - All 126 captures are present: 21 states × 3 widths × 2 schemes, each with its console file.
  - Motion is none, so no interaction rows are owed.
  - Every capture row is `by: "session"`, which marks them as hand-made captures; the standing e2e skip is at report.md:148.
  - The ui-ux gate is proven at fingerprint sha256:5c8d0e59…a1cc. That is the run at evidence.json:6823, the fingerprint at report.md:581 and review/inputs.json:4.
  - The design lint passed with no hits (review/design-lint.json:3-13).
  - Only the documents changed, so the interface files those proofs cover are unchanged.
- The report's verdict is still not proven, because of AC-85 under the test-quality gate (report.md:20, :163). The person's decision D-10 retires it in favour of AC-92, but the engine still reports it as unproven. That point is outside the frontend team's surface.
