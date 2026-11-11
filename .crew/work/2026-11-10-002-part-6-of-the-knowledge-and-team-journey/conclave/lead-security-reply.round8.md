# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: spec
verdict: validated
## Returns
none
## Notes
All lines cited are in `.crew/work/2026-11-10-002-part-6-of-the-knowledge-and-team-journey/spec.md` (revision 9). I read only the passages that match my searches (:97, :134, :146). I did not read plan.md or the text of AC-47 and AC-48, and I did not see the `reindexReceived` or orphan-folder sentence in the pull paragraph. Those rest on the coordinator's description and the lines I did read. Earlier properties are unchanged by the passages I read: what leaves, the token, redirects and loopback, path components, the pin, the 403, the re-join, and D-9 with its A/B clause.

New rules:
- **The read filter (:134, :146).**
  - Search, browse, the prompt floor and `knowledge_get` return only received rows whose server has a `sharing_servers` row, by the module's own SQL over the table it already reads for mutes. The retrieval's received-memory read does the same.
  - A team's text from a server this machine no longer lists, after a restore or a `remove`, can no longer reach the agents before the sync's next start (:146). This closes a window in my earlier "until that pull the rows read as before" limit.
  - It only narrows reads, so it adds no outflow.
  - The check reads `sharing_servers`. The columns read are not the token's, which lives in `servers.json` (:89).
- **The orphan folder step (:97).**
  - The sync's start deletes a `knowledge/received/<serverId>/` folder that has no row and no `sharing_servers` row, which is what a `remove` that crashed before the folder deletion leaves.
  - Per the coordinator, the deletion goes through `lookAt`, `kindAt` and `namesIn`. A link or an unreadable folder is refused and never deleted, as the guards at :134 require. So it cannot follow a link out of `knowledge/received/`, and it cannot touch the person's own repositories.
  - It deletes received copies only, never own items.
  - The `serverId` that names the folder is checked against the server's id grammar first (:134).
- **`reindexReceived` over listed servers' folders only** (per the coordinator). It never re-indexes a folder of a server the person no longer lists, so it cannot resurrect text the person removed.
- **The restore's report** names the pending deletion (:146), so the person knows received copies of an unlisted server are pending deletion and not silently left.
