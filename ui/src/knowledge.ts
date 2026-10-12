// What the Knowledge view decides: how the project's entries group and filter, what an empty
// page says, and how paths and sources read. Pure, so the tests drive it without a browser.
// No import from api.ts: it reads the page's location.

export type KnowledgeKind = "decision" | "rule" | "glossary" | "architecture" | "howto";
export type KnowledgeStatus = "active" | "draft" | "superseded";

/** An entry as the list has it: everything but the body. */
export interface KnowledgeListEntry {
  slug: string;
  path: string;
  title: string;
  kind: KnowledgeKind;
  essential: boolean;
  status: KnowledgeStatus;
  tags: string[];
  updated: string | null;
  source: string | null;
  problem: string | null;
}
export interface KnowledgeEntry extends KnowledgeListEntry {
  body: string;
}
export interface KnowledgeView {
  state: "unknown" | "off" | "missing" | "ok";
  root: string | null;
  dir: string | null;
  problem: string | null;
  entries: KnowledgeListEntry[];
}
/** A memory proposed as knowledge, with its text as it is now. */
export interface Promotion {
  id: number;
  projectId: number;
  memoryId: number;
  slug: string;
  title: string;
  body: string;
  kind: "decision" | "convention";
  createdAt: number;
}

/** The kinds in the entry format's order (src/modules/knowledge/files.ts). */
export const KNOWLEDGE_KINDS: KnowledgeKind[] = ["decision", "rule", "glossary", "architecture", "howto"];
export const KIND_LABEL: Record<KnowledgeKind, string> = {
  decision: "Decision",
  rule: "Rule",
  glossary: "Glossary",
  architecture: "Architecture",
  howto: "How-to",
};

export type EntryFilter = "all" | "essential" | "attention" | "retired";

export function matches(entry: KnowledgeListEntry, filter: EntryFilter): boolean {
  if (filter === "essential") return entry.essential;
  if (filter === "attention") return entry.problem !== null;
  if (filter === "retired") return entry.status !== "active";
  return true;
}

export function entryCounts(entries: readonly KnowledgeListEntry[]): Record<EntryFilter, number> {
  const count = (filter: EntryFilter) => entries.filter((e) => matches(e, filter)).length;
  return { all: entries.length, essential: count("essential"), attention: count("attention"), retired: count("retired") };
}

/** The entries the filter keeps, by kind in the format's order; each group keeps the order given. */
export function entryGroups(
  entries: readonly KnowledgeListEntry[],
  filter: EntryFilter,
): { kind: KnowledgeKind; label: string; entries: KnowledgeListEntry[] }[] {
  const kept = entries.filter((e) => matches(e, filter));
  const kindOf = (e: KnowledgeListEntry): KnowledgeKind => (KNOWLEDGE_KINDS.includes(e.kind) ? e.kind : "decision");
  return KNOWLEDGE_KINDS.map((kind) => ({ kind, label: KIND_LABEL[kind], entries: kept.filter((e) => kindOf(e) === kind) })).filter(
    (g) => g.entries.length > 0,
  );
}

/** The empty pages' icons: named here, not in a component, so the build bundles them by this list. */
export const KNOWLEDGE_EMPTY_ICONS = ["i-lucide-folder-search", "i-lucide-folder-x", "i-lucide-book-open"];

/** Where entries go, said the same way on every empty page that has a folder. */
const WHERE =
  "Knowledge is Markdown files in .wizardingcode/knowledge/ at the project's root, one per entry, committed with the code. Ask your agent to save one, or accept a proposal with Make knowledge.";

/** What an empty page says, or null when there are entries to show. */
export function knowledgeEmpty(view: KnowledgeView): { icon: string; title: string; text: string; folder: string | null } | null {
  if (view.entries.length > 0) return null;
  if (view.state === "unknown") {
    return {
      icon: "i-lucide-folder-search",
      title: "Where this project lives is not known yet",
      text: "Start a session in the project's folder; its knowledge folder is found from there.",
      folder: null,
    };
  }
  if (view.state === "off") {
    return { icon: "i-lucide-folder-x", title: "Knowledge is off here", text: view.problem ?? "Knowledge is off in this folder.", folder: null };
  }
  return {
    icon: "i-lucide-book-open",
    title: view.state === "missing" ? "No knowledge in this project yet" : "No entries yet",
    text: WHERE,
    folder: view.dir,
  };
}

/** A path inside the project, from the project's root; any other path as it is. */
export function relativePath(path: string, root: string | null): string {
  if (root === null) return path;
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** The memory an entry was promoted from (`source: memory:<id>`), or null. */
export function sourceMemory(source: string | null): number | null {
  const found = /^memory:(\d+)$/.exec(source ?? "");
  return found ? Number(found[1]) : null;
}

/** The entry kind a proposal becomes: a decision stays one, a convention is a rule. */
export function becomes(kind: Promotion["kind"]): KnowledgeKind {
  return kind === "convention" ? "rule" : "decision";
}

/** The page's address: `#knowledge`, with the open entry (`e:<slug>`) or proposal (`p<id>`). */
export function knowledgeHash(open: string | null): string {
  if (open === null) return "#knowledge";
  return open.startsWith("e:") ? `#knowledge/e:${encodeURIComponent(open.slice(2))}` : `#knowledge/${open}`;
}

/** What an address opens on this page, or null when it is not this page's. */
export function openFromHash(hash: string): { open: string | null } | null {
  const found = /^#knowledge(?:\/(.*))?$/.exec(hash);
  if (found === null) return null;
  const key = found[1] ?? "";
  if (/^p\d+$/.test(key)) return { open: key };
  // A slug is a file's name: anything but a separator.
  if (!key.startsWith("e:")) return { open: null };
  try {
    const slug = decodeURIComponent(key.slice(2));
    return { open: slug !== "" && !/[\\/]/.test(slug) && slug !== "." && slug !== ".." ? `e:${slug}` : null };
  } catch {
    return { open: null };
  }
}

/** The numbers in the page header while the Knowledge view is open. */
export interface KnowledgeCrumb {
  entries: number;
  essential: number;
  attention: number;
  proposals: number;
}

/**
 * The Knowledge page's own numbers for the header, not memory's: its entries, the essential
 * ones, those needing attention, and the proposals offered (only where accepting could write,
 * as the page shows them). Null until the page has loaded.
 */
export function knowledgeCrumb(view: KnowledgeView | null, proposals: readonly Promotion[]): KnowledgeCrumb | null {
  if (view === null) return null;
  const counts = entryCounts(view.entries);
  const offered = view.state === "ok" || view.state === "missing" ? proposals.length : 0;
  return { entries: counts.all, essential: counts.essential, attention: counts.attention, proposals: offered };
}
