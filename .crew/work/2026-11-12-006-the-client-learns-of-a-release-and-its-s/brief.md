# Brief

## Request

The client learns of a release and its staged binary follows (piece 2 of 2026-11-11-004, goal 3 of its concept brief; decisions D-5, D-6, D-7). (1) A daily check from the session-start hook, in a detached process under a lease and a backoff, through one function latestVersion() that fails closed to unknown. (2) The staged binary under <data dir>/bin replaces itself with a verified download, only when no wizardingcode-mem process of an older version holds the store; macOS and Linux; Windows gets the notice only. (3) status, doctor and the viewer's About show the released version and the one command per channel; WIZARDINGCODE_MEM_UPDATE=off|check. (4) One rule for reading the version a staged binary answers, across its five readers (moved here from 2026-11-12-005). (5) The README's privacy section names the daily request and its hosts.

## Assumptions

- The request as recorded above is narrowed by the author's two answers of 2026-11-12, after six lenses read the concept (`concepts_brief.md`): this item tells and does not replace (points 2 and 4 of the request are not built; the replacement is a later item of its own, and the version-reading rule stays deferred as its own item); the daily check is on by default and only tells.
- The check runs as a step after the drain, not as a detached process from the session-start hook, and reads github.com's `releases/latest` redirect, not the API.
- Two pieces with no network are added: a newer copy run by a person stages itself, and an older copy hands over to the staged binary.
