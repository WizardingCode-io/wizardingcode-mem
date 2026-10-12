import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, sep } from "node:path";

// Knowledge entries as files (K1, K2): one Markdown file per entry in the project's
// `.wizardingcode/knowledge` folder, frontmatter first. The files are the truth and are
// written by people, so reading them never throws: a file that cannot be understood is
// still listed, by its name and body, with the reason in `problem`.

export const KINDS = ["decision", "rule", "glossary", "architecture", "howto"] as const;
export const STATUSES = ["active", "draft", "superseded"] as const;
export type KnowledgeKind = (typeof KINDS)[number];
export type KnowledgeStatus = (typeof STATUSES)[number];

export interface KnowledgeEntry {
  /** The file name without `.md`: the entry's identity in its project. */
  slug: string;
  /** The file, as found in the folder (not resolved through links). */
  path: string;
  title: string;
  kind: KnowledgeKind;
  /** Shown at session start. */
  essential: boolean;
  /** Only active entries are ever put in front of the agent. */
  status: KnowledgeStatus;
  tags: string[];
  /** As written, `YYYY-MM-DD`. */
  updated: string | null;
  /** What it was promoted from, e.g. `memory:1234`. */
  source: string | null;
  body: string;
  /** Why the file was not fully understood (shown in doctor and the viewer); null when it was. */
  problem: string | null;
}

/** Larger files are listed, flagged and not read. */
export const KNOWLEDGE_FILE_MAX_BYTES = 256 * 1024;
/** A folder is read up to this many entries, in name order. */
const MAX_FILES = 2000;
const MAX_SLUG = 80;
/** Names Windows will not create as files, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** Where a project's knowledge lives: `<root>/.wizardingcode/knowledge`. */
export function knowledgeDir(projectRoot: string): string {
  return join(projectRoot, ".wizardingcode", "knowledge");
}

/**
 * A file name for a title: lower case ASCII letters and digits joined by hyphens, accents
 * folded, at most 80 characters, never empty, never a name Windows reserves. Nothing in it
 * can leave the folder (no separators, no dots).
 */
export function slugify(title: string): string {
  let slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SLUG) {
    const cut = slug.slice(0, MAX_SLUG);
    const hyphen = cut.lastIndexOf("-");
    slug = (hyphen > MAX_SLUG / 2 ? cut.slice(0, hyphen) : cut).replace(/-+$/, "");
  }
  if (slug === "") return "entry";
  return RESERVED.test(slug) ? `${slug}-entry` : slug;
}

/** The entry files' names, in order: visible `*.md` names only. */
function entryNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith(".") && name.length > 3)
    .sort()
    .slice(0, MAX_FILES);
}

/**
 * What the folder looks like, cheaply: the entry files' count, total size and newest
 * mtime, and the folder's own mtime (which a rename or a deletion changes). Null when the
 * folder does not exist or cannot be read. Equal fingerprints mean the index is current.
 */
export function fingerprint(dir: string): string | null {
  try {
    const folder = statSync(dir);
    if (!folder.isDirectory()) return null;
    let count = 0;
    let size = 0;
    let newest = 0;
    for (const name of entryNames(dir)) {
      try {
        const file = statSync(join(dir, name));
        if (!file.isFile()) continue;
        count++;
        size += file.size;
        newest = Math.max(newest, file.mtimeMs);
      } catch {
        // A dangling link, or a file removed meanwhile: not an entry.
      }
    }
    return `${count}:${size}:${newest}:${folder.mtimeMs}`;
  } catch {
    return null;
  }
}

/** The title an entry gets from its file name alone. */
const nameTitle = (slug: string) => slug.replace(/[-_]+/g, " ").trim() || slug;

function flagged(dir: string, name: string, slug: string, problem: string): KnowledgeEntry {
  // Not read, so not trusted with "active": never put in front of the agent.
  return {
    slug,
    path: join(dir, name),
    title: nameTitle(slug),
    kind: "decision",
    essential: false,
    status: "draft",
    tags: [],
    updated: null,
    source: null,
    body: "",
    problem,
  };
}

type Read = { text: string; problem: string | null } | { refused: string } | null;

/** The file's text, or why it was not read; null when it is not an entry file at all. */
function readInside(realDir: string, full: string): Read {
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    return null; // a dangling link
  }
  if (!real.startsWith(realDir + sep)) {
    return { refused: "the file is a link to outside the knowledge folder; not read" };
  }
  // Only a regular file is opened: opening a FIFO would block the hook until a writer came,
  // and a folder cannot be opened on Windows.
  if (!statSync(real).isFile()) return null;
  // Non-blocking and not through a link, should the path change between the checks (the
  // flags are absent on Windows, where neither applies).
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(real, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const tooLarge = "the file is larger than 256 KiB; not read";
    if (stat.size > KNOWLEDGE_FILE_MAX_BYTES) return { refused: tooLarge };
    const buffer = new Uint8Array(KNOWLEDGE_FILE_MAX_BYTES + 1);
    let length = 0;
    for (;;) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
      if (length > KNOWLEDGE_FILE_MAX_BYTES) return { refused: tooLarge };
    }
    const bytes = buffer.subarray(0, length);
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), problem: null };
    } catch {
      return {
        text: new TextDecoder("utf-8").decode(bytes),
        problem: "the file is not valid UTF-8; unreadable bytes were replaced",
      };
    }
  } finally {
    closeSync(fd);
  }
}

// ---- Frontmatter: a small subset of YAML, the one the entry format uses. ----
// `key: value` lines; values plain, single- or double-quoted, or a flow list `[a, b]`;
// a key with no value followed by `- item` lines is a block list; `# comment` after a
// space is dropped; blank and comment lines are skipped. Anything else is a problem.

type Value = string | string[];

function unquote(raw: string): string | null {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw
      .slice(1, -1)
      .replace(/\\(["\\nt])/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  if (raw.startsWith('"') || raw.startsWith("'")) return null; // a quote never closed
  return raw;
}

/** The value with a trailing comment removed; quotes protect a `#`. */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as string;
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && (i === 0 || /\s|\[|,/.test(raw[i - 1] as string))) {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(raw[i - 1] as string))) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function scalar(raw: string): string | null {
  return unquote(raw.trim());
}

function flowList(raw: string): string[] | null {
  const inner = raw.slice(1, -1).trim();
  if (inner === "") return [];
  const items: string[] = [];
  for (const part of inner.split(",")) {
    const item = scalar(part);
    if (item === null) return null;
    items.push(item);
  }
  return items;
}

/** The keys and values, or the number (1-based, within the frontmatter) of the line that is not understood. */
function parseFrontmatter(lines: string[]): Map<string, Value> | number {
  const fields = new Map<string, Value>();
  let listKey: string | null = null;
  for (const [i, line] of lines.entries()) {
    const content = stripComment(line);
    if (content.trim() === "") continue;
    const item = /^\s+-\s*(.*)$/.exec(content) ?? /^-\s+(.*)$/.exec(content);
    if (item !== null && listKey !== null) {
      const value = scalar(item[1] as string);
      if (value === null) return i + 1;
      (fields.get(listKey) as string[]).push(value);
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:(?:\s+(.*))?$/.exec(content);
    if (pair === null) return i + 1;
    const key = (pair[1] as string).toLowerCase();
    const raw = (pair[2] ?? "").trim();
    listKey = null;
    if (raw === "") {
      fields.set(key, []);
      listKey = key;
    } else if (/^[|>][+-]?\d*$/.test(raw)) {
      return i + 1; // a block scalar: not part of the subset
    } else if (raw.startsWith("[") && raw.endsWith("]")) {
      const list = flowList(raw);
      if (list === null) return i + 1;
      fields.set(key, list);
    } else {
      const value = scalar(raw);
      if (value === null) return i + 1;
      fields.set(key, value);
    }
  }
  return fields;
}

/** The frontmatter's lines and the body; `open` when it starts but never closes. */
function split(text: string): { front: string[] | null; body: string; open: boolean } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trimEnd() !== "---") return { front: null, body: lines.join("\n"), open: false };
  const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  if (end === -1) return { front: null, body: lines.slice(1).join("\n"), open: true };
  return { front: lines.slice(1, end), body: lines.slice(end + 1).join("\n"), open: false };
}

const BOOLEAN = new Map([
  ["true", true],
  ["yes", true],
  ["false", false],
  ["no", false],
]);

function parseEntry(slug: string, path: string, text: string): KnowledgeEntry {
  const problems: string[] = [];
  const { front, body, open } = split(text);
  const entry: KnowledgeEntry = {
    slug,
    path,
    title: nameTitle(slug),
    kind: "decision",
    essential: false,
    status: "active",
    tags: [],
    updated: null,
    source: null,
    body: body.trim(),
    problem: null,
  };
  // Frontmatter there but unreadable may have said anything, `status: draft` included:
  // never put such an entry in front of the agent until it is fixed.
  if (open) {
    entry.status = "draft";
    problems.push("the frontmatter is never closed (no second ---); treated as a draft");
  } else if (front === null) problems.push("no frontmatter: indexed by its file name");
  const fields = front === null ? null : parseFrontmatter(front);
  if (typeof fields === "number") {
    entry.status = "draft";
    problems.push(
      `frontmatter line ${fields} is not "key: value"; indexed by its file name, treated as a draft`,
    );
  } else if (fields !== null) {
    const text = (key: string): string | null => {
      const value = fields.get(key);
      if (value === undefined) return null;
      if (typeof value !== "string") {
        problems.push(`${key} should be a single value`);
        return null;
      }
      return value.trim() === "" ? null : value.trim();
    };
    const title = text("title");
    if (title === null) problems.push("no title: named after its file");
    else entry.title = title;

    const kind = text("kind");
    if (kind === null) problems.push(`no kind (one of ${KINDS.join(", ")})`);
    else if ((KINDS as readonly string[]).includes(kind.toLowerCase())) {
      entry.kind = kind.toLowerCase() as KnowledgeKind;
    } else problems.push(`kind "${kind}" is not one of ${KINDS.join(", ")}`);

    const status = text("status");
    if (status !== null) {
      if ((STATUSES as readonly string[]).includes(status.toLowerCase())) {
        entry.status = status.toLowerCase() as KnowledgeStatus;
      } else {
        // Unclear whether it is current: never put in front of the agent until fixed.
        entry.status = "draft";
        problems.push(`status "${status}" is not one of ${STATUSES.join(", ")}`);
      }
    }

    const essential = text("essential");
    if (essential !== null) {
      const flag = BOOLEAN.get(essential.toLowerCase());
      if (flag === undefined) problems.push(`essential "${essential}" is not true or false`);
      else entry.essential = flag;
    }

    const tags = fields.get("tags");
    if (tags !== undefined) {
      const list = typeof tags === "string" ? tags.split(",") : tags;
      entry.tags = [...new Set(list.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    }

    const updated = text("updated");
    if (updated !== null) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(updated)) entry.updated = updated;
      else problems.push(`updated "${updated}" is not a date (YYYY-MM-DD)`);
    }

    entry.source = text("source");
  }
  entry.problem = problems.length === 0 ? null : problems.join("; ");
  return entry;
}

/**
 * Every entry in the folder, in file-name order. Never throws, and never reads outside
 * the folder: a link that resolves elsewhere is listed, flagged and not read, as is a file
 * over 256 KiB. Hidden files, other extensions and folders are not entries.
 */
export function readEntries(dir: string): KnowledgeEntry[] {
  let realDir: string;
  let names: string[];
  try {
    realDir = realpathSync(dir);
    if (!statSync(realDir).isDirectory()) return [];
    names = entryNames(realDir);
  } catch {
    return [];
  }
  const entries: KnowledgeEntry[] = [];
  for (const name of names) {
    const slug = name.slice(0, -3);
    const path = join(dir, name);
    try {
      const read = readInside(realDir, join(realDir, name));
      if (read === null) continue;
      if ("refused" in read) {
        entries.push(flagged(dir, name, slug, read.refused));
        continue;
      }
      const entry = parseEntry(slug, path, read.text);
      if (read.problem !== null) {
        entry.problem = entry.problem === null ? read.problem : `${read.problem}; ${entry.problem}`;
      }
      entries.push(entry);
    } catch (error) {
      entries.push(flagged(dir, name, slug, `the file could not be read: ${String(error)}`));
    }
  }
  return entries;
}
