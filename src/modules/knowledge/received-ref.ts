// A teammate's entry as the agents and the person name it (ADR 0027): `<server>:<slug>--<8 hex>`.
// One place for the reference's grammar, its rendering from a hit, the provenance line and its
// resolution to the received row, so the MCP tools, the hook's lines and the CLI agree. A leaf
// of the module: it reads the index and the agent-safe names, nothing heavier, since the hook
// imports it.
import { agentName } from "../../core/agent-name.ts";
import type { Db } from "../../store/db.ts";
import { type Hit, type ReceivedScope, receivedByFile, serverByName } from "./index-store.ts";

/** A received entry's reference: the server's name or id, then the file's name. */
export const RECEIVED_REF = /^([^:/\s]{1,80}):([a-z0-9][a-z0-9-]{0,79})--([0-9a-f]{8})$/;
/** The same with a name that holds a colon: never resolved, answered with the id to use. */
const COLON_NAME_REF = /^(.+:.+):([a-z0-9][a-z0-9-]{0,79})--([0-9a-f]{8})$/;

/** `from <member> via <server>`, through `agentName`; `(another device)` for this member's own. */
export function provenanceOf(hit: Pick<Hit, "received" | "revisedBy">): string {
  if (hit.received !== undefined) {
    const who = agentName(hit.received.memberName);
    const where = agentName(hit.received.serverName);
    return `from ${who}${hit.received.ownDevice ? " (another device)" : ""} via ${where}`;
  }
  if (hit.revisedBy !== undefined) {
    return `revised by ${agentName(hit.revisedBy.memberName)} via ${agentName(hit.revisedBy.serverName)}${hit.revisedBy.pinHeld ? " (pin held)" : ""}`;
  }
  return "";
}

/**
 * Where a hit is fetched from: `scope/slug`, or `<server>:<slug>--<8 hex>` for a received one,
 * the server by its name, or by its id when the name holds a colon (which no reference can carry).
 */
export function refOfHit(hit: Pick<Hit, "scope" | "slug" | "received">): string {
  if (hit.received === undefined) return `${hit.scope}/${hit.slug}`;
  const name = agentName(hit.received.serverName);
  const server = name === "" || name.includes(":") ? hit.received.serverId : name;
  return `${server}:${hit.slug}--${hit.received.id.slice(0, 8)}`;
}

/**
 * A received reference's entry, or the sentence that says why it was not found: no such
 * server, a name two servers share (the ids to use), a name with a colon (the id to use),
 * or no such entry in the scope the reader sees.
 */
export function resolveReceivedRef(db: Db, ref: string, scope: ReceivedScope): Hit | string {
  const match = RECEIVED_REF.exec(ref);
  if (match === null) {
    const colon = COLON_NAME_REF.exec(ref);
    const named = colon === null ? null : serverByName(db, colon[1] as string);
    if (named !== null && !("ambiguous" in named))
      return `Not found: ${ref} (the server's name holds a colon; use its id: ${named.serverId}:${colon?.[2]}--${colon?.[3]})`;
    return `Not found: ${ref}`;
  }
  const [, server, slug, hex8] = match as unknown as [string, string, string, string];
  const found = serverByName(db, server);
  if (found === null) return `Not found: ${ref} (${server}: no such server)`;
  if ("ambiguous" in found)
    return `Not found: ${ref} (two servers are named ${server}: use the id, one of ${found.ambiguous.join(", ")})`;
  return receivedByFile(db, found.serverId, slug, hex8, scope) ?? `Not found: ${ref}`;
}
