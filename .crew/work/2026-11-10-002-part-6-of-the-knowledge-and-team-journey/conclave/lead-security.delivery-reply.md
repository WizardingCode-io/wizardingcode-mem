# security lead's validation of 2026-11-10-002-part-6-of-the-knowledge-and-team-journey: delivery
verdict: validated
## Returns
none
## Notes
- **R-1 holds, checked on the document itself.** docs/adr/0027-sync-client.md:102 ("Known limits") now states all five limits:
  - (a) The mute and the binding hide a teammate's copies only from the knowledge reads, the brief and the prompt. `memory_search` and the viewer read a received memory as an ordinary `memories` row, with no mute or binding check.
  - (b) The distillation's consolidation can send such a row to the person's TypeSafe provider as a neighbour.
  - (c) A received memory is filed under any enabled project that holds its alias, with no check that the project is bound to the sending server.
  - (d) The pull's answer is read as sent: no shape check on its items and no size cap on its body, so a hostile or compromised server can exhaust the sync process's memory.
  - (e) `--code` on the command line puts the invitation code in shell history and `ps`.
- **The limits recorded before are still there.** `remove` leaving the device valid until an admin revokes it is at docs/adr/0027-sync-client.md:42. The erasure after a restore waiting for `sync --once` is at :68 and :106.
- **Together with the judgement's advisories (report.md:165-171), every security limit the delivery leaves open is now on record.**
- **What I validated in my previous answer still holds.** That answer read the code directly. It covered:
  - the token file: 0600, outside the store and the backup, never in an answer, an output or a log;
  - the server URL: https outside literal loopback only, and `redirect: "error"` on every request;
  - redaction and hashing before anything leaves, and received items never sent on;
  - every path component the server supplies checked against a grammar, and linked roots refused;
  - teammates' names passed through `agentName`;
  - the mute and binding in the brief and prompt, linked pools included;
  - the erasure on `remove`, in one transaction, with cascades;
  - the viewer's routes behind the viewer token.

  This change touched no code.
- **Gates.** The security gate is proven on the final tree (report.md:156) and the secrets scan passed (report.md:141). The edit here is to a document only.
