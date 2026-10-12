import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { KNOWLEDGE_FILE_MAX_BYTES } from "./files.ts";

// Writing knowledge files for the agent: names that cannot leave the folder, frontmatter
// the parser in files.ts reads back as written, and atomic writes (a hidden temp file in
// the folder, then a link or a rename) so that nobody ever sees half an entry. A new entry
// never replaces a file; a changed one keeps whatever the author wrote that is not changed.

const MAX_SLUG = 80;
/** Names Windows will not create as files, whatever the extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * An entry's name as the agent gave it, if it is a plain file name in the folder: letters,
 * digits, `-` and `_`, starting with a letter or digit, at most 80 characters, not a name
 * Windows reserves. Nothing else is accepted, so there is nothing to normalise silently: no
 * separators, no dots (`..`, a hidden file, a trailing dot), no characters Windows refuses.
 */
export function checkSlug(raw: string): { slug: string } | { refused: string } {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(raw) || raw.length > MAX_SLUG || RESERVED.test(raw)) {
    return {
      refused: `"${raw}" is not a usable slug: use letters, digits, - and _ only (at most ${MAX_SLUG}), the file name without .md.`,
    };
  }
  return { slug: raw };
}

/** The entry's file; throws if it would not sit directly in the folder (a last guard). */
export function entryPath(dir: string, slug: string): string {
  const path = join(dir, `${slug}.md`);
  if (dirname(resolve(path)) !== resolve(dir)) throw new Error(`slug ${slug} leaves the folder`);
  return path;
}

/** `YYYY-MM-DD` in local time: the day the author sees. */
export function today(now: number): string {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A title on one line, double-quoted: nothing in it reads as a comment, a list or a key. */
export function quoted(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return `"${line.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Tags as a flow list; what would break the list (commas, brackets, quotes, `#`) becomes a space. */
export function tagList(tags: readonly string[]): string {
  const clean = tags
    .map((tag) =>
      tag
        .toLowerCase()
        .replace(/[,[\]"'#\\]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((tag) => tag !== "");
  return `[${[...new Set(clean)].join(", ")}]`;
}

/** The frontmatter lines a change sets, keyed by field, in the order a new entry lists them. */
export interface FieldChanges {
  title?: string;
  kind?: string;
  essential?: boolean;
  status?: string;
  tags?: readonly string[];
  updated?: string;
  source?: string;
}

const ORDER = ["title", "kind", "essential", "status", "tags", "updated", "source"] as const;

function fieldLines(changes: FieldChanges): Map<string, string> {
  const lines = new Map<string, string>();
  for (const key of ORDER) {
    const value = changes[key];
    if (value === undefined) continue;
    if (key === "title" || key === "source") lines.set(key, `${key}: ${quoted(value as string)}`);
    else if (key === "tags") lines.set(key, `tags: ${tagList(value as readonly string[])}`);
    else lines.set(key, `${key}: ${String(value)}`);
  }
  return lines;
}

/** A new entry's text: its frontmatter, then the body. */
export function renderEntry(changes: FieldChanges, body: string): string {
  return `---\n${[...fieldLines(changes).values()].join("\n")}\n---\n${body.trim()}\n`;
}

/**
 * The entry's text with the given fields changed in place (a key's block list goes with
 * it) and the others appended; every other line, comments and unknown keys included, kept
 * as written. The body is replaced when one is given. A file with no frontmatter gets one,
 * its text kept as the body.
 */
export function editEntry(text: string, changes: FieldChanges, body?: string): string {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  let front: string[] = [];
  let rest: string;
  const end =
    lines[0]?.trimEnd() === "---"
      ? lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line))
      : -1;
  if (end !== -1) {
    front = lines.slice(1, end);
    rest = lines.slice(end + 1).join("\n");
  } else {
    rest = lines.join("\n");
  }
  const wanted = fieldLines(changes);
  const kept: string[] = [];
  let skipping = false;
  for (const line of front) {
    const key = /^([A-Za-z_][\w-]*)\s*:/.exec(line)?.[1]?.toLowerCase();
    if (key !== undefined) {
      skipping = false;
      const replacement = wanted.get(key);
      if (replacement !== undefined) {
        kept.push(replacement);
        wanted.delete(key);
        skipping = true; // its block list items, if any, follow
        continue;
      }
    } else if (skipping && /^(\s+-|-\s|\s+\S)/.test(line)) {
      continue;
    } else {
      skipping = false;
    }
    kept.push(line);
  }
  kept.push(...wanted.values());
  const newBody = body === undefined ? rest : `${body.trim()}\n`;
  return `---\n${kept.join("\n")}\n---\n${newBody}`;
}

export type WriteResult = { path: string } | { refused: string };
/** A new entry's result: also the file already there under its name. */
export type NewResult = WriteResult | { exists: string };

const NOT_WRITABLE = new Set(["EACCES", "EPERM", "EROFS"]);

function failure(error: unknown, dir: string): WriteResult {
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && NOT_WRITABLE.has(code)) {
    return { refused: `The knowledge folder ${dir} is not writable; nothing was written.` };
  }
  throw error;
}

/** Writes `text` to a hidden temp file in the folder, flushed; returns its path. */
function tempFile(dir: string, slug: string, text: string): string {
  const temp = join(dir, `.${slug}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  const fd = openSync(temp, "wx", 0o644);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return temp;
}

/** The entry file already there under this name, in any case (case-insensitive disks). */
function existing(dir: string, slug: string): string | null {
  const wanted = `${slug}.md`.toLowerCase();
  try {
    return readdirSync(dir).find((name) => name.toLowerCase() === wanted) ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes a new entry, never over an existing file: refused when one has the name (in any
 * case). The temp file is linked into place, which fails rather than replace a file that
 * appeared meanwhile; where links are not supported, it is renamed after a last check.
 */
export function writeNewEntry(dir: string, slug: string, text: string): NewResult {
  const path = entryPath(dir, slug);
  let temp: string | null = null;
  try {
    mkdirSync(dir, { recursive: true });
    const taken = existing(dir, slug);
    if (taken !== null) return { exists: taken };
    temp = tempFile(dir, slug, text);
    try {
      linkSync(temp, path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return { exists: existing(dir, slug) ?? `${slug}.md` };
      if (code !== "ENOTSUP" && code !== "EOPNOTSUPP" && code !== "EXDEV" && code !== "EPERM") {
        throw error;
      }
      const taken = existing(dir, slug);
      if (taken !== null) return { exists: taken };
      renameSync(temp, path);
      temp = null;
    }
    return { path };
  } catch (error) {
    return failure(error, dir);
  } finally {
    if (temp !== null) rmSync(temp, { force: true });
  }
}

/**
 * The text of an existing entry, if it is a regular file in the folder (not a link, not
 * over 256 KiB); otherwise why it cannot be changed.
 */
export function readForEdit(dir: string, slug: string): { text: string } | { refused: string } {
  const path = entryPath(dir, slug);
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(path);
  } catch {
    return { refused: "missing" };
  }
  if (stat.isSymbolicLink()) {
    return { refused: `${path} is a link; change the file it points to by hand.` };
  }
  if (!stat.isFile()) return { refused: `${path} is not a file.` };
  if (stat.size > KNOWLEDGE_FILE_MAX_BYTES) {
    return { refused: `${path} is larger than 256 KiB; change it by hand.` };
  }
  return { text: readFileSync(path, "utf8") };
}

/** Replaces an existing entry's file atomically: temp file, then rename over it. */
export function replaceEntry(dir: string, slug: string, text: string): WriteResult {
  const path = entryPath(dir, slug);
  let temp: string | null = null;
  try {
    temp = tempFile(dir, slug, text);
    renameSync(temp, path);
    temp = null;
    return { path };
  } catch (error) {
    return failure(error, dir);
  } finally {
    if (temp !== null) rmSync(temp, { force: true });
  }
}
