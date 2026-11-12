# Brief

## Request

The release publishes everywhere by itself, and <data dir>/bin has one owner that never moves back (piece 1 of 3 of 2026-11-11-004, its concepts_brief.md goals 1 and 2, decisions D-1 to D-10). The release workflow, after it creates the GitHub release, runs separate jobs, each idempotent ('already at X' is success) and re-runnable for an existing tag: it publishes the npm shim wizardingcode-mem and the OpenCode package wizardingcode-mem-opencode to npm by trusted publishing (the version from the tag, the dist-tag next for a pre-release); it renders the Homebrew formula from a template in this repository with the release's checksums and writes it into the tap homebrew-wizardingcode (the tap holds the only rendered formula); it bumps the two manifests of the marketplace wizardingcode-plugins; and it moves the image's latest tag last, after every other target succeeded. A pre-release moves none of them. The writes to the two other repositories use the fine-grained token MARKETPLACE_TOKEN, whose expiry the workflow checks and warns of a month ahead (D-9). A release that raises the team server's contract does not move the image's latest: the client side ships first and latest follows one release later, checked by the workflow (D-10). The npm shim only moves the staged binary forward (today it re-downloads whenever the versions differ, which downgrades), and wizardingcode-mem install from a channel copy never replaces a newer staged binary with an older one. A new ADR records it; the README and the release notes of the procedure follow.

## Assumptions

Stated to the person on 2026-11-12 in the conversation, each refusable; none refused.

- A pre-release (a tag with a hyphen) publishes the two npm packages under the dist-tag `next` only, and leaves the tap, the marketplace and the image's `latest` as they are.
- A release whose `CONTRACT` (`src/team/contract.ts`) is higher than the previous plain release's does not move the image's `latest`; the next plain release with the same contract does (D-10 of 2026-11-11-004).
- Without the secret `MARKETPLACE_TOKEN` the tap and marketplace jobs fail with a message that names it, and the image's `latest` does not move.
- A repeat for an existing tag is a `workflow_dispatch` of the same workflow with the tag; nothing is rebuilt, every target reads from the published release.
- Both npm packages, `wizardingcode-mem` and `wizardingcode-mem-opencode` (each at 0.4.4 on npm on 2026-11-12), are published on every release.

## Sources

- The concept and its six reviews: `.crew/work/2026-11-11-004-updated-everywhere-on-release-whenever-a/concepts_brief.md` (goals 1 and 2 are this item).
- The decisions D-1 to D-10 of that item, in the decision register (`crew decisions --grep 2026-11-11-004`).
