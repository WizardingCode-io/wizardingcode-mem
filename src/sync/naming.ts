// The received tree's names (ADR 0027): `knowledge/received/<serverId>/<folder>/entries/<file>`,
// where the folder is `shared`, `members/<member id>` (the client's own naming, by id alone)
// or the contract's project folder, and the file name is the contract's. Every component the
// server supplies is checked here before it reaches a path.
import { isTeamAlias } from "../core/identity.ts";
import { isSlug, UUID } from "../modules/knowledge/entry.ts";
import { KnowledgeError } from "../modules/knowledge/errors.ts";
import { fileNameFor, repoFolder } from "../team/contract.ts";

/** The server's hex id: sixteen lower-case hex characters (`newHexId` of the server). */
const SERVER_ID = /^[0-9a-f]{16}$/;
/** A member's id: twelve lower-case base32 characters (`newMemberId` of the server). */
const MEMBER_ID = /^[a-z2-7]{12}$/;
/** The project folder the contract names: `<slug>-<8 hex>`. */
const PROJECT_FOLDER = /^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/;

export type Component = "server" | "member" | "slug" | "project-folder" | "uuid";

const WHAT: Record<Component, string> = {
  server: "server id",
  member: "member id",
  slug: "slug",
  "project-folder": "project folder",
  uuid: "uuid",
};

const invalid = (component: Component, value: string) =>
  new KnowledgeError(
    "invalid",
    `${WHAT[component]} ${JSON.stringify(value)} is not one the received store writes a path for`,
  );

/** Whether a value is one the store writes a path for, as `checkComponent` decides. */
export function isComponent(component: Component, value: string): boolean {
  return component === "server"
    ? SERVER_ID.test(value)
    : component === "member"
      ? MEMBER_ID.test(value)
      : component === "slug"
        ? isSlug(value)
        : component === "project-folder"
          ? PROJECT_FOLDER.test(value) && !value.includes("/") && !value.includes("..")
          : UUID.test(value);
}

/** The component as given, or a refusal that names it: a path is built from checked parts only. */
export function checkComponent(component: Component, value: string): string {
  if (!isComponent(component, value)) throw invalid(component, value);
  return value;
}

/** A member's folder, by id alone: a renamed or erased member moves no folder. */
export function memberFolder(memberId: string): string {
  return `members/${checkComponent("member", memberId)}`;
}

/**
 * The folder of a scope under a server's tree: `shared`, the member's, or the contract's
 * project folder (`repoFolder`), whose last component is checked as the server made it.
 */
export function receivedFolder(
  scope: string,
  remoteAlias: string | null,
  member: { id: string; name: string } | null,
): string {
  if (scope === "shared") return "shared";
  if (scope === "project") {
    if (remoteAlias === null || !isTeamAlias(remoteAlias))
      throw new KnowledgeError("invalid", `alias ${JSON.stringify(remoteAlias)} names no project`);
    const folder = repoFolder("project", remoteAlias, null);
    checkComponent("project-folder", folder.slice("projects/".length));
    return folder;
  }
  if (member === null) throw new KnowledgeError("invalid", "a workspace entry names its member");
  return memberFolder(member.id);
}

/** The path of a received entry's file, relative to `knowledge/received/`. */
export function receivedRelativePath(
  serverId: string,
  scope: string,
  remoteAlias: string | null,
  member: { id: string; name: string } | null,
  uuid: string,
  slug: string,
): string {
  const server = checkComponent("server", serverId);
  const folder = receivedFolder(scope, remoteAlias, member);
  const file = fileNameFor(checkComponent("uuid", uuid), checkComponent("slug", slug));
  return `${server}/${folder}/${file}`;
}
