// What the viewer decides about linked projects and the author's rules: how a link reads from
// each end, which projects one reads besides itself, how the list groups them, and how the
// long strings behind a suggestion are shaped for a row. Pure, so the tests drive it without
// a browser. No import from api.ts: it reads the page's location.
import { tidyPaths } from "./prompt";

export type LinkKind = "product" | "uses";
export interface LinkView {
  id: number;
  from: number;
  fromName: string;
  to: number;
  toName: string;
  kind: LinkKind;
  status: "suggested" | "confirmed" | "rejected";
  origin: "suggested" | "manual";
  signals: string[];
  createdAt: number;
  decidedAt: number | null;
}
export interface LinksList {
  links: LinkView[];
  pending: { total: number; byProject: Record<string, number> };
}
export interface ProposedRule {
  id: number;
  title: string;
  body: string;
  reason: "repeated" | "said-always";
  kind: string;
  projects: string[];
  createdAt: number;
}
export interface AcceptedRule {
  memoryId: number;
  proposalId: number | null;
  title: string;
  body: string;
  kind: string;
  importance: number;
  reason: "repeated" | "said-always" | null;
  projects: string[];
  createdAt: number;
}
export interface RulesList {
  proposed: ProposedRule[];
  accepted: AcceptedRule[];
}
export interface LinksOffer {
  show: boolean;
  suggestions: number;
  proposals: number;
}

/** A link from one end: the other project and what it is to this one. */
export interface Relation {
  otherId: number;
  otherName: string;
  label: "Same product" | "Uses" | "Used by";
}
export function relationOf(link: LinkView, projectId: number): Relation {
  const mine = link.from === projectId;
  const other = mine ? { otherId: link.to, otherName: link.toName } : { otherId: link.from, otherName: link.fromName };
  return { ...other, label: link.kind === "product" ? "Same product" : mine ? "Uses" : "Used by" };
}

const touches = (link: LinkView, projectId: number) => link.from === projectId || link.to === projectId;
const byName = (a: { otherName: string }, b: { otherName: string }) => a.otherName.localeCompare(b.otherName);

/** A project's confirmed links and its suggestions waiting for a decision, by the other's name. */
export function projectLinks(links: LinkView[], projectId: number): { confirmed: (Relation & { link: LinkView })[]; suggested: (Relation & { link: LinkView })[] } {
  const of = (status: LinkView["status"]) =>
    links
      .filter((l) => l.status === status && touches(l, projectId))
      .map((l) => ({ ...relationOf(l, projectId), link: l }))
      .sort(byName);
  return { confirmed: of("confirmed"), suggested: of("suggested") };
}

/** The projects one reads besides itself, as the server decides (src/store/links.ts): no chains. */
export function visibleFrom(links: LinkView[], projectId: number): { id: number; name: string }[] {
  const seen = new Map<number, string>();
  for (const l of links) {
    if (l.status !== "confirmed") continue;
    if (l.kind === "product" && touches(l, projectId)) {
      const r = relationOf(l, projectId);
      seen.set(r.otherId, r.otherName);
    } else if (l.kind === "uses" && l.from === projectId) seen.set(l.to, l.toName);
  }
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

export interface ProjectGroup<P> {
  key: "review" | "linked" | "alone";
  label: string;
  items: P[];
}
/** Projects with suggestions to decide first, then the linked ones, then the rest; by name. */
export function projectGroups<P extends { id: number; name: string }>(projects: P[], links: LinkView[]): ProjectGroup<P>[] {
  const has = (p: P, status: LinkView["status"]) => links.some((l) => l.status === status && touches(l, p.id));
  const sorted = [...projects].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const review = sorted.filter((p) => has(p, "suggested"));
  const linked = sorted.filter((p) => !review.includes(p) && has(p, "confirmed"));
  const alone = sorted.filter((p) => !review.includes(p) && !linked.includes(p));
  const groups: ProjectGroup<P>[] = [
    { key: "review", label: "To review", items: review },
    { key: "linked", label: "Linked", items: linked },
    { key: "alone", label: "On their own", items: alone },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Where a project lives, for a row: its remote, or its folder with the home and the middle folded. */
export function projectPlace(key: string): string {
  const at = key.indexOf(":");
  const kind = at < 0 ? "" : key.slice(0, at);
  const rest = at < 0 ? key : key.slice(at + 1);
  if (kind === "remote") return rest;
  if (kind === "imported") return "Imported, no folder yet";
  return tidyPaths(rest);
}

/** A git URL as a remote reads: no scheme, no user, no `.git`. */
const shortRemote = (url: string) =>
  url
    .replace(/^git\+/, "")
    .replace(/^[a-z]+:\/\/(?:[^@/]+@)?/i, "")
    .replace(/^[^@/]+@([^:]+):/, "$1/")
    .replace(/\.git$/, "");

/** One reason behind a suggestion as a muted label and a value (mono in the dock). */
export function signalParts(signal: string): { label: string; value: string } {
  const owner = /^same owner (.+)$/.exec(signal);
  if (owner) return { label: "Same owner", value: owner[1] as string };
  const name = /^shared name (.+)$/.exec(signal);
  if (name) return { label: "Shared name", value: name[1] as string };
  const workspace = /^one workspace (.+)$/.exec(signal);
  if (workspace) return { label: "One workspace", value: tidyPaths(workspace[1] as string) };
  const depends = /^(\S+) depends on (.+)$/.exec(signal);
  if (depends) {
    const target = depends[2] as string;
    const value = /^(git\+|[a-z]+:\/\/|[^@/\s]+@[^:\s]+:)/i.test(target) ? shortRemote(target) : tidyPaths(target);
    return { label: `${depends[1]} depends on`, value };
  }
  return { label: "", value: signal };
}

/** Why a rule was proposed, or that it is the author's. */
export function ruleWhy(rule: { reason: ProposedRule["reason"] | null; projects: string[] }): string {
  if (rule.reason === "repeated") return `Repeated in ${rule.projects.length} projects`;
  if (rule.reason === "said-always") return "You said it holds everywhere";
  return "Made yours";
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/** The quiet banner's line: what is new since it was last dismissed. */
export function linksOfferLine(offer: LinksOffer): string {
  const links = offer.suggestions > 0 ? `${plural(offer.suggestions, "link", "links")} suggested between your projects` : "";
  const rules = offer.proposals > 0 ? `${plural(offer.proposals, "rule", "rules")} you repeat that could be yours` : "";
  return `${[links, rules].filter(Boolean).join(", and ")}.`;
}
