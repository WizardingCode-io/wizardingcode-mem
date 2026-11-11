// Who wrote a change. The store cannot tell a person from an agent: its caller says which,
// and this file turns that into the name in the frontmatter and the identity on the commit.
import { createHash } from "node:crypto";
import { agentName } from "../../core/agent-name.ts";
import { authorNameProblem } from "../../settings/settings.ts";
import { AGENT_ID, slugify } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import { gitUserName } from "./repo.ts";
import type {
  AgentWriter,
  Identity,
  KnowledgeStore,
  PersonWriter,
  SyncWriter,
  Writer,
} from "./types.ts";

/** The name when nothing names the person. `source: "default"` tells it from a person named so. */
const DEFAULT_NAME = "you";

/** The author setting, else the global git `user.name`, else `you`. */
export function personAuthor(store: KnowledgeStore): PersonWriter {
  const setting = store.settings.author;
  if (setting !== null) return { kind: "person", name: setting, source: "setting" };
  const fromGit = gitUserName(store);
  if (fromGit !== null && authorNameProblem(fromGit) === null) {
    return { kind: "person", name: fromGit, source: "git" };
  }
  return { kind: "person", name: DEFAULT_NAME, source: "default" };
}

export function agentWriter(id: string): AgentWriter {
  if (!AGENT_ID.test(id)) {
    throw new KnowledgeError(
      "invalid",
      "agent id: lower-case letters, digits and hyphens, starting with a letter or a digit",
    );
  }
  return { kind: "agent", id };
}

/** A member id as the address's local part takes it: letters, digits, dot, underscore, hyphen. */
const MEMBER_ID = /^[A-Za-z0-9._-]{1,80}$/;

/**
 * The commit identity. The addresses are at `.invalid`, a reserved domain that never
 * routes: a commit names its writer without carrying anyone's real address.
 */
export function identityOf(writer: Writer): Identity {
  if (writer.kind === "agent") {
    return { name: `agent:${writer.id}`, email: `${writer.id}@agents.wizardingcode.invalid` };
  }
  if (writer.kind === "sync") {
    // The teammate whose revision is applied: named by the server's member id, never by an
    // address. The name is the server's word, rendered as the agents see it (control
    // characters out, cut at the agent-name length); the id stands in for an empty one. An id
    // outside the address grammar (only a hostile server sends one) goes in as its hash.
    const id = MEMBER_ID.test(writer.member.id)
      ? writer.member.id
      : createHash("sha256").update(writer.member.id).digest("hex").slice(0, 16);
    return {
      name: agentName(writer.member.name) || id,
      email: `${id}@members.wizardingcode.invalid`,
    };
  }
  // The hash keeps two names apart when their slugs are the same.
  const hash = createHash("sha256").update(writer.name).digest("hex").slice(0, 8);
  return {
    name: writer.name,
    email: `${slugify(writer.name)}.${hash}@people.wizardingcode.invalid`,
  };
}

/** The committer of what the sync writes: the process, named after the server it syncs with. */
export function syncCommitter(writer: SyncWriter): Identity {
  return { name: "wizardingcode-mem sync", email: `sync@${writer.serverId}.wizardingcode.invalid` };
}

/** The `author` value of an entry, or the `proposed_by` of a proposal: the person's name, `agent:<id>` or `sync:<serverId>`. */
export function authorOf(writer: Writer): string {
  if (writer.kind === "agent") return `agent:${writer.id}`;
  if (writer.kind === "sync") return `sync:${writer.serverId}`;
  return writer.name;
}
