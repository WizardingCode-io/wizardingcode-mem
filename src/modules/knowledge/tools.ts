import { resolveProject } from "../../core/project.ts";
import type { ModuleTool, ToolMode } from "../../engine/module.ts";
import { type Db, openDb } from "../../store/db.ts";
import { resolvePaths } from "../../util/paths.ts";
import {
  folderProblem,
  KINDS,
  type KnowledgeEntry,
  knowledgeDir,
  STATUSES,
  slugify,
} from "./files.ts";
import { entriesBySlug, listEntries, refreshIndex, searchKnowledge } from "./index-store.ts";
import {
  checkSlug,
  editEntry,
  type FieldChanges,
  prepareFolder,
  readForEdit,
  renderEntry,
  replaceEntry,
  today,
  writeNewEntry,
} from "./write.ts";

// Knowledge's tools for the agent, inside a project only (knowledge lives in a project's
// repository): search and read the entries, and write one when the author asks. Search and
// read go through the index, refreshed first if the folder changed; writes go to the files,
// which are the truth, and the index follows at once.

export const KNOWLEDGE_TOOL_NAMES = [
  "knowledge_search",
  "knowledge_get",
  "knowledge_save",
  "knowledge_update",
] as const;
type Name = (typeof KNOWLEDGE_TOOL_NAMES)[number];

export interface KnowledgeContext {
  db: Db;
  projectId: number;
  /** The project's working tree root: its knowledge is in `<root>/.wizardingcode/knowledge`. */
  root: string;
  now: number;
  /** Where the home folder and the brand's home are; the process's environment by default. */
  env?: Record<string, string | undefined>;
}

/** Why knowledge is not read or written for this project, or null. */
const problemOf = (ctx: KnowledgeContext) => folderProblem(ctx.root, ctx.env ?? process.env);

const DEFAULT_LIMIT = 10;

/** Brings the index in line with the folder; nothing is read when it has not changed. */
function fresh(ctx: KnowledgeContext): string {
  const dir = knowledgeDir(ctx.root);
  refreshIndex(ctx.db, ctx.projectId, dir);
  return dir;
}

function heading(entry: KnowledgeEntry): string {
  const marks = [entry.kind, entry.status, ...(entry.essential ? ["essential"] : [])];
  return `- ${entry.slug}: ${entry.title} (${marks.join(", ")})`;
}

export function searchEntries(
  ctx: KnowledgeContext,
  args: { query: string; limit?: number },
): string {
  const problem = problemOf(ctx);
  if (problem !== null) return problem;
  fresh(ctx);
  const limit = args.limit ?? DEFAULT_LIMIT;
  const found =
    args.query.trim() === ""
      ? listEntries(ctx.db, ctx.projectId, limit)
      : searchKnowledge(ctx.db, ctx.projectId, args.query, limit, { prefix: true });
  if (found.length === 0) {
    return args.query.trim() === ""
      ? "This project has no knowledge entries (.wizardingcode/knowledge)."
      : "No knowledge entry matches.";
  }
  return `${found.map(heading).join("\n")}\n\nRead one in full with knowledge_get and its slug.`;
}

function full(entry: KnowledgeEntry): string {
  const lines = [
    `# ${entry.title}`,
    `slug: ${entry.slug}`,
    `kind: ${entry.kind}; status: ${entry.status}${entry.essential ? "; essential" : ""}`,
    ...(entry.tags.length > 0 ? [`tags: ${entry.tags.join(", ")}`] : []),
    ...(entry.updated === null ? [] : [`updated: ${entry.updated}`]),
    ...(entry.source === null ? [] : [`source: ${entry.source}`]),
    `file: ${entry.path}`,
    ...(entry.problem === null ? [] : [`problem: ${entry.problem}`]),
    "",
    entry.body,
  ];
  return lines.join("\n");
}

export function getEntries(ctx: KnowledgeContext, args: { slugs: string[] }): string {
  const problem = problemOf(ctx);
  if (problem !== null) return problem;
  fresh(ctx);
  const found = new Map(
    entriesBySlug(ctx.db, ctx.projectId, args.slugs).map((entry) => [entry.slug, entry]),
  );
  return args.slugs
    .map((slug) => {
      const entry = found.get(slug);
      return entry === undefined ? `No entry "${slug}".` : full(entry);
    })
    .join("\n\n---\n\n");
}

export interface SaveArgs {
  title: string;
  kind: string;
  body: string;
  essential?: boolean;
  tags?: string[];
  /** The file name without .md; from the title when left out. */
  slug?: string;
}

export function saveEntry(ctx: KnowledgeContext, args: SaveArgs): string {
  const problem = problemOf(ctx);
  if (problem !== null) return `${problem} Nothing was written.`;
  let slug: string;
  if (args.slug === undefined) slug = slugify(args.title);
  else {
    const checked = checkSlug(args.slug);
    if ("refused" in checked) return checked.refused;
    slug = checked.slug;
  }
  const prepared = prepareFolder(ctx.root, ctx.env ?? process.env);
  if ("refused" in prepared) return prepared.refused;
  const { dir } = prepared;
  const text = renderEntry(
    {
      title: args.title,
      kind: args.kind,
      essential: args.essential ?? false,
      status: "active",
      tags: args.tags ?? [],
      updated: today(ctx.now),
    },
    args.body,
  );
  const result = writeNewEntry(dir, slug, text);
  if ("exists" in result) {
    const existing = result.exists.slice(0, -".md".length);
    return `An entry named "${existing}" already exists; nothing was written. Change it with knowledge_update (slug "${existing}"), or save under another slug.`;
  }
  if ("refused" in result) return result.refused;
  refreshIndex(ctx.db, ctx.projectId, dir, { force: true });
  return `Saved as ${slug}: ${result.path}`;
}

export interface UpdateArgs {
  slug: string;
  title?: string;
  kind?: string;
  body?: string;
  essential?: boolean;
  status?: string;
  tags?: string[];
}

export function updateEntry(ctx: KnowledgeContext, args: UpdateArgs): string {
  const problem = problemOf(ctx);
  if (problem !== null) return `${problem} Nothing was written.`;
  const checked = checkSlug(args.slug);
  if ("refused" in checked) return checked.refused;
  const dir = knowledgeDir(ctx.root);
  const read = readForEdit(dir, checked.slug);
  if ("refused" in read) {
    return read.refused === "missing"
      ? `No entry "${checked.slug}"; nothing was written. Create one with knowledge_save.`
      : `${read.refused} Nothing was written.`;
  }
  const changes: FieldChanges = {
    title: args.title,
    kind: args.kind,
    essential: args.essential,
    status: args.status,
    tags: args.tags,
    updated: today(ctx.now),
  };
  const edited = editEntry(read.text, changes, args.body);
  if ("refused" in edited) return edited.refused;
  const result = replaceEntry(dir, checked.slug, edited.text);
  if ("refused" in result) return result.refused;
  refreshIndex(ctx.db, ctx.projectId, dir, { force: true });
  return `Updated ${checked.slug}: ${result.path}`;
}

/** Tool argument schemas; zod is loaded here and nowhere a hook runs. */
async function schemas() {
  const { z } = await import("zod");
  const kind = z.enum(KINDS);
  const tags = z.array(z.string().max(60)).max(20);
  const slug = z.string().max(200).describe("The entry's file name without .md.");
  return {
    knowledge_search: z.object({
      query: z
        .string()
        .max(500)
        .describe(
          "Words, names or file names; their other forms are found too. Empty lists the entries.",
        ),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    knowledge_get: z.object({ slugs: z.array(slug).min(1).max(20) }),
    knowledge_save: z.object({
      title: z.string().min(1).max(200).describe("One line; it also names the file."),
      kind,
      body: z
        .string()
        .min(1)
        .max(50_000)
        .describe("Markdown: the why, the consequences, links to code."),
      essential: z
        .boolean()
        .optional()
        .describe("Shown at every session start; for the few that always matter."),
      tags: tags.optional(),
      slug: slug.optional().describe("The file name without .md; from the title when left out."),
    }),
    knowledge_update: z.object({
      slug,
      title: z.string().min(1).max(200).optional(),
      kind: kind.optional(),
      body: z.string().min(1).max(50_000).optional().describe("Replaces the whole body."),
      essential: z.boolean().optional(),
      status: z.enum(STATUSES).optional().describe("superseded when it no longer holds."),
      tags: tags.optional().describe("Replaces the tags."),
    }),
  };
}

const DESCRIPTIONS: Record<Name, string> = {
  knowledge_search:
    "Search this project's curated knowledge (decisions, rules, glossary, architecture, how-tos kept in its repository), by words and their forms; returns one heading per entry.",
  knowledge_get: "Read knowledge entries in full, by the slugs that knowledge_search returned.",
  knowledge_save:
    "Write a new knowledge entry into the project's repository (.wizardingcode/knowledge), only when the user asks to keep something as knowledge; never replaces an existing entry.",
  knowledge_update:
    "Change an existing knowledge entry's fields or body (for example mark it superseded), only when the user asks.",
};

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const META: Record<Name, Pick<ModuleTool, "title" | "annotations">> = {
  knowledge_search: { title: "Search knowledge", annotations: READ },
  knowledge_get: { title: "Read knowledge", annotations: READ },
  knowledge_save: {
    title: "Save knowledge",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  knowledge_update: {
    title: "Update knowledge",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
};

/** Runs one validated call for the project at `projectDir`, against a freshly opened database. */
function runTool(name: Name, args: unknown, projectDir: string): string {
  const { storeDir } = resolvePaths();
  const db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  try {
    const now = Date.now();
    const project = resolveProject(db, projectDir, now);
    if (project.disabled) return "wizardingcode-mem is turned off for this project.";
    const ctx: KnowledgeContext = { db, projectId: project.id, root: project.root, now };
    switch (name) {
      case "knowledge_search":
        return searchEntries(ctx, args as Parameters<typeof searchEntries>[1]);
      case "knowledge_get":
        return getEntries(ctx, args as Parameters<typeof getEntries>[1]);
      case "knowledge_save":
        return saveEntry(ctx, args as SaveArgs);
      case "knowledge_update":
        return updateEntry(ctx, args as UpdateArgs);
    }
  } finally {
    db.close();
  }
}

/** Inside a project, the four tools; with no project folder, none (knowledge is per project). */
export async function knowledgeTools(mode: ToolMode): Promise<ModuleTool[]> {
  if (mode === "global") return [];
  const schema = await schemas();
  return KNOWLEDGE_TOOL_NAMES.map((name) => ({
    name,
    ...META[name],
    description: DESCRIPTIONS[name],
    inputSchema: schema[name],
    run: (args, call) => runTool(name, args, call.projectDir ?? process.cwd()),
  }));
}
