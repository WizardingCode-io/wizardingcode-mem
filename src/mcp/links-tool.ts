import { decideLink, type Link, linkProjects, linksOf, unlinkProjects } from "../store/links.ts";
import type { ToolContext } from "./tools.ts";

// The agent's way to link projects by hand: list, link, unlink, and decide on suggestions.
// There are no CLI commands for this; the host asks the author before the call runs.

export type LinksAction =
  | { action: "list" }
  | { action: "link"; project: string; kind: "product" | "uses" }
  | { action: "unlink"; project: string }
  | { action: "confirm" | "reject"; id: number };

interface ProjectRow {
  id: number;
  name: string;
  key: string;
}

const MAX_CANDIDATES = 12;

function allProjects(context: ToolContext): ProjectRow[] {
  return context.db
    .query<ProjectRow, []>("SELECT id, name, key FROM projects WHERE disabled = 0 ORDER BY id")
    .all();
}

/**
 * A project named the way memory_projects names them: the exact name, then the exact key,
 * then the name without case. More than one match, or none, is a refusal with candidates.
 */
function findProject(context: ToolContext, wanted: string): ProjectRow | string {
  const w = wanted.trim();
  const all = allProjects(context);
  const ambiguous = (found: ProjectRow[]) =>
    `More than one project is called “${w}”: ${found.map((p) => `${p.name} (${p.key})`).join(", ")}. Name it by its key.`;
  for (const same of [
    (p: ProjectRow) => p.name === w,
    (p: ProjectRow) => p.key === w,
    (p: ProjectRow) => p.name.toLowerCase() === w.toLowerCase(),
  ]) {
    const found = all.filter(same);
    if (found.length === 1) return found[0] as ProjectRow;
    if (found.length > 1) return ambiguous(found);
  }
  const others = all
    .filter((p) => p.id !== context.projectId)
    .slice(0, MAX_CANDIDATES)
    .map((p) => p.name);
  return `No project called “${w}”. Projects: ${others.length === 0 ? "none" : others.join(", ")}.`;
}

/** The agent's call, answered in plain text; refusals are answers too, never exceptions. */
export function projectLinksTool(context: ToolContext, args: LinksAction): string {
  const { db, projectId, now } = context;
  if (projectId === null) return "project_links works inside a project: there is none here.";
  const names = new Map(allProjects(context).map((p) => [p.id, p.name]));
  // Disabled projects keep their names in links.
  const nameOf = (id: number) =>
    names.get(id) ??
    db.query<{ name: string }, [number]>("SELECT name FROM projects WHERE id = ?").get(id)?.name ??
    `#${id}`;
  const here = nameOf(projectId);
  const otherOf = (link: Link) => (link.from === projectId ? link.to : link.from);
  const describe = (link: Link) =>
    link.kind === "product"
      ? `${nameOf(link.from)} and ${nameOf(link.to)} as one product`
      : `${nameOf(link.from)} uses ${nameOf(link.to)}`;

  switch (args.action) {
    case "list": {
      const links = linksOf(db, projectId);
      const relation = (link: Link, suggested: boolean) => {
        const other = nameOf(otherOf(link));
        const mark = suggested ? "?" : "";
        if (link.kind === "product") return `same product${mark}`;
        if (link.from === projectId) return `${here} uses it${mark}`;
        return suggested ? `uses ${here}?` : `uses ${here} (${here} does not see ${other})`;
      };
      const confirmed = links.filter((l) => l.status === "confirmed");
      const suggested = links.filter((l) => l.status === "suggested");
      if (confirmed.length === 0 && suggested.length === 0) {
        return `No linked projects and no suggestions for ${here}.`;
      }
      const lines: string[] = [];
      if (confirmed.length > 0) {
        lines.push(`Linked to ${here}:`);
        for (const link of confirmed) {
          lines.push(`- #${link.id} ${nameOf(otherOf(link))} · ${relation(link, false)}`);
        }
      }
      if (suggested.length > 0) {
        lines.push("Suggested (confirm or reject by id):");
        for (const link of suggested) {
          const signals = link.signals.length > 0 ? ` Signals: ${link.signals.join(", ")}` : "";
          lines.push(`- #${link.id} ${nameOf(otherOf(link))} · ${relation(link, true)}${signals}`);
        }
      }
      return lines.join("\n");
    }
    case "link": {
      if (
        typeof args.project !== "string" ||
        args.project.trim() === "" ||
        (args.kind !== "product" && args.kind !== "uses")
      ) {
        return "link needs project (a name) and kind (product or uses).";
      }
      const other = findProject(context, args.project);
      if (typeof other === "string") return other;
      if (other.id === projectId) return "A project cannot be linked to itself.";
      const link = linkProjects(db, projectId, other.id, args.kind, now);
      return args.kind === "product"
        ? `Linked ${here} and ${other.name} as one product (#${link.id}).`
        : `Linked: ${here} uses ${other.name} (#${link.id}). ${other.name} does not see ${here}.`;
    }
    case "unlink": {
      if (typeof args.project !== "string" || args.project.trim() === "") {
        return "unlink needs project (a name).";
      }
      const other = findProject(context, args.project);
      if (typeof other === "string") return other;
      const ended = linksOf(db, projectId)
        .filter((l) => l.status === "confirmed" && otherOf(l) === other.id)
        .map((l) => unlinkProjects(db, l.id, now))
        .filter((l): l is Link => l !== null);
      if (ended.length === 0) return `${here} is not linked to ${other.name}.`;
      return `Unlinked ${here} and ${other.name} (${ended.map((l) => `#${l.id}`).join(", ")}).`;
    }
    case "confirm":
    case "reject": {
      if (typeof args.id !== "number" || !Number.isInteger(args.id)) {
        return `${args.action} needs id (from list).`;
      }
      const link = linksOf(db, projectId).find((l) => l.id === args.id);
      if (link === undefined) return `No link #${args.id} for ${here}.`;
      const other = nameOf(otherOf(link));
      if (link.status === "confirmed") {
        return `#${link.id} is confirmed, not a suggestion. To end it, unlink ${other}.`;
      }
      if (link.status === "rejected") {
        return `#${link.id} is rejected, not a suggestion. To link them after all, link ${other}.`;
      }
      if (args.action === "confirm") {
        decideLink(db, link.id, "confirmed", now);
        return `Confirmed #${link.id}: ${describe(link)}.`;
      }
      decideLink(db, link.id, "rejected", now);
      return `Rejected #${link.id}: it will not be suggested again.`;
    }
    default:
      return "action must be one of list, link, unlink, confirm, reject.";
  }
}
