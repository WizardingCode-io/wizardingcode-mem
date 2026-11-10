// Who wrote a change. The store cannot tell a person from an agent: its caller says which,
// and this file turns that into the name in the frontmatter and the identity on the commit.
import { createHash } from "node:crypto";
import { authorNameProblem } from "../../settings/settings.ts";
import { AGENT_ID, slugify } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import { gitUserName } from "./repo.ts";
import type { AgentWriter, Identity, KnowledgeStore, PersonWriter, Writer } from "./types.ts";

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

/**
 * The commit identity. The addresses are at `.invalid`, a reserved domain that never
 * routes: a commit names its writer without carrying anyone's real address.
 */
export function identityOf(writer: Writer): Identity {
  if (writer.kind === "agent") {
    return { name: `agent:${writer.id}`, email: `${writer.id}@agents.wizardingcode.invalid` };
  }
  // The hash keeps two names apart when their slugs are the same.
  const hash = createHash("sha256").update(writer.name).digest("hex").slice(0, 8);
  return {
    name: writer.name,
    email: `${slugify(writer.name)}.${hash}@people.wizardingcode.invalid`,
  };
}

/** The `author` value of an entry: the person's name, or `agent:<id>`. */
export function authorOf(writer: Writer): string {
  return writer.kind === "agent" ? `agent:${writer.id}` : writer.name;
}
