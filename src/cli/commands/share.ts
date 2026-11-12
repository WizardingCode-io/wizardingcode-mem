import pkg from "../../../package.json" with { type: "json" };
import { isSharedName, NAME_PREFIX } from "../../core/identity.ts";
import { findProject, remoteAliasOf } from "../../core/project.ts";
import { type SharingKey, validatePatch } from "../../settings/settings.ts";
import { formatChange } from "../../sharing/format.ts";
import { policyInForce, sharingRefusal } from "../../sharing/in-force.ts";
import {
  boundAliasesOf,
  confirmedServerRefs,
  destinationOf,
  levelKey,
  levelOf,
} from "../../sharing/levels.ts";
import { nameOf, noNameMessage, sharedNameOf } from "../../sharing/names.ts";
import { decide, INERT_PROBLEM } from "../../sharing/policy.ts";
import {
  findEntry,
  findMemory,
  ledgerRecords,
  type Report,
  wouldLeave,
} from "../../sharing/report.ts";
import {
  applySettingsPatch,
  type ChangeRow,
  forgetName,
  generationOf,
  lastChange,
  previewSettingsPatch,
  projectState,
  setLevelMessage,
  setServerLists,
} from "../../sharing/store.ts";
import {
  type Item,
  isLevel,
  LEVEL_LABELS,
  LEVELS,
  type Level,
  REASON_TEXT,
  type SharingPolicy,
  shareListText,
  TEAM_DESTINATION,
} from "../../sharing/types.ts";
import { ago } from "../../status/report.ts";
import { type Db, openDb } from "../../store/db.ts";
import {
  type BindOutcome,
  bindMessage,
  commitBinding,
  listServerNames,
  nameCounts,
  prepareBinding,
} from "../../sync/binding.ts";
import type { SyncContext } from "../../sync/context.ts";
import {
  confirmJoin,
  joinServer,
  muteServer,
  rejoinServer,
  removeServer,
  resumePreview,
  resumeServer,
} from "../../sync/join.ts";
import { ledgerHistory } from "../../sync/ledger.ts";
import { findServer, heldByContract } from "../../sync/servers.ts";
import { startSync } from "../../sync/spawn.ts";
import { nameStateOf, type ServerStatus, statusReport } from "../../sync/state.ts";
import { realClock, realTimers } from "../../util/clock.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { plural } from "../../util/text.ts";
import { EXIT_USAGE } from "../exit.ts";
import { askSecret, askYesNo, type PromptIo, terminalIo } from "../prompt.ts";

export const USAGE = `Usage: wizardingcode-mem share <command>

Commands:
  project <level> [--as <name>] [--create] [--yes] [--server <s>]
      What the project of the current folder shares; --as binds it under a shared name
      a team can match it by when it has no git remote (--create makes the name)
  names [--server <s>]                     The shared names on the server, yours marked *
  name forget [--server <s>]               Leave the project's shared name, at Nothing
  roots <list|none> [--yes] [--server <s>] The repositories whose knowledge may leave: workspace, shared
  areas <list|none> [--yes] [--server <s>] The areas that may leave, such as workspace:sales
  status [--list] [--server <s>]           What is shared and what would leave; --list names each item
  explain <scope>/<slug> [--server <s>]    Why one knowledge entry leaves or stays
  explain memory <id> [--server <s>]       Why one memory leaves or stays
  server add <url> [--code <code>] [--label <label>] [--name <your name>] [--yes] [--no-sync]
  server rejoin <server> [--code <code>] [--label <label>]
      Without --code the invitation code is asked on the terminal, with no echo, so it stays
      out of the shell's history and the process list.
  server list
  server remove <server> [--withdraw] [--yes]
  server mute | unmute <server> [--member <id>]
  server resume [<server>] [--yes]

Levels: ${LEVELS.map((level) => `${level} (${LEVEL_LABELS[level]})`).join(", ")}.
Sharing more asks first; --yes answers for a script. Nothing is sent until a team server
is joined and confirmed (share server add). A server is named by its id, name or host.
`;

/** Bad arguments: the usage is printed and the exit code is 64. */
class UsageError extends Error {}

/** What the command will not do, said to the person as it is: exit code 1, nothing logged. */
class Refusal extends Error {}

/** What a subcommand acts on: the store, and the policy in force once what was pending is recorded. */
interface Context {
  db: Db;
  dataDir: string;
  storeDir: string;
  policy: SharingPolicy;
  now: number;
  /** The sync client's context over the same store, for a server operation. */
  sync: () => SyncContext;
  /** The policy in force for one server (null: the team's default while none is confirmed). */
  policyFor: (serverId: string | null) => SharingPolicy;
}

/**
 * A subcommand in two steps: its arguments are read first, so that a usage error opens no
 * store; what comes back acts on the store.
 */
type Subcommand = (argv: string[]) => (context: Context) => void | Promise<void>;

const out = (line: string) => process.stdout.write(`${line}\n`);

/** The arguments apart, with the options that take a value: `--code <code>`. */
function parseWith(
  argv: string[],
  flags: string[],
  valued: string[],
): { options: Set<string>; values: Map<string, string>; rest: string[] } {
  const options = new Set<string>();
  const values = new Map<string, string>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("--")) rest.push(arg);
    else if (flags.includes(arg)) options.add(arg);
    else if (valued.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${arg} takes a value`);
      values.set(arg, value);
      i++;
    } else throw new UsageError(`unknown option ${arg}`);
  }
  return { options, values, rest };
}

/**
 * Whether a person agreed to let more leave: `--yes` among the arguments answers without
 * asking; else the question is put on the terminal, where Enter alone is no. Without a
 * terminal and without `--yes` the answer is no.
 */
export function confirmWidening(question: string, argv: string[], io?: PromptIo): boolean {
  return argv.includes("--yes") || askYesNo(question, false, io);
}

/** A widening goes on with the person's yes, and is refused without: nothing is written. */
function requireYes(question: string, argv: string[]): void {
  if (confirmWidening(question, argv)) return;
  throw new Refusal(
    terminalIo.isTTY
      ? "not confirmed; nothing was changed"
      : "widening needs --yes when nobody can confirm",
  );
}

/** Nothing is changed under a policy that could not be loaded; the person is told why. */
function requireLoaded(policy: SharingPolicy): void {
  const refusal = sharingRefusal(policy);
  if (refusal !== null) throw new Refusal(refusal);
}

/**
 * The server a command acts on (ADR 0027): `--server` names one by id, name or host (a pending
 * one is refused); without it, the only confirmed server, or null while none is confirmed (the
 * team's default); with several, the option is required.
 */
function serverFor(db: Db, given: string | undefined): string | null {
  if (given !== undefined) {
    const row = findServer(db, given);
    if (row === null)
      throw new Refusal(`\`${given}\` names no server; share server list shows them`);
    if (row.confirmedAt === null)
      throw new Refusal(`${row.name} is not confirmed: share server add again`);
    return row.serverId;
  }
  const confirmed = confirmedServerRefs(db);
  if (confirmed.length === 0) return null;
  if (confirmed.length === 1) return (confirmed[0] as { serverId: string }).serverId;
  throw new Refusal(
    `several servers are configured (${confirmed.map((s) => s.name).join(", ")}); name one with --server <id|name|host>`,
  );
}

/**
 * The destination a command's `--server` chooses: that server (`serverFor`), else the team's
 * default. For the project of the current folder the level is read for `destinationOf`, the
 * sharing module's rule, which puts the server the project is bound to first.
 */
const chosenDestination = (serverId: string | null): string => serverId ?? TEAM_DESTINATION;

// --- project ------------------------------------------------------------------------------

/** The level phrase of the shared name's question, per level (the viewer's words). */
function levelPhrase(level: Level, project: string): string {
  switch (level) {
    case "receive":
      return `and receive it into ${project}`;
    case "knowledge":
      return `and share knowledge of ${project} as it`;
    case "all":
      return `and share knowledge and memories of ${project} as it`;
    case "local":
      return `and share nothing of ${project}`;
  }
}

/**
 * `share project <level> [--as <name>] [--create] [--yes]`: what the project of the current
 * folder shares. The folder must be a project already: the command makes none. The level is
 * bound to the folder's git remote, or to the shared name given (ADR 0028): the dry run decides
 * every local refusal first, the server is looked at once, the question is asked before any
 * POST, then the name is created (`--create`) or joined, and the level written with its id.
 */
const project: Subcommand = (argv) => {
  const { options, values, rest } = parseWith(argv, ["--yes", "--create"], ["--server", "--as"]);
  const [level, ...more] = rest;
  if (!isLevel(level) || more.length > 0) throw new UsageError(setLevelMessage("invalid"));
  return async ({ db, policyFor, sync }) => {
    const serverId = serverFor(db, values.get("--server"));
    requireLoaded(policyFor(serverId));
    const here = findProject(db, process.cwd());
    if (here === null) throw new Refusal(setLevelMessage("no-project"));
    const destination = chosenDestination(serverId);
    const serverName =
      serverId === null ? "the team" : (findServer(db, serverId)?.name ?? serverId);
    let as: string | null = null;
    if (values.has("--as")) {
      const typed = values.get("--as") as string;
      const named = sharedNameOf(typed);
      if (!named.ok) throw new Refusal(noNameMessage(typed, named));
      as = named.alias;
    }
    const current = nameOf(projectState(db, here.id).aliases);
    const context = {
      slug: as === null ? null : as.slice(NAME_PREFIX.length),
      server: serverName,
      current: current === null ? null : current.slice(NAME_PREFIX.length),
    };
    const ctx = sync();
    const input = {
      projectId: here.id,
      destination,
      level,
      as,
      remoteAlias: remoteAliasOf(process.cwd()),
      source: "cli" as const,
    };
    const prepared = await prepareBinding(ctx, input);
    if (!prepared.ok) throw new Refusal(bindMessage(prepared, context));

    let outcome: BindOutcome;
    if (prepared.action === "none") {
      outcome = await commitBinding(ctx, prepared, {
        confirm: argv.includes("--yes"),
        create: false,
      });
      if (!outcome.ok && outcome.reason === "needs-confirm") {
        const what = LEVEL_LABELS[level].toLowerCase();
        requireYes(`Share ${what} of ${here.name} with ${serverName}?`, argv);
        outcome = await commitBinding(ctx, prepared, { confirm: true, create: false });
      }
    } else {
      const slug = prepared.slug as string;
      const question =
        prepared.action === "create"
          ? `Create \`${slug}\` on ${serverName}, visible to every member, ${levelPhrase(level, here.name)}?`
          : `Join \`${slug}\`, created by ${prepared.name?.createdBy.name ?? "a teammate"} (${nameCounts(prepared.name ?? { entries: 0, memories: 0 })}), ${levelPhrase(level, here.name)}?`;
      // The question is in the output, --yes or not: it says what the server is asked for.
      out(question);
      out(
        `would leave: ${plural(prepared.counts.entries, "entry", "entries")} · ${plural(prepared.counts.memories, "memory", "memories")}${prepared.counts.imported > 0 ? ` · ${plural(prepared.counts.imported, "imported memory stays", "imported memories stay")}` : ""}`,
      );
      requireYes("Go ahead?", argv);
      outcome = await commitBinding(ctx, prepared, {
        confirm: true,
        create: options.has("--create"),
      });
    }
    if (!outcome.ok) {
      const message = bindMessage(outcome, { ...context, slug: prepared.slug ?? context.slug });
      throw new Refusal(outcome.named === true ? `${message}; ${outcome.message}` : message);
    }
    const unchanged = outcome.old === level && !outcome.rebound && !outcome.named;
    const shared = isSharedName(outcome.boundAlias)
      ? `, shared as ${outcome.boundAlias.slice(NAME_PREFIX.length)}`
      : "";
    out(
      `sharing: ${here.name} → ${LEVEL_LABELS[level]}${unchanged ? " (unchanged)" : ""}${shared}`,
    );
    if (level === "all" && prepared.counts.imported > 0)
      out(plural(prepared.counts.imported, "imported memory stays", "imported memories stay"));
  };
};

// --- names, name forget -------------------------------------------------------------------

/**
 * `share names [--server <s>]`: every page of the server's live names, one line each, the
 * ones this machine's projects are bound under marked `*`; `none yet` for an empty registry.
 */
const names: Subcommand = (argv) => {
  const { values, rest } = parseWith(argv, [], ["--server"]);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  return async ({ db, now, sync }) => {
    const serverId = serverFor(db, values.get("--server"));
    if (serverId === null) throw new Refusal("no server; share server add <url> --code <code>");
    const row = findServer(db, serverId);
    if (row === null) throw new Refusal(`\`${serverId}\` names no server`);
    // The one read the dock's field makes too: the contract first, then every page.
    const listed = await listServerNames(sync(), row);
    if (!listed.ok) throw new Refusal(listed.message ?? listed.reason);
    if (listed.names.length === 0) {
      out("none yet");
      return;
    }
    const bound = new Set(boundAliasesOf(db, serverId).filter(isSharedName));
    for (const name of listed.names) {
      out(
        `${bound.has(name.alias) ? "* " : "  "}${name.alias.slice(NAME_PREFIX.length)}  created by ${name.createdBy.name}  ${nameCounts(name)}  last ${ago(now, name.lastChangeAt)}`,
      );
    }
    if (listed.truncated) out("  … more on the server");
  };
};

/** `share name forget`: the current folder's project leaves its shared name, at Nothing. */
const nameForget: Subcommand = (argv) => {
  const [verb, ...rest] = argv;
  if (verb !== "forget") throw new UsageError("name takes forget");
  const { rest: more } = parseWith(rest, [], ["--server"]);
  if (more.length > 0) throw new UsageError(`unexpected argument ${more[0]}`);
  return ({ db, now }) => {
    const here = findProject(db, process.cwd());
    if (here === null) throw new Refusal(setLevelMessage("no-project"));
    const outcome = forgetName(db, here.id, now, "cli");
    if (!outcome.ok) {
      if (outcome.reason === "name-bound") throw new Refusal(setLevelMessage("name-bound"));
      if (outcome.reason === "no-name") throw new Refusal(`${here.name} has no shared name`);
      throw new Refusal(setLevelMessage("no-project"));
    }
    out(`forgot the shared name ${outcome.alias.slice(NAME_PREFIX.length)} of ${here.name}`);
  };
};

// --- roots, areas -------------------------------------------------------------------------

const LIST_KEYS = {
  roots: "WIZARDINGCODE_MEM_SHARE_ROOTS",
  areas: "WIZARDINGCODE_MEM_SHARE_AREAS",
} as const satisfies Record<string, SharingKey>;

/**
 * `share roots <list|none> [--yes]` and `share areas <list|none> [--yes]`: one of the two
 * lists of the env file, replaced. The list is checked by the setting's own rule; an id
 * added is a widening, asked for; the file is written by the one path that logs the change.
 */
const list =
  (which: keyof typeof LIST_KEYS): Subcommand =>
  (argv) => {
    const { values, rest } = parseWith(argv, ["--yes"], ["--server"]);
    const [value, ...more] = rest;
    if (value === undefined || more.length > 0) {
      throw new UsageError(`${which} takes one comma list, or none`);
    }
    const key = LIST_KEYS[which];
    const validated = validatePatch({ [key]: value });
    if (!validated.ok) throw new UsageError(`${which}: ${validated.errors[key]}`);
    return ({ db, dataDir, policy, now, policyFor }) => {
      // With a server: its own lists (ADR 0027); the env file's lists stay the ceiling.
      if (values.has("--server")) {
        const serverId = serverFor(db, values.get("--server")) as string;
        requireLoaded(policyFor(serverId));
        const next = (validated.changes[key] ?? "")
          .split(",")
          .filter((id) => id !== "" && id !== "none");
        // The store refuses a widening it was not told is confirmed; the question is asked
        // then, and the write made again with the yes.
        const write = (confirm: boolean) =>
          setServerLists(db, serverId, { [which]: next }, { source: "cli", now, confirm });
        let outcome = write(false);
        if (!outcome.ok) {
          requireYes(`Share more knowledge with ${serverId}? (${shareListText(next)})`, argv);
          outcome = write(true);
          if (!outcome.ok) throw new Refusal("not confirmed; nothing was changed");
        }
        out(
          `sharing: ${which}@${serverId} → ${shareListText(next)}${outcome.changed.length === 0 ? " (unchanged)" : ""}`,
        );
        return;
      }
      requireLoaded(policy);
      for (const change of previewSettingsPatch(dataDir, validated.changes)) {
        if (!change.widened) continue;
        requireYes(`Share more knowledge with the team? (${shareListText(change.new)})`, argv);
      }
      const { sharing } = applySettingsPatch(db, dataDir, validated.changes, "cli", now, true);
      for (const change of sharing) {
        const [old, next] = [shareListText(change.old), shareListText(change.new)];
        out(`sharing: ${which} → ${next}${old === next ? " (unchanged)" : ""}`);
      }
    };
  };

// --- status -------------------------------------------------------------------------------

/** The levels in the order `status` counts the projects: what is shared first. */
const COUNTED: readonly Level[] = ["knowledge", "all", "local"];

/**
 * The lines of `share status`: the epoch with the last change, the roots and the areas in
 * force (the listed ids no taxonomy holds beside the areas, once), the policy's problems,
 * how many projects are at each level, the project of the current folder, and what would
 * leave; then, when the report lists them, each entry and each memory, with how many more
 * there are than it names.
 */
export function formatShareStatus(
  policy: SharingPolicy,
  report: Report,
  project: {
    name: string;
    level: Level;
    boundAlias: string;
    /** The one flag the bound name carries, when it is a shared name (ADR 0028). */
    nameState?: "missing" | "recreated" | "purged" | null;
    /** The server speaks 1 while a shared name is bound to it. */
    namesHeld?: boolean;
  } | null,
  change: ChangeRow | null,
  projectName: (id: number) => string | null = () => null,
): string[] {
  const last =
    change === null
      ? "no change yet"
      : `last change: ${formatChange(change, projectName)}, ${new Date(change.at).toISOString()}, from the ${change.source}`;
  const inert =
    policy.inert.length === 0 ? "" : ` (${policy.inert.join(", ")} not in the taxonomy; ignored)`;
  const projects = COUNTED.map((level) => {
    const count = report.perProject.filter((each) => each.level === level).length;
    return `${count} ${LEVEL_LABELS[level].toLowerCase()}`;
  });
  const bound =
    project === null || project.boundAlias === "" ? "" : ` (bound to ${project.boundAlias})`;
  const NAME_STATE_TEXT = {
    missing: " (missing on the server)",
    recreated: " (re-created on the server)",
    purged: " (removed by the operator)",
  } as const;
  const shared =
    project === null || !isSharedName(project.boundAlias)
      ? ""
      : ` shared as ${project.boundAlias.slice(NAME_PREFIX.length)}${project.nameState === undefined || project.nameState === null ? "" : NAME_STATE_TEXT[project.nameState]}`;
  const heldNames = project?.namesHeld === true ? " · names held" : "";
  const lines = [
    `sharing   epoch ${policy.epoch} · ${last}`,
    `roots     ${shareListText([...policy.roots])}`,
    `areas     ${shareListText([...policy.areas])}${inert}`,
    ...policy.problems
      .filter((problem) => !problem.startsWith(INERT_PROBLEM))
      .map((problem) => `problem   ${problem}`),
    `projects  ${projects.join(" · ")}`,
    `this      ${project === null ? "not a known project" : `${project.name}: ${LEVEL_LABELS[project.level]}${bound}${shared}${heldNames}`}`,
    `leaves    ${plural(report.counts.entries, "entry", "entries")} · ${plural(report.counts.memories, "memory", "memories")}`,
  ];
  if (report.items === undefined) return lines;
  const { entries, memories, more } = report.items;
  for (const entry of entries) {
    lines.push(`entry   ${entry.scope}/${entry.slug}  ${entry.area}  ${entry.title}`);
  }
  if (more.entries > 0) lines.push(`+${more.entries} more`);
  for (const memory of memories) lines.push(`memory  ${memory.id}  ${memory.title}`);
  if (more.memories > 0) lines.push(`+${more.memories} more`);
  return lines;
}

/**
 * `share status [--list]`: what is shared and what would leave, counted after the index is
 * brought up to date with the repositories' files.
 */
const status: Subcommand = (argv) => {
  const { options, values, rest } = parseWith(argv, ["--list"], ["--server"]);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  return ({ db, dataDir, now, policyFor }) => {
    const serverId = serverFor(db, values.get("--server"));
    const policy = policyFor(serverId);
    const destination = chosenDestination(serverId);
    const report = wouldLeave(db, dataDir, process.env, policy, {
      now,
      fresh: true,
      list: options.has("--list"),
      destination,
    });
    const here = findProject(db, process.cwd());
    const ofProject = here === null ? destination : destinationOf(db, policy, here.id);
    const level = here === null ? "local" : levelOf(policy, here.id, ofProject).level;
    const row = here === null ? undefined : policy.levels.get(levelKey(here.id, ofProject));
    const boundAlias = level === "local" ? "" : (row?.boundAlias ?? "");
    const nameState =
      here !== null && serverId !== null && isSharedName(boundAlias)
        ? nameStateOf(db, serverId, boundAlias)
        : null;
    const server = serverId === null ? null : findServer(db, serverId);
    const namesHeld =
      server !== null &&
      boundAliasesOf(db, server.serverId).some((alias) => heldByContract(server, alias));
    const current =
      here === null ? null : { name: here.name, level, boundAlias, nameState, namesHeld };
    const projectName = (id: number) =>
      db.query<{ name: string }, [number]>("SELECT name FROM projects WHERE id = ?").get(id)
        ?.name ?? null;
    for (const line of formatShareStatus(policy, report, current, lastChange(db), projectName)) {
      out(line);
    }
  };
};

// --- explain ------------------------------------------------------------------------------

/**
 * `share explain <scope>/<slug>` and `share explain memory <id>`: the ruling for one item,
 * with its reason. `project/<slug>` is an entry of the current folder's project.
 */
const explain: Subcommand = (argv) => {
  const { values, rest } = parseWith(argv, [], ["--server"]);
  const [first, second, ...more] = rest;
  const ofMemory = first === "memory";
  const misses = ofMemory ? second === undefined : second !== undefined;
  if (first === undefined || more.length > 0 || misses) {
    throw new UsageError("explain takes <scope>/<slug>, or memory <id>");
  }
  if (ofMemory && !/^\d+$/.test(second ?? "")) {
    throw new UsageError("explain memory <id>: the id is the memory's number");
  }
  const ref = ofMemory ? `memory ${second}` : first;
  return ({ db, policyFor }) => {
    const serverId = serverFor(db, values.get("--server"));
    const policy = policyFor(serverId);
    const destination = chosenDestination(serverId);
    const generation = generationOf(db);
    // A store with no generation never ran the sharing schema: no memory has a uid in it.
    const item: Item | null = !ofMemory
      ? findEntry(db, ref, findProject(db, process.cwd())?.id ?? null, destination)
      : generation === null
        ? null
        : findMemory(db, process.env, generation, Number(second));
    if (item === null) throw new Refusal(`${ref}: not found`);
    const records = ledgerRecords(db, destination, item.kind).get(item.uid) ?? [];
    const { answer, reason } = decide(policy, destination, item, records);
    out(`${ref}: ${answer} · ${reason} · ${REASON_TEXT[reason]}`);
    // With a server: the item's ledger history, the applied rows included (ADR 0027).
    if (serverId === null) return;
    const when = (at: number) => new Date(at).toISOString();
    for (const row of ledgerHistory(db, destination, item.kind, item.uid)) {
      const withdrawn =
        row.withdrawnAt === null
          ? ""
          : ` · withdrawn ${when(row.withdrawnAt)}${row.reason === "" ? "" : ` (${row.reason})`}`;
      out(
        `  ledger: ${row.direction} · revision ${row.version} · hash ${row.hash.slice(0, 8)} · ${when(row.at)}${withdrawn}`,
      );
    }
  };
};

// --- server -------------------------------------------------------------------------------

/** The invitation code: `--code`, else typed on the terminal with no echo; refused elsewhere. */
function codeFrom(values: Map<string, string>): string {
  const given = values.get("--code") ?? askSecret("Invitation code:");
  if (given === null)
    throw new Refusal("an invitation code is needed: --code <code>, or run on a terminal");
  return given;
}

const counts = (report: { counts: { entries: number; memories: number } }): string =>
  `would leave: ${plural(report.counts.entries, "entry", "entries")} · ${plural(report.counts.memories, "memory", "memories")}`;

/**
 * `share server add <url>`: the join, the pending row, the counts, the yes that confirms, and
 * the sync started. A no leaves the row pending; without a terminal `--yes` is required.
 */
const serverAdd: Subcommand = (argv) => {
  const { options, values, rest } = parseWith(
    argv,
    ["--yes", "--no-sync"],
    ["--code", "--label", "--name"],
  );
  const [url, ...more] = rest;
  if (url === undefined || more.length > 0) throw new UsageError("server add takes one URL");
  return async ({ db, now, sync }) => {
    const code = codeFrom(values);
    const ctx = sync();
    const joined = await joinServer(ctx, {
      url,
      code,
      ...(values.has("--label") ? { label: values.get("--label") as string } : {}),
      ...(values.has("--name") ? { name: values.get("--name") as string } : {}),
    });
    if (!joined.ok) throw new Refusal(joined.message);
    out(`joined ${joined.host}: ${joined.member.name} (${joined.member.role})`);
    out(counts(joined.wouldLeave));
    const yes =
      options.has("--yes") || askYesNo(`Share with ${joined.host} as listed above?`, false);
    if (!yes) {
      throw new Refusal(
        terminalIo.isTTY
          ? "not confirmed: share server add again"
          : "confirming needs --yes when nobody can confirm; the server is listed as pending (share server add again)",
      );
    }
    confirmJoin(ctx, joined.serverId);
    out(`confirmed ${joined.host}${joined.first ? " (your levels now name it)" : ""}`);
    if (!options.has("--no-sync")) startSync(db, process.env, now);
  };
};

/** `share server rejoin <server>`: a new code, a new device; everything else stays. */
const serverRejoin: Subcommand = (argv) => {
  const { values, rest } = parseWith(argv, [], ["--code", "--label"]);
  const [ref, ...more] = rest;
  if (ref === undefined || more.length > 0) throw new UsageError("server rejoin takes one server");
  return async ({ sync }) => {
    const code = codeFrom(values);
    const rejoined = await rejoinServer(sync(), ref, {
      code,
      ...(values.has("--label") ? { label: values.get("--label") as string } : {}),
    });
    if (!rejoined.ok) throw new Refusal(rejoined.message);
    out(
      `rejoined ${rejoined.serverId}: ${rejoined.member.name} (${rejoined.member.role}); the sync starts with the next session`,
    );
  };
};

/** One line of `share server list`. */
export function formatServerLine(server: ServerStatus): string {
  const state = server.remedy === null ? server.state : `${server.state}: ${server.remedy}`;
  return `${server.name}  ${server.host}  ${server.member} (${server.role})  contract ${server.contract}  cursor ${server.cursor}  ${state}`;
}

const serverList: Subcommand = (argv) => {
  if (argv.length > 0) throw new UsageError(`unexpected argument ${argv[0]}`);
  return ({ db, dataDir }) => {
    const servers = statusReport(db, dataDir);
    if (servers.length === 0) out("no server; share server add <url> --code <code>");
    for (const server of servers) out(formatServerLine(server));
  };
};

/** `share server remove <server> [--withdraw] [--yes]`. */
const serverRemove: Subcommand = (argv) => {
  const { options, rest } = parseWith(argv, ["--withdraw", "--yes"], []);
  const [ref, ...more] = rest;
  if (ref === undefined || more.length > 0) throw new UsageError("server remove takes one server");
  return async ({ sync }) => {
    const removed = await removeServer(sync(), ref, {
      withdraw: options.has("--withdraw"),
      yes: options.has("--yes"),
    });
    if (!removed.ok) throw new Refusal(removed.message);
    out(
      `removed ${removed.name}: ${plural(removed.levels, "level")} and ${plural(removed.rows, "ledger row")} deleted; the device stays listed on the server until an admin revokes it`,
    );
  };
};

const serverMute =
  (muted: boolean): Subcommand =>
  (argv) => {
    const { values, rest } = parseWith(argv, [], ["--member"]);
    const [ref, ...more] = rest;
    if (ref === undefined || more.length > 0)
      throw new UsageError(`server ${muted ? "mute" : "unmute"} takes one server`);
    return ({ sync }) => {
      const outcome = muteServer(sync(), ref, {
        muted,
        ...(values.has("--member") ? { memberId: values.get("--member") as string } : {}),
      });
      if (!outcome.ok) throw new Refusal(outcome.message);
      const who = values.has("--member") ? `member ${values.get("--member")} of ` : "";
      out(`${muted ? "muted" : "unmuted"} ${who}${outcome.serverId}`);
    };
  };

/** `share server resume [<server>] [--yes]`: the withdrawal sweep's preview and the release (D-10). */
const serverResume: Subcommand = (argv) => {
  const { options, rest } = parseWith(argv, ["--yes"], []);
  if (rest.length > 1) throw new UsageError("server resume takes at most one server");
  return ({ db, now, sync }) => {
    const ctx = sync();
    const previews = resumePreview(ctx, rest[0] ?? null);
    if ("ok" in previews) throw new Refusal(previews.message);
    const held = previews.filter((p) => p.hold !== null || p.total > 0);
    if (held.length === 0) {
      out("no withdrawal is held");
      return;
    }
    for (const preview of held) {
      const why = preview.hold === null ? "no hold" : `held (${preview.hold.reason})`;
      out(
        `${preview.name}: ${why}; the next sweep would take back ${plural(preview.total, "item")}`,
      );
      for (const project of preview.perProject) {
        out(`  project ${project.projectId ?? "-"}: ${plural(project.count, "item")}`);
      }
    }
    const yes =
      options.has("--yes") ||
      askYesNo("Release the hold and let the sweep take these back?", false);
    if (!yes) {
      throw new Refusal(
        terminalIo.isTTY
          ? "not released; nothing was changed"
          : "releasing needs --yes when nobody can confirm",
      );
    }
    const { released } = resumeServer(ctx, held);
    out(`released ${released.join(", ")}; the sweep withdraws what was shown`);
    startSync(db, process.env, now);
  };
};

const SERVER_SUBCOMMANDS = new Map<string, Subcommand>([
  ["add", serverAdd],
  ["rejoin", serverRejoin],
  ["list", serverList],
  ["remove", serverRemove],
  ["mute", serverMute(true)],
  ["unmute", serverMute(false)],
  ["resume", serverResume],
]);

/** `share server <command>`: the servers this machine syncs with. */
const server: Subcommand = (argv) => {
  const [name, ...rest] = argv;
  const subcommand = name === undefined ? undefined : SERVER_SUBCOMMANDS.get(name);
  if (subcommand === undefined) {
    throw new UsageError(
      name === undefined ? "server takes a command" : `unknown server command ${name}`,
    );
  }
  return subcommand(rest);
};

const SUBCOMMANDS = new Map<string, Subcommand>([
  ["project", project],
  ["names", names],
  ["name", nameForget],
  ["roots", list("roots")],
  ["areas", list("areas")],
  ["status", status],
  ["explain", explain],
  ["server", server],
]);

/** The sync client's context over the command's store: the real clock and network. */
function syncContextOf(db: Db, dataDir: string, storeDir: string): SyncContext {
  return {
    db,
    dataDir,
    storeDir,
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    clock: realClock,
    timers: realTimers,
    pid: process.pid,
    version: pkg.version,
    log: (line) => process.stderr.write(`${line}\n`),
  };
}

/**
 * `wizardingcode-mem share <command>`: what may leave this machine for the team's server,
 * from a shell. Nothing is sent from here: the command sets and shows the policy.
 */
export async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  let db: Db | undefined;
  try {
    const subcommand = command === undefined ? undefined : SUBCOMMANDS.get(command);
    if (subcommand === undefined) {
      throw new UsageError(
        command === undefined ? "a command is needed" : `unknown command ${command}`,
      );
    }
    const act = subcommand(rest);
    const { dataDir, storeDir } = resolvePaths();
    db = openDb({ dataDir: storeDir, busyTimeoutMs: 5000 });
    const now = Date.now();
    const opened = db;
    await act({
      db,
      dataDir,
      storeDir,
      now,
      policy: policyInForce(db, dataDir, process.env, now),
      sync: () => syncContextOf(opened, dataDir, storeDir),
      policyFor: (serverId) =>
        policyInForce(opened, dataDir, process.env, now, serverId ?? undefined),
    });
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`wizardingcode-mem: ${error.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    }
    // A refusal is the answer to the person; anything else is a fault worth a log line.
    if (!(error instanceof Refusal)) logError("share", error);
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    db?.close();
  }
}
