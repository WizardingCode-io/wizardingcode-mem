// The file formats of the knowledge store: an entry, a proposal, the taxonomy. The
// frontmatter is a small YAML subset this file reads and writes itself (no dependency):
// `key: value` lines, plain scalars, double-quoted strings, whole numbers, block lists.
// Parsing never throws: a file that cannot be read as an entry becomes a draft with a problem.
import { RESERVED, SLUG, SLUG_MAX } from "../../core/identity.ts";
import { clip } from "../../util/text.ts";
import { KnowledgeError } from "./errors.ts";
import type { KnowledgeEntry, KnowledgeProposal, ListItem, Taxonomy } from "./types.ts";

export const KINDS = /^(?:knowledge|strategy|persona|pattern)$/;
export const STATUSES = /^(?:active|draft|archived)$/;
export { SLUG };
export const AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;
/** The agent id of a host the MCP handshake does not name: the one fallback. */
export const UNKNOWN_AGENT = "mcp";
export const AREA_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Lower case only: ids name files, and a case-insensitive file system must not merge two. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const ENTRY_MAX_BYTES = 262144;
export const TITLE_MAX = 200;
export const FIELD_MAX = 120;
export const LABEL_MAX = 60;
export const AREA_MAX = 40;
/** Past this length a slug is cut at its last hyphen, so it does not end mid-word. */
const SLUG_CUT_AFTER = 40;

export const DEFAULT_AREAS: { id: string; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "management", label: "Management" },
  { id: "marketing", label: "Marketing" },
  { id: "sales", label: "Sales" },
  { id: "video", label: "Video" },
  { id: "design", label: "Design" },
  { id: "operations", label: "Operations" },
  { id: "finance", label: "Finance" },
  { id: "people", label: "People" },
];

export function nowIso(ms: number): string {
  return new Date(ms).toISOString();
}

/** The frontmatter line of a pin, which never leaves this machine and is never taken from a server. */
export const PIN_LINE = /^pinned:/;

/**
 * A text split at its frontmatter block with the `pinned` line left out: the opening line,
 * the lines between, the closing line and the body's lines. Null without a block. The sync
 * sends a file through it, and takes a teammate's revision through it with the local pin put
 * back, so both read one rule.
 */
export function splitFrontmatterLines(
  text: string,
): { open: string; front: string[]; close: string; body: string[] } | null {
  const lines = text.split("\n");
  if (lines[0]?.trimEnd() !== "---") return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (end === -1) return null;
  return {
    open: lines[0] as string,
    front: lines.slice(1, end).filter((line) => !PIN_LINE.test(line)),
    close: lines[end] as string,
    body: lines.slice(end + 1),
  };
}

// --- Slugs ------------------------------------------------------------------------

/**
 * The slug a text makes, with no fallback: NFKD, the marks removed, lower case, every run
 * of other characters one hyphen, the ends trimmed, cut at a hyphen past `SLUG_MAX`. Empty
 * when no letter or digit survives, and a reserved name as it is: `slugify` adds the
 * fallbacks for a file, and a shared name (ADR 0028) refuses instead.
 */
export function slugCore(text: string): string {
  let slug = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > SLUG_MAX) {
    slug = slug.slice(0, SLUG_MAX);
    const hyphen = slug.lastIndexOf("-");
    if (hyphen > SLUG_CUT_AFTER) slug = slug.slice(0, hyphen);
    slug = slug.replace(/-+$/, "");
  }
  return slug;
}

export function slugify(title: string): string {
  const slug = slugCore(title);
  if (slug === "") return "entry";
  return RESERVED.test(slug) ? `${slug}-entry` : slug;
}

/** Whether a value is a slug the store writes a file for: the one rule `checkSlug` and the received store's names apply. */
export function isSlug(raw: string): boolean {
  return SLUG.test(raw) && raw.length <= SLUG_MAX && !RESERVED.test(raw);
}

/** A caller's slug is checked, never normalised: what was asked is what is written, or nothing. */
export function checkSlug(raw: string): string {
  if (!isSlug(raw)) {
    throw new KnowledgeError(
      "invalid",
      `slug: lower-case letters, digits and hyphens, starting with a letter or a digit, at most ${SLUG_MAX} characters, and not a reserved file name`,
    );
  }
  return raw;
}

// --- Frontmatter ------------------------------------------------------------------

export type FrontValue = string | number | ListItem[];

export interface Frontmatter {
  map: Map<string, FrontValue>;
  order: string[];
  body: string;
  /** Each key's own lines as written (its list items included), for the keys kept verbatim. */
  raw: Map<string, string[]>;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;
const ITEM_LINE = /^[ \t]*-(?:[ \t]+(.*))?$/;
const ITEM_PAIR = /^([^\s:"]+):(?:[ \t]+(.*))?$/;

/** A double-quoted string with `\"` and `\\`; null when the quotes do not close the value. */
function unquote(text: string): string | null {
  let out = "";
  for (let i = 1; i < text.length; i++) {
    const char = text[i] as string;
    if (char === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
      out += text[i + 1];
      i++;
    } else if (char === '"') {
      return text.slice(i + 1).trim() === "" ? out : null;
    } else {
      out += char;
    }
  }
  return null;
}

/** A whole number only when writing it back gives the same text, so `0012` and a long hash stay text. */
function scalarOf(text: string): string | number | null {
  const trimmed = text.trim();
  if (trimmed.startsWith('"')) return unquote(trimmed);
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n) && String(n) === trimmed) return n;
  }
  return trimmed;
}

export function parseFrontmatter(text: string): Frontmatter | { problem: string } {
  const lines = text.replace(/^﻿/, "").replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trimEnd() !== "---")
    return { problem: "no frontmatter: the file does not start with ---" };
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === "---");
  if (end === -1) return { problem: "the frontmatter has no closing ---" };

  const map = new Map<string, FrontValue>();
  const raw = new Map<string, string[]>();
  const order: string[] = [];
  let listKey: string | null = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i] as string;
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const key = KEY_LINE.exec(line);
    if (key !== null) {
      const name = key[1] as string;
      if (map.has(name)) return { problem: `the frontmatter names ${name} twice` };
      const value = scalarOf(key[2] ?? "");
      if (value === null)
        return { problem: `line ${i + 1}: the quoted value of ${name} does not close` };
      map.set(name, value);
      raw.set(name, [line]);
      order.push(name);
      // Only a key written with no value can be followed by a block list.
      listKey = (key[2] ?? "").trim() === "" ? name : null;
      continue;
    }

    const item = ITEM_LINE.exec(line);
    if (item !== null && listKey !== null) {
      const content = (item[1] ?? "").trim();
      const pair = ITEM_PAIR.exec(content);
      const value = scalarOf(pair === null ? content : (pair[2] ?? ""));
      if (value === null) return { problem: `line ${i + 1}: a quoted value does not close` };
      const list = map.get(listKey);
      const items: ListItem[] = Array.isArray(list) ? list : [];
      items.push(pair === null ? String(value) : { key: pair[1] as string, value: String(value) });
      map.set(listKey, items);
      raw.get(listKey)?.push(line);
      continue;
    }

    return {
      problem: `line ${i + 1} is neither key: value, a list item nor a comment: ${clipLine(trimmed)}`,
    };
  }

  let body = lines.slice(end + 1).join("\n");
  if (body.endsWith("\n")) body = body.slice(0, -1);
  return { map, order, body, raw };
}

/** A line of a file, short enough to quote in a problem: 60 characters and an ellipsis. */
const clipLine = (line: string): string => clip(line, 61, "…");

const quote = (value: string) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

/** Plain where a plain scalar reads back as the same text, quoted otherwise. */
function scalar(value: string): string {
  return /^[A-Za-z0-9][^"\\\n]*$/.test(value) && value === value.trim() ? value : quote(value);
}

function document(lines: string[], body: string): string {
  return `---\n${lines.join("\n")}\n---\n${body === "" ? "" : `${body}\n`}`;
}

// --- Reading the fields -----------------------------------------------------------

/** Collects the first failures of one file; the row keeps what could be read. */
class Reader {
  readonly problems: string[] = [];
  constructor(private readonly front: Frontmatter) {}

  text(key: string): string | null {
    const value = this.front.map.get(key);
    if (value === undefined) return null;
    if (Array.isArray(value)) {
      this.problems.push(`${key} must be one value, not a list`);
      return null;
    }
    return String(value);
  }

  /** A whole number of at least `min`, or null with a problem. Absent is null without one. */
  whole(key: string, min: number, required: boolean): number | null {
    const value = this.front.map.get(key);
    if (value === undefined) {
      if (required) this.problems.push(`${key} is missing`);
      return null;
    }
    if (typeof value === "number" && value >= min) return value;
    this.problems.push(`${key} must be a whole number from ${min}`);
    return null;
  }

  /** `true` or `false`; absent is false. Any other value is false with a problem. */
  flag(key: string): boolean {
    const value = this.text(key);
    if (value === null || value === "false") return false;
    if (value === "true") return true;
    this.problems.push(`${key} must be true or false`);
    return false;
  }

  /** A block list of entry ids; absent is none. A scalar, or an item that is not an id, is a problem. */
  ids(key: string): string[] {
    const value = this.front.map.get(key);
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.problems.push(`${key} must be a list of entry ids, one - <id> line each`);
      return [];
    }
    const ids = value.filter((item): item is string => typeof item === "string" && UUID.test(item));
    if (ids.length !== value.length)
      this.problems.push(`${key} holds an item that is not an entry id`);
    return ids;
  }

  /** The lines of every key outside `known`, in the file's order. */
  extra(known: readonly string[]): string[] {
    return this.front.order
      .filter((key) => !known.includes(key))
      .flatMap((key) => this.front.raw.get(key) ?? []);
  }
}

interface Catalogued {
  title: string;
  kind: string;
  area: string;
  context: string;
  subject: string;
  status: string;
}

/** The fields an entry and a proposal share, checked the same way. */
function catalogued(reader: Reader, fallbackTitle: string, taxonomy: Taxonomy | null): Catalogued {
  const problems = reader.problems;
  let title = reader.text("title") ?? "";
  if (title === "") {
    problems.push("title is missing");
    title = fallbackTitle;
  } else if (title.length > TITLE_MAX) {
    problems.push(`title is over ${TITLE_MAX} characters`);
  }

  let kind = reader.text("kind") ?? "";
  if (!KINDS.test(kind)) {
    problems.push(kind === "" ? "kind is missing" : `kind ${clipLine(kind)} is not a kind`);
    kind = "knowledge";
  }

  const area = reader.text("area") ?? "";
  if (area === "") problems.push("area is missing");
  else if (taxonomy !== null && !taxonomy.areas.some((known) => known.id === area)) {
    problems.push(`area ${clipLine(area)} is not in the taxonomy`);
  }

  const free = (key: "context" | "subject") => {
    const value = reader.text(key) ?? "";
    if (value.length > FIELD_MAX) problems.push(`${key} is over ${FIELD_MAX} characters`);
    return value;
  };
  const context = free("context");
  const subject = free("subject");

  let status = reader.text("status") ?? "";
  if (!STATUSES.test(status)) {
    problems.push(
      status === "" ? "status is missing" : `status ${clipLine(status)} is not a status`,
    );
    status = "draft";
  }
  return { title, kind, area, context, subject, status };
}

const titleFromName = (name: string) => name.replace(/\.md$/, "").replaceAll("-", " ");

const overCap = (text: string) =>
  Buffer.byteLength(text) > ENTRY_MAX_BYTES
    ? "the file is over 256 KiB, the cap for one file; it was not read"
    : null;

// --- An entry ---------------------------------------------------------------------

export const ENTRY_KEYS = [
  "id",
  "title",
  "kind",
  "area",
  "context",
  "subject",
  "status",
  "author",
  "version",
  "created",
  "updated",
  "supersedes",
  "pinned",
] as const;

/** The row of a file that could not be read as an entry: listed by its name, with why. */
export function unreadEntry(slug: string, problem: string): KnowledgeEntry {
  return {
    id: "",
    slug,
    title: titleFromName(slug),
    kind: "knowledge",
    area: "",
    context: "",
    subject: "",
    status: "draft",
    author: "",
    version: 0,
    created: null,
    updated: null,
    supersedes: null,
    pinned: false,
    body: "",
    extra: [],
    problem,
  };
}

/** `taxonomy` null skips the area check: for a caller that has no root repository to ask. */
export function parseEntry(text: string, slug: string, taxonomy: Taxonomy | null): KnowledgeEntry {
  const tooBig = overCap(text);
  if (tooBig !== null) return unreadEntry(slug, tooBig);
  const front = parseFrontmatter(text);
  if ("problem" in front) return unreadEntry(slug, front.problem);

  const reader = new Reader(front);
  let id = reader.text("id") ?? "";
  if (!UUID.test(id)) {
    reader.problems.push(id === "" ? "id is missing" : "id is not a UUID");
    id = "";
  }
  const fields = catalogued(reader, titleFromName(slug), taxonomy);
  const version = reader.whole("version", 1, true) ?? 0;
  const entry: KnowledgeEntry = {
    id,
    slug,
    ...fields,
    author: reader.text("author") ?? "",
    version,
    created: reader.text("created"),
    updated: reader.text("updated"),
    supersedes: reader.text("supersedes"),
    pinned: reader.flag("pinned"),
    body: front.body,
    extra: reader.extra(ENTRY_KEYS),
    problem: null,
  };
  if (reader.problems.length === 0) return entry;
  // Listed, never counted active: a file with a problem is a draft whatever it says.
  return { ...entry, status: "draft", problem: reader.problems.join("; ") };
}

export function renderEntry(entry: KnowledgeEntry): string {
  const lines = [
    `id: ${scalar(entry.id)}`,
    `title: ${quote(entry.title)}`,
    `kind: ${scalar(entry.kind)}`,
    `area: ${scalar(entry.area)}`,
    `context: ${quote(entry.context)}`,
    `subject: ${quote(entry.subject)}`,
    `status: ${scalar(entry.status)}`,
    `author: ${quote(entry.author)}`,
    `version: ${entry.version}`,
  ];
  if (entry.created !== null) lines.push(`created: ${scalar(entry.created)}`);
  if (entry.updated !== null) lines.push(`updated: ${scalar(entry.updated)}`);
  if (entry.supersedes !== null) lines.push(`supersedes: ${scalar(entry.supersedes)}`);
  // An entry that is not pinned says nothing: the files of part 1 stay as they were.
  if (entry.pinned) lines.push("pinned: true");
  return document([...lines, ...entry.extra], entry.body);
}

// --- A proposal -------------------------------------------------------------------

export const PROPOSAL_KEYS = [
  "id",
  "entry",
  "slug",
  "base_version",
  "base_hash",
  "proposed_by",
  "proposed_at",
  "title",
  "kind",
  "area",
  "context",
  "subject",
  "status",
  "decision",
  "decided_by",
  "decided_at",
  "decided_version",
  "contradicts",
  "on_behalf_of",
  "judged_by",
  "judge_version",
] as const;

/** The row of a file that could not be read as a proposal. */
export function unreadProposal(fileName: string, problem: string): KnowledgeProposal {
  return {
    id: "",
    entryId: "",
    slug: "",
    baseVersion: 0,
    baseHash: "",
    proposedBy: "",
    proposedAt: null,
    title: titleFromName(fileName),
    kind: "knowledge",
    area: "",
    context: "",
    subject: "",
    status: "draft",
    body: "",
    decision: null,
    decidedBy: null,
    decidedAt: null,
    decidedVersion: null,
    contradicts: [],
    onBehalfOf: null,
    judgedBy: null,
    judgeVersion: null,
    extra: [],
    problem,
  };
}

export function parseProposal(
  text: string,
  fileName: string,
  taxonomy: Taxonomy | null,
): KnowledgeProposal {
  const tooBig = overCap(text);
  if (tooBig !== null) return unreadProposal(fileName, tooBig);
  const front = parseFrontmatter(text);
  if ("problem" in front) return unreadProposal(fileName, front.problem);

  const reader = new Reader(front);
  const problems = reader.problems;
  let id = reader.text("id") ?? "";
  if (!UUID.test(id)) {
    problems.push(id === "" ? "id is missing" : "id is not a UUID");
    id = "";
  }
  // Kept as written even when malformed: the accept names it when it refuses.
  const entryId = reader.text("entry") ?? "";
  if (!UUID.test(entryId))
    problems.push(entryId === "" ? "entry is missing" : "entry is not a UUID");
  const slug = reader.text("slug") ?? "";
  if (!SLUG.test(slug) || slug.length > SLUG_MAX) {
    problems.push(slug === "" ? "slug is missing" : "slug is not a slug");
  }
  const baseVersion = reader.whole("base_version", 0, true) ?? 0;
  const proposedBy = reader.text("proposed_by") ?? "";
  if (proposedBy === "") problems.push("proposed_by is missing");
  const fields = catalogued(reader, titleFromName(fileName), taxonomy);

  const decided = reader.text("decision");
  let decision: KnowledgeProposal["decision"] = null;
  if (decided === "accepted" || decided === "rejected") decision = decided;
  else if (decided !== null)
    problems.push(`decision ${clipLine(decided)} is neither accepted nor rejected`);

  const proposal: KnowledgeProposal = {
    id,
    entryId,
    slug,
    baseVersion,
    baseHash: reader.text("base_hash") ?? "",
    proposedBy,
    proposedAt: reader.text("proposed_at"),
    ...fields,
    body: front.body,
    decision,
    decidedBy: reader.text("decided_by"),
    decidedAt: reader.text("decided_at"),
    decidedVersion: reader.whole("decided_version", 1, false),
    contradicts: reader.ids("contradicts"),
    onBehalfOf: reader.text("on_behalf_of"),
    judgedBy: reader.text("judged_by"),
    judgeVersion: reader.text("judge_version"),
    extra: reader.extra(PROPOSAL_KEYS),
    problem: null,
  };
  return problems.length === 0 ? proposal : { ...proposal, problem: problems.join("; ") };
}

export function renderProposal(proposal: KnowledgeProposal): string {
  const lines = [
    `id: ${scalar(proposal.id)}`,
    `entry: ${scalar(proposal.entryId)}`,
    `slug: ${scalar(proposal.slug)}`,
    `base_version: ${proposal.baseVersion}`,
    `base_hash: ${scalar(proposal.baseHash)}`,
    `proposed_by: ${scalar(proposal.proposedBy)}`,
  ];
  if (proposal.proposedAt !== null) lines.push(`proposed_at: ${scalar(proposal.proposedAt)}`);
  lines.push(
    `title: ${quote(proposal.title)}`,
    `kind: ${scalar(proposal.kind)}`,
    `area: ${scalar(proposal.area)}`,
    `context: ${quote(proposal.context)}`,
    `subject: ${quote(proposal.subject)}`,
    `status: ${scalar(proposal.status)}`,
  );
  // What the agent's proposal records, each only when it is set: a person's proposal file
  // reads as part 1 wrote it.
  if (proposal.onBehalfOf !== null) lines.push(`on_behalf_of: ${quote(proposal.onBehalfOf)}`);
  if (proposal.judgedBy !== null) lines.push(`judged_by: ${scalar(proposal.judgedBy)}`);
  if (proposal.judgeVersion !== null) lines.push(`judge_version: ${quote(proposal.judgeVersion)}`);
  if (proposal.contradicts.length > 0) {
    lines.push("contradicts:", ...proposal.contradicts.map((id) => `  - ${id}`));
  }
  if (proposal.decision !== null) lines.push(`decision: ${proposal.decision}`);
  if (proposal.decidedBy !== null) lines.push(`decided_by: ${quote(proposal.decidedBy)}`);
  if (proposal.decidedAt !== null) lines.push(`decided_at: ${scalar(proposal.decidedAt)}`);
  if (proposal.decidedVersion !== null) lines.push(`decided_version: ${proposal.decidedVersion}`);
  return document([...lines, ...proposal.extra], proposal.body);
}

// --- The taxonomy -----------------------------------------------------------------

export function parseTaxonomy(text: string): Taxonomy | { problem: string } {
  const tooBig = overCap(text);
  if (tooBig !== null) return { problem: tooBig };
  const front = parseFrontmatter(text);
  if ("problem" in front) return front;

  const reader = new Reader(front);
  const version = reader.whole("version", 1, true);
  const updated = reader.text("updated");
  if (updated === null) reader.problems.push("updated is missing");
  const list = front.map.get("areas");
  const areas: Taxonomy["areas"] = [];
  if (!Array.isArray(list)) reader.problems.push("areas must be a list of - id: Label items");
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item === "string") {
      reader.problems.push(`area ${clipLine(item)} has no label`);
      continue;
    }
    const { key: id, value: label } = item;
    if (!AREA_ID.test(id) || id.length > AREA_MAX) {
      reader.problems.push(`area id ${clipLine(id)} is not an area id`);
    } else if (label.length === 0 || label.length > LABEL_MAX) {
      reader.problems.push(`the label of ${id} must have 1 to ${LABEL_MAX} characters`);
    } else if (areas.some((known) => known.id === id)) {
      reader.problems.push(`area ${id} is listed twice`);
    } else {
      areas.push({ id, label });
    }
  }
  if (reader.problems.length > 0 || version === null || updated === null) {
    return { problem: reader.problems.join("; ") };
  }
  return { version, updated, areas };
}

export function renderTaxonomy(taxonomy: Taxonomy): string {
  return document(
    [
      `version: ${taxonomy.version}`,
      `updated: ${scalar(taxonomy.updated)}`,
      "areas:",
      ...taxonomy.areas.map((area) => `  - ${area.id}: ${scalar(area.label)}`),
    ],
    "",
  );
}
