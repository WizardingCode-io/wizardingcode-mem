import { readFileSync } from "node:fs";
import { resolveProject } from "../../core/project.ts";
import { personAuthor } from "../../modules/knowledge/author.ts";
import { KnowledgeError } from "../../modules/knowledge/errors.ts";
import {
  ensureFresh,
  type InEachRepo,
  inEachRepo,
  listEntries,
  listProposals,
  type RebuildResult,
  rebuildAll,
} from "../../modules/knowledge/index-store.ts";
import { withRepoLeases } from "../../modules/knowledge/repo.ts";
import {
  acceptProposal,
  adopt,
  rejectProposal,
  writeEntry,
} from "../../modules/knowledge/store.ts";
import { openStore } from "../../modules/knowledge/store-open.ts";
import { addArea, removeArea, renameArea } from "../../modules/knowledge/taxonomy.ts";
import type { KnowledgeStore, ScopeRef } from "../../modules/knowledge/types.ts";
import { type Db, openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { plural } from "../../util/text.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = `Usage: wizardingcode-mem knowledge <command> [options]

Commands:
  write    --scope workspace|shared|project --title <text> --kind <kind> --area <id>
           [--context <text>] [--subject <text>] [--slug <slug>] [--base <n>]
           [--status active|draft|archived]
           (--body-file <path> | --body <text> | the body on standard input)
  accept   --scope <scope> <proposal id>
  reject   --scope <scope> <proposal id>
  area     add <id> <label> | rename <id> <label> | remove <id>   [--scope workspace|shared]
  rebuild  [--scope workspace|shared|project]
  adopt    [--scope workspace|shared|project]
  list     [--scope workspace|shared|project]

Kinds: knowledge, strategy, persona, pattern. --scope project is the project of the
current folder for write, accept and reject, and every project for the others.
`;

/** Bad arguments: the usage is printed and the exit code is 64. */
class UsageError extends Error {}

type Scope = ScopeRef["scope"];
const SCOPES: readonly Scope[] = ["workspace", "shared", "project"];

const WRITE_FLAGS = [
  "--scope",
  "--title",
  "--kind",
  "--area",
  "--context",
  "--subject",
  "--slug",
  "--base",
  "--status",
  "--body-file",
  "--body",
];

/** Splits the arguments into the options this subcommand takes and what is left. */
function parse(argv: string[], allowed: string[]): { flags: Map<string, string>; rest: string[] } {
  const flags = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) {
      rest.push(arg);
      continue;
    }
    if (!allowed.includes(arg)) throw new UsageError(`unknown option ${arg}`);
    const value = argv[i + 1];
    if (value === undefined) throw new UsageError(`${arg} needs a value`);
    flags.set(arg, value);
    i++;
  }
  return { flags, rest };
}

/** The `--scope` value, when it is one of the scopes this subcommand takes. */
function scopeAmong<S extends Scope>(
  flags: Map<string, string>,
  among: readonly S[],
): S | undefined {
  const value = flags.get("--scope");
  if (value === undefined) return undefined;
  const scope = among.find((candidate) => candidate === value);
  if (scope === undefined) throw new UsageError(`--scope must be one of ${among.join(", ")}`);
  return scope;
}

const scopeOf = (flags: Map<string, string>) => scopeAmong(flags, SCOPES);

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new UsageError(`${name} is required`);
  return value;
}

/** `--scope project` for one repository: the project of the current folder. */
function refOf(store: KnowledgeStore, scope: Scope): ScopeRef {
  if (scope !== "project") return { scope };
  return { scope, projectId: resolveProject(store.db, process.cwd(), store.now()).id };
}

async function bodyOf(flags: Map<string, string>): Promise<string> {
  const inline = flags.get("--body");
  const file = flags.get("--body-file");
  if (inline !== undefined && file !== undefined) {
    throw new UsageError("give --body or --body-file, not both");
  }
  if (inline !== undefined) return inline;
  if (file !== undefined) return readFileSync(file, "utf8");
  if (process.stdin.isTTY === true) {
    throw new UsageError("give the body with --body, --body-file or on standard input");
  }
  return await Bun.stdin.text();
}

const out = (line: string) => process.stdout.write(`${line}\n`);

async function write(store: KnowledgeStore, argv: string[]): Promise<void> {
  const { flags, rest } = parse(argv, WRITE_FLAGS);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  const scope = scopeOf(flags);
  if (scope === undefined) throw new UsageError("--scope is required");
  const title = required(flags, "--title");
  const kind = required(flags, "--kind");
  const area = required(flags, "--area");
  const base = flags.get("--base");
  if (base !== undefined && !/^\d+$/.test(base)) {
    throw new UsageError("--base must be a whole number");
  }
  const slug = flags.get("--slug");
  const status = flags.get("--status");
  // A trailing newline is the file's or the shell's, not the entry's.
  const body = (await bodyOf(flags)).replace(/\r?\n$/, "");
  const result = writeEntry(
    store,
    refOf(store, scope),
    {
      title,
      kind,
      area,
      context: flags.get("--context") ?? "",
      subject: flags.get("--subject") ?? "",
      body,
      ...(slug === undefined ? {} : { slug }),
      ...(status === undefined ? {} : { status }),
      ...(base === undefined ? {} : { baseVersion: Number(base) }),
    },
    personAuthor(store),
  );
  if (result.kind === "written") out(`written ${result.entry.slug} (v${result.entry.version})`);
}

function decide(store: KnowledgeStore, argv: string[], decision: "accept" | "reject"): void {
  const { flags, rest } = parse(argv, ["--scope"]);
  const scope = scopeOf(flags);
  if (scope === undefined) throw new UsageError("--scope is required");
  const id = rest[0];
  if (id === undefined || rest.length > 1) throw new UsageError("give one proposal id");
  const ref = refOf(store, scope);
  if (decision === "accept") {
    const entry = acceptProposal(store, ref, id, personAuthor(store));
    out(`accepted ${id} into ${entry.slug} (v${entry.version})`);
  } else {
    rejectProposal(store, ref, id, personAuthor(store));
    out(`rejected ${id}`);
  }
}

function area(store: KnowledgeStore, argv: string[]): void {
  const { flags, rest } = parse(argv, ["--scope"]);
  // A project has no taxonomy of its own: it reads the workspace's.
  const scope = scopeAmong(flags, ["workspace", "shared"] as const) ?? "workspace";
  const [action, id, label] = rest;
  const person = personAuthor(store);
  let version: number;
  if (action === "add" && id !== undefined && label !== undefined && rest.length === 3) {
    version = addArea(store, { scope }, id, label, person).version;
  } else if (action === "rename" && id !== undefined && label !== undefined && rest.length === 3) {
    version = renameArea(store, { scope }, id, label, person).version;
  } else if (action === "remove" && id !== undefined && rest.length === 2) {
    version = removeArea(store, { scope }, id, person).version;
  } else {
    throw new UsageError("area add <id> <label> | area rename <id> <label> | area remove <id>");
  }
  out(`taxonomy v${version}`);
}

/** What to say when the scope asked for has no repository, or when there is none at all. */
const nothing = (scope: Scope | undefined) =>
  scope === undefined ? "no knowledge repository yet" : `${scope}: no repository`;

function rebuildLine(relative: string, result: RebuildResult): string {
  const parts = [
    `${plural(result.entries, "entry", "entries")}, ${plural(result.proposals, "proposal")} (${result.open} open)`,
  ];
  if (result.problems > 0) parts.push(plural(result.problems, "problem"));
  if (result.overCap > 0) parts.push(`${plural(result.overCap, "file")} over the cap`);
  if (!result.dirtyChecked) parts.push("dirty check skipped: git missing");
  return `${relative}: ${parts.join(", ")}`;
}

/**
 * Says on standard error each repository the store set aside during a command, and how
 * many there were. One of them does not stop the command for the others (`inEachRepo`);
 * a command that set one aside exits with 1.
 */
function sayRefused(all: InEachRepo<unknown>): number {
  for (const [relative, message] of all.refused) {
    process.stderr.write(`wizardingcode-mem: ${relative}: ${message}\n`);
  }
  return all.refused.size;
}

/** What to say when no repository was worked in and none was set aside. */
function sayNothing(all: InEachRepo<unknown>, scope: Scope | undefined): void {
  if (all.results.size === 0 && all.refused.size === 0) out(nothing(scope));
}

function rebuild(store: KnowledgeStore, argv: string[]): number {
  const { flags, rest } = parse(argv, ["--scope"]);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  const scope = scopeOf(flags);
  const all = rebuildAll(store, scope);
  for (const [relative, result] of all.results) out(rebuildLine(relative, result));
  const refused = sayRefused(all);
  for (const repo of all.repos) {
    if (all.results.has(repo.relative) || all.refused.has(repo.relative)) continue;
    out(`${repo.relative}: not a repository`);
  }
  if (all.repos.length === 0) out(nothing(scope));
  if (scope !== undefined && scope !== "project") return refused;
  for (const orphan of all.orphans) out(`orphan ${orphan}`);
  // A manifest a project matched and did not take, or one that belongs to another project.
  const unclear = new Set([
    ...all.ambiguous.flatMap((entry) => entry.others),
    ...all.claimed.map((claim) => claim.path),
  ]);
  for (const path of unclear) out(`ambiguous ${path}`);
  return refused;
}

function adoptAll(store: KnowledgeStore, argv: string[]): number {
  const { flags, rest } = parse(argv, ["--scope"]);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  const scope = scopeOf(flags);
  const person = personAuthor(store);
  // Each repository's line is printed as its adopt ends: a fault in a later one stops the
  // command, and what was adopted before it has been said.
  const all = inEachRepo(store, scope, (repo) => {
    const result = adopt(store, repo.ref, person);
    out(
      result.adopted === 0
        ? `${repo.relative}: clean`
        : `${repo.relative}: adopted ${plural(result.adopted, "change")}`,
    );
    for (const problem of result.problems) out(`  ${problem}`);
  });
  sayNothing(all, scope);
  return sayRefused(all);
}

function list(store: KnowledgeStore, argv: string[]): number {
  const { flags, rest } = parse(argv, ["--scope"]);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  const scope = scopeOf(flags);
  const all = inEachRepo(store, scope, (repo) => {
    try {
      withRepoLeases(store, [repo.relative], () => ensureFresh(store, repo));
    } catch (error) {
      // A write is under way: the rows are listed as they stand.
      if (!(error instanceof KnowledgeError && error.code === "locked")) throw error;
    }
    out(repo.relative);
    for (const entry of listEntries(store, repo.id)) {
      out(
        `  ${entry.slug}  ${entry.kind}  ${entry.area}  ${entry.status}  v${entry.version}  ${entry.author}`,
      );
      if (entry.problem !== null) out(`    problem: ${entry.problem}`);
    }
    for (const proposal of listProposals(store, repo.id)) {
      const state = proposal.decision ?? "open";
      out(`  ${state}  ${proposal.id}  ${proposal.slug}  by ${proposal.proposedBy}`);
      if (proposal.problem !== null) out(`    problem: ${proposal.problem}`);
    }
  });
  sayNothing(all, scope);
  return sayRefused(all);
}

/**
 * `wizardingcode-mem knowledge <command>`: the knowledge store from a shell. The person
 * at the keyboard is the writer; an agent's change comes through the tools, as a proposal.
 */
export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  let db: Db | undefined;
  try {
    const commands = ["write", "accept", "reject", "area", "rebuild", "adopt", "list"];
    if (command === undefined || !commands.includes(command)) {
      throw new UsageError(
        command === undefined ? "a command is needed" : `unknown command ${command}`,
      );
    }
    const { dataDir, storeDir } = resolvePaths();
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
    const store = openStore({
      db,
      dataDir,
      // What the store did on its own, such as undoing an interrupted write, is said here.
      report: (message) => process.stderr.write(`wizardingcode-mem: ${message}\n`),
    });
    // How many repositories the command set aside: none for a command on one repository.
    let refused = 0;
    if (command === "write") await write(store, rest);
    else if (command === "accept" || command === "reject") decide(store, rest, command);
    else if (command === "area") area(store, rest);
    else if (command === "rebuild") refused = rebuild(store, rest);
    else if (command === "adopt") refused = adoptAll(store, rest);
    else refused = list(store, rest);
    return refused > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`wizardingcode-mem: ${error.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    // A refusal of the store is the answer to the person; anything else is a fault worth a log line.
    if (!(error instanceof KnowledgeError)) logError("knowledge", error);
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    db?.close();
  }
}
