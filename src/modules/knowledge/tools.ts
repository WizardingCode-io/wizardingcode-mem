// Knowledge's three tools, offered by the MCP server and the `tool` bridge (OpenCode) alike:
// search, read and propose. Loaded only when a server or the bridge asks; a hook never pays
// for zod, the store or the judge.
import { join } from "node:path";
import { resolveProject } from "../../core/project.ts";
import type { ModuleTool, ToolCall, ToolMode } from "../../engine/module.ts";
import { makeJudge } from "../../judge/index.ts";
import type { Judge } from "../../judge/types.ts";
import { UNKNOWN_AGENT } from "../../mcp/agent-id.ts";
import { inert } from "../../retrieve/render.ts";
import { openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { clip } from "../../util/text.ts";
import { searchTokens } from "../../util/words.ts";
import { agentWriter, personAuthor } from "./author.ts";
import { DEFAULT_AREAS, FIELD_MAX, parseTaxonomy, SLUG, TITLE_MAX } from "./entry.ts";
import { KnowledgeError } from "./errors.ts";
import {
  browseEntries,
  ensureFresh,
  entryAt,
  type Hit,
  requireKnowledgeRoot,
  searchEntries,
  taxonomyOrNull,
} from "./index-store.ts";
import {
  GET_ANSWER_MAX,
  GET_BODY_MAX,
  GET_MAX_REFS,
  PROPOSALS_PER_HOUR,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
} from "./policy.ts";
import { allowProposal, judgeProposal } from "./propose.ts";
import {
  kindAt,
  openRepo,
  readRegularFile,
  repoFolder,
  repoPath,
  TAXONOMY_FILE,
  taxonomyFor,
  withRepoLeases,
} from "./repo.ts";
import { requireSchema } from "./schema.ts";
import { checkArea, proposalBase, proposalSlug, writeEntry } from "./store.ts";
import { openStore } from "./store-open.ts";
import type { EntryChange, KnowledgeStore, ScopeRef, Taxonomy } from "./types.ts";
import { visibleRepos } from "./visible.ts";

export const KNOWLEDGE_TOOL_NAMES = [
  "knowledge_search",
  "knowledge_get",
  "knowledge_propose",
] as const;
/** Without a project folder: the workspace's and the shared repositories, read only (D-15). */
export const GLOBAL_KNOWLEDGE_TOOL_NAMES = ["knowledge_search", "knowledge_get"] as const;
type ToolName = (typeof KNOWLEDGE_TOOL_NAMES)[number];

/** Where a call was made: the project, or null without a project folder. */
export type KnowledgeToolContext = { projectId: number | null };

const KINDS = ["knowledge", "strategy", "persona", "pattern"] as const;
type Scope = "workspace" | "project" | "shared";

/** Sent to the model in every session: one sentence each. */
const DESCRIPTIONS: Record<ToolName, string> = {
  knowledge_search:
    "Search the team's curated knowledge (strategies, personas, patterns, facts kept on purpose) by words; one line per entry with its scope/slug, kind, area and version. Not for what happened in earlier sessions: that is memory_search.",
  knowledge_get:
    "Read knowledge entries whole, by the scope/slug references knowledge_search returned.",
  knowledge_propose:
    "Propose a new knowledge entry, or a change to one (give its slug and base version). A person accepts it before it becomes knowledge; the area is one of the taxonomy's. Not for session facts, decisions or fixes: those are memory_save.",
};

const READS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const META: Record<ToolName, { title: string; annotations: ModuleTool["annotations"] }> = {
  knowledge_search: { title: "Search knowledge", annotations: READS },
  knowledge_get: { title: "Read knowledge", annotations: READS },
  knowledge_propose: {
    title: "Propose knowledge",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
};

const TURNED_OFF = "Knowledge is turned off for this project.";
const NO_MATCH = "No knowledge matches.";
const QUOTA = `refused quota: ${PROPOSALS_PER_HOUR} proposals in the last hour; a person decides them first`;
/** A reference as the agent gives it: a scope and a slug, never a path. */
const REF = /^(workspace|shared|project)\/[a-z0-9][a-z0-9-]{0,79}$/;

// --- The area enum ----------------------------------------------------------------------

/** A root's areas: its taxonomy file's, or the defaults when the file cannot give them. */
function rootAreas(dataDir: string, scope: "workspace" | "shared"): Taxonomy["areas"] {
  try {
    const folder = repoPath(dataDir, repoFolder({ scope }));
    if (kindAt(folder) !== "folder") return DEFAULT_AREAS;
    const bytes = readRegularFile(join(folder, TAXONOMY_FILE));
    if (bytes === null) return DEFAULT_AREAS;
    const taxonomy = parseTaxonomy(new TextDecoder().decode(bytes));
    return "problem" in taxonomy ? DEFAULT_AREAS : taxonomy.areas;
  } catch {
    return DEFAULT_AREAS;
  }
}

/**
 * The ids `knowledge_propose` offers: the workspace's, then the shared root's not yet
 * listed, each root's from its taxonomy file or the defaults the first write creates. The
 * description names each id's label and the roots that hold it. Reads the two files and
 * nothing else; never throws.
 */
export function areaEnum(dataDir: string): { ids: string[]; description: string } {
  const workspace = rootAreas(dataDir, "workspace");
  const shared = rootAreas(dataDir, "shared");
  const ids = [...new Set([...workspace, ...shared].map((area) => area.id))];
  const description = ids
    .map((id) => {
      const inWorkspace = workspace.find((area) => area.id === id);
      const inShared = shared.find((area) => area.id === id);
      const roots = [inWorkspace && "workspace", inShared && "shared"].filter(Boolean).join(", ");
      return `${id}: ${(inWorkspace ?? inShared)?.label ?? id} (${roots})`;
    })
    .join("; ");
  return { ids, description };
}

// --- Shared steps ------------------------------------------------------------------------

/** A refusal of the store as one line, its code written once. */
function refusal(error: KnowledgeError): string {
  return error.message.startsWith(`${error.code}: `)
    ? `refused ${error.message}`
    : `refused ${error.code}: ${error.message}`;
}

const refOf = (scope: Scope, projectId: number | null): ScopeRef | null =>
  scope === "project" ? (projectId === null ? null : { scope: "project", projectId }) : { scope };

/**
 * Brings the repositories a tool reads into the index (`ensureFresh`), each under its
 * lease. A repository another process holds is read from the index as it is.
 */
function freshen(store: KnowledgeStore, scopes: Scope[], projectId: number | null): void {
  for (const scope of new Set(scopes)) {
    const ref = refOf(scope, projectId);
    if (ref === null) continue;
    try {
      const repo = openRepo(store, ref);
      if (repo !== null) withRepoLeases(store, [repo.relative], () => ensureFresh(store, repo));
    } catch (error) {
      if (error instanceof KnowledgeError && error.code === "locked") continue;
      throw error;
    }
  }
}

const ALL_SCOPES: Scope[] = ["workspace", "shared", "project"];

// --- Search ------------------------------------------------------------------------------

export interface SearchArgs {
  query: string;
  repo?: "all" | Scope;
  area?: string;
  kind?: string;
  limit?: number;
}

/**
 * One line per matching active entry of the repositories the project sees, best first by
 * bm25, with the area's label from its root's taxonomy (its id when none gives one). A
 * query with no token lists the pinned entries first, then the newest. Never a proposal.
 */
export function searchKnowledge(
  store: KnowledgeStore,
  context: KnowledgeToolContext,
  args: SearchArgs,
): string {
  const wanted = args.repo === undefined || args.repo === "all" ? null : args.repo;
  freshen(store, wanted === null ? ALL_SCOPES : [wanted], context.projectId);
  const ids = visibleRepos(store.db, context.projectId)
    .filter((repo) => wanted === null || repo.scope === wanted)
    .map((repo) => repo.id);
  const tokens = searchTokens(args.query);
  const limit = args.limit ?? SEARCH_DEFAULT_LIMIT;
  const filters = {
    ...(args.area === undefined ? {} : { area: args.area }),
    ...(args.kind === undefined ? {} : { kind: args.kind }),
  };
  const hits =
    tokens.length === 0
      ? browseEntries(store.db, ids, filters, limit)
      : searchEntries(store.db, tokens, ids, filters, null, limit);
  if (hits.length === 0) return NO_MATCH;
  const labels = new Map<string, Taxonomy | null>();
  const labelOf = (hit: Hit) => {
    const root = hit.scope === "shared" ? "shared" : "workspace";
    if (!labels.has(root)) labels.set(root, taxonomyOrNull(store, { ref: { scope: root } }));
    return labels.get(root)?.areas.find((area) => area.id === hit.area)?.label ?? hit.area;
  };
  return hits
    .map((hit) =>
      inert(
        `${hit.scope}/${hit.slug}  ${hit.kind} · ${labelOf(hit)} · v${hit.version}  ${hit.title}`,
      ),
    )
    .join("\n");
}

// --- Get ---------------------------------------------------------------------------------

/** One entry whole: its heading, nine keys in a fixed order, a blank line and its body. */
function renderBlock(hit: Hit): string {
  const body =
    hit.body.length > GET_BODY_MAX
      ? `${clip(hit.body, GET_BODY_MAX)}\n[cut at ${GET_BODY_MAX.toLocaleString("en-US")} characters of ${hit.body.length}]`
      : hit.body;
  return inert(
    [
      `# ${hit.scope}/${hit.slug} (v${hit.version})`,
      `id: ${hit.id}`,
      `title: ${hit.title}`,
      `kind: ${hit.kind}`,
      `area: ${hit.area}`,
      `version: ${hit.version}`,
      `hash: ${hit.hash}`,
      `author: ${hit.author}`,
      hit.updated === null ? "updated:" : `updated: ${hit.updated}`,
      `pinned: ${hit.pinned}`,
      "",
      body,
    ].join("\n"),
  );
}

/**
 * Each reference's entry, in the order given, through the index of the repositories the
 * project sees: only an active entry with no problem is found, and no reference is ever a
 * path. Past `GET_ANSWER_MAX` characters the remaining references are counted, not rendered.
 */
export function getKnowledge(
  store: KnowledgeStore,
  context: KnowledgeToolContext,
  args: { refs: string[] },
): string {
  const parsed = args.refs.map((ref) => {
    const at = ref.indexOf("/");
    return { ref, scope: ref.slice(0, at) as Scope, slug: ref.slice(at + 1) };
  });
  freshen(
    store,
    parsed.map((each) => each.scope),
    context.projectId,
  );
  const visible = visibleRepos(store.db, context.projectId);
  let answer = "";
  for (const [at, each] of parsed.entries()) {
    const repo = REF.test(each.ref) ? visible.find((r) => r.scope === each.scope) : undefined;
    const hit = repo === undefined ? null : entryAt(store.db, repo.id, each.slug);
    const block =
      hit === null || hit.status !== "active" || hit.problem !== null
        ? `Not found: ${each.ref}`
        : renderBlock(hit);
    const next = answer === "" ? block : `${answer}\n---\n${block}`;
    if (answer !== "" && next.length > GET_ANSWER_MAX) {
      return `${answer}\n[${parsed.length - at} more not shown: ask for them separately]`;
    }
    answer = next;
  }
  return answer;
}

// --- Propose -----------------------------------------------------------------------------

export interface ProposeArgs {
  repo: Scope;
  title: string;
  kind: string;
  area: string;
  context?: string;
  subject?: string;
  body: string;
  slug?: string;
  base_version?: number;
}

const invalid = (message: string) => new KnowledgeError("invalid", message);

/**
 * An agent's proposal, after the schema: the rate counter, the area against the target
 * root's taxonomy, the target, the judge, then the store's write as the agent. Every
 * refusal of the store answers as one line; a duplicate writes nothing.
 */
export async function proposeKnowledge(
  store: KnowledgeStore,
  context: KnowledgeToolContext,
  args: ProposeArgs,
  agentId: string,
  judge: Judge,
): Promise<string> {
  try {
    return await propose(store, context, args, agentId, judge);
  } catch (error) {
    if (error instanceof KnowledgeError) return refusal(error);
    throw error;
  }
}

async function propose(
  store: KnowledgeStore,
  context: KnowledgeToolContext,
  args: ProposeArgs,
  agentId: string,
  judge: Judge,
): Promise<string> {
  const db = store.db;
  if (!allowProposal(db, agentId, store.now())) return QUOTA;
  // Part 1's rule: no write in the state rebuild refuses (the folder gone, rows in the index).
  requireKnowledgeRoot(store, "written", "the agent");

  const ref = refOf(args.repo, context.projectId);
  if (ref === null) throw invalid("repo: a project's repository needs a project folder");
  const defaults: Taxonomy = { version: 1, updated: "", areas: DEFAULT_AREAS };
  checkArea(args.area, taxonomyFor(store, ref) ?? defaults);
  if (args.base_version !== undefined && args.slug === undefined) {
    throw invalid("base_version: a change names its entry by slug");
  }

  const change: EntryChange = {
    title: args.title,
    kind: args.kind,
    area: args.area,
    context: args.context ?? "",
    subject: args.subject ?? "",
    body: args.body,
    ...(args.slug === undefined ? {} : { slug: args.slug }),
    ...(args.base_version === undefined ? {} : { baseVersion: args.base_version }),
  };
  freshen(store, ALL_SCOPES, context.projectId);
  const repos = visibleRepos(db, context.projectId);
  const target = repos.find((repo) => repo.scope === args.repo);
  const slug = proposalSlug(store, change);
  const current = target === undefined ? null : entryAt(db, target.id, slug);
  proposalBase(slug, change, current);

  const verdict = await judgeProposal(
    store,
    judge,
    repos,
    { title: args.title, body: args.body },
    target !== undefined && current !== null ? { repoId: target.id, entryId: current.id } : null,
  );
  if (verdict.duplicate !== null) {
    logError(
      "knowledge.propose",
      new Error(`duplicate of ${verdict.duplicate.ref} (agent ${agentId})`),
      store.dataDir,
    );
    return verdict.duplicate.kind === "entry"
      ? `refused duplicate: already known as ${verdict.duplicate.ref}; propose a change with its slug and base version`
      : `refused duplicate: already proposed as ${verdict.duplicate.ref}`;
  }

  const written = writeEntry(
    store,
    ref,
    {
      ...change,
      proposal: {
        contradicts: verdict.contradicts.map((entry) => entry.id),
        onBehalfOf: personAuthor(store).name,
        judgedBy: verdict.judgedBy,
        judgeVersion: verdict.judgeVersion,
      },
    },
    agentWriter(agentId),
  );
  if (written.kind !== "proposed") throw new Error("an agent's write must be a proposal");
  const proposal = written.proposal;
  const changes = proposal.baseVersion > 0 ? ` changes v${proposal.baseVersion}` : "";
  return [
    `proposed ${args.repo}/${proposal.id} for ${proposal.slug}${changes}`,
    ...verdict.contradicts.map((entry) => `contradicts ${entry.ref}`),
  ].join("\n");
}

// --- The tools ---------------------------------------------------------------------------

/** The arguments' schemas; zod is loaded here and nowhere a hook runs. */
async function schemas(global: boolean, areas: { ids: string[]; description: string } | null) {
  const { z } = await import("zod");
  const kind = z.enum(KINDS);
  const [first, ...rest] = areas?.ids ?? [];
  const area =
    first === undefined
      ? z.string().min(1)
      : z.enum([first, ...rest]).describe(areas?.description ?? "");
  return {
    knowledge_search: z.object({
      query: z.string().describe("Words. Empty lists the pinned entries, then the newest."),
      repo: (global
        ? z.enum(["all", "workspace", "shared"])
        : z.enum(["all", "workspace", "project", "shared"])
      ).optional(),
      area: z.string().optional().describe("An area id."),
      kind: kind.optional(),
      limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
    }),
    knowledge_get: z.object({
      refs: z
        .array(z.string().regex(REF))
        .min(1)
        .max(GET_MAX_REFS)
        .describe("scope/slug references, as knowledge_search returns them."),
    }),
    knowledge_propose: z.object({
      repo: z.enum(["workspace", "project", "shared"]),
      title: z.string().min(1).max(TITLE_MAX),
      kind,
      area,
      context: z.string().max(FIELD_MAX).optional(),
      subject: z.string().max(FIELD_MAX).optional(),
      body: z.string().min(1),
      slug: z.string().regex(SLUG).max(80).optional().describe("For a change: the entry's slug."),
      base_version: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("For a change: the entry's version the change is based on."),
    }),
  };
}

/** One validated call against a freshly opened database. */
async function runTool(
  name: ToolName,
  global: boolean,
  args: unknown,
  call: ToolCall,
): Promise<string> {
  const { dataDir, storeDir } = resolvePaths();
  const db = openDb({ dataDir: storeDir, busyTimeoutMs: 2000 });
  try {
    let projectId: number | null = null;
    if (!global) {
      const project = resolveProject(db, call.projectDir ?? process.cwd(), Date.now());
      // Nothing is read or written for knowledge in a project the person turned off.
      if (project.disabled) return TURNED_OFF;
      projectId = project.id;
    }
    const store = openStore({ db, dataDir });
    const context = { projectId };
    try {
      requireSchema(store);
      switch (name) {
        case "knowledge_search":
          return searchKnowledge(store, context, args as SearchArgs);
        case "knowledge_get":
          return getKnowledge(store, context, args as { refs: string[] });
        case "knowledge_propose":
          return await proposeKnowledge(
            store,
            context,
            args as ProposeArgs,
            call.agentId ?? UNKNOWN_AGENT,
            makeJudge({ db, dataDir, toolPath: true }),
          );
      }
    } catch (error) {
      if (error instanceof KnowledgeError) return refusal(error);
      throw error;
    }
  } finally {
    db.close();
  }
}

/**
 * The tools knowledge offers in this mode. Listing opens no database, writes nothing and
 * never throws: inside a project it reads the two taxonomy files for the area enum.
 */
export async function knowledgeTools(mode: ToolMode): Promise<ModuleTool[]> {
  const global = mode === "global";
  const areas = global ? null : areaEnum(resolvePaths().dataDir);
  const schema = await schemas(global, areas);
  return (global ? GLOBAL_KNOWLEDGE_TOOL_NAMES : KNOWLEDGE_TOOL_NAMES).map((name) => ({
    name,
    title: META[name].title,
    ...(META[name].annotations === undefined ? {} : { annotations: META[name].annotations }),
    description: DESCRIPTIONS[name],
    inputSchema: schema[name],
    run: (args, call) => runTool(name, global, args, call),
  }));
}
