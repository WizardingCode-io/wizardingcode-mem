import { findProject, remoteAliasOf } from "../../core/project.ts";
import { type SharingKey, validatePatch } from "../../settings/settings.ts";
import { levelKey, levelOf } from "../../sharing/levels.ts";
import { decide, INERT_PROBLEM, loadPolicy } from "../../sharing/policy.ts";
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
  generationOf,
  lastChange,
  previewSettingsPatch,
  reconcileLevels,
  reconcileSettings,
  setLevel,
  setLevelMessage,
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
import { type Db, openDb } from "../../store/db.ts";
import { logError } from "../../util/log.ts";
import { resolvePaths } from "../../util/paths.ts";
import { plural } from "../../util/text.ts";
import { EXIT_USAGE } from "../exit.ts";
import { askYesNo, type PromptIo, terminalIo } from "../prompt.ts";

export const USAGE = `Usage: wizardingcode-mem share <command>

Commands:
  project <level> [--yes]      What the project of the current folder shares with the team
  roots <list|none> [--yes]    The repositories whose knowledge may leave: workspace, shared
  areas <list|none> [--yes]    The areas that may leave, such as workspace:sales
  status [--list]              What is shared and what would leave; --list names each item
  explain <scope>/<slug>       Why one knowledge entry leaves or stays
  explain memory <id>          Why one memory leaves or stays

Levels: ${LEVELS.map((level) => `${level} (${LEVEL_LABELS[level]})`).join(", ")}.
Sharing more asks first; --yes answers for a script. Nothing is sent until a team server
is configured.
`;

/** Bad arguments: the usage is printed and the exit code is 64. */
class UsageError extends Error {}

/** What the command will not do, said to the person as it is: exit code 1, nothing logged. */
class Refusal extends Error {}

/** What a subcommand acts on: the store, and the policy in force once what was pending is recorded. */
interface Context {
  db: Db;
  dataDir: string;
  policy: SharingPolicy;
  now: number;
}

/**
 * A subcommand in two steps: its arguments are read first, so that a usage error opens no
 * store; what comes back acts on the store.
 */
type Subcommand = (argv: string[]) => (context: Context) => void;

const out = (line: string) => process.stdout.write(`${line}\n`);

/** The arguments apart: the options this subcommand takes, and what is left. */
function parse(argv: string[], allowed: string[]): { options: Set<string>; rest: string[] } {
  const options = new Set<string>();
  const rest: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("--")) rest.push(arg);
    else if (allowed.includes(arg)) options.add(arg);
    else throw new UsageError(`unknown option ${arg}`);
  }
  return { options, rest };
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

/**
 * The policy a subcommand acts under: loaded, then what was pending recorded (a hand edit
 * of the env file, a level its project can no longer hold), then loaded again. Under a
 * policy that could not be loaded nothing is recorded: the tables may be a newer version's.
 */
function policyInForce(db: Db, dataDir: string, now: number): SharingPolicy {
  const loaded = loadPolicy(db, dataDir, process.env, now);
  if (loaded.closed) return loaded;
  reconcileSettings(db, dataDir, now);
  reconcileLevels(db, now);
  return loadPolicy(db, dataDir, process.env, now);
}

/** Nothing is changed under a policy that could not be loaded; the person is told why. */
function requireLoaded(policy: SharingPolicy): void {
  if (!policy.closed) return;
  const why = policy.problems[0] ?? "the sharing policy could not be loaded";
  throw new Refusal(`${why}; nothing was changed`);
}

// --- project ------------------------------------------------------------------------------

/**
 * `share project <level> [--yes]`: what the project of the current folder shares. The folder
 * must be a project already: the command makes none. The level is bound to the folder's
 * git remote. What can never be set (no remote, memory off) is refused by `setLevel` before
 * the person is asked anything; a widening is then asked for, and set with the yes.
 */
const project: Subcommand = (argv) => {
  const [level, ...more] = parse(argv, ["--yes"]).rest;
  if (!isLevel(level) || more.length > 0) throw new UsageError(setLevelMessage("invalid"));
  return ({ db, policy, now }) => {
    requireLoaded(policy);
    const here = findProject(db, process.cwd());
    if (here === null) throw new Refusal(setLevelMessage("no-project"));
    const set = (confirm: boolean) =>
      setLevel(db, {
        projectId: here.id,
        destination: TEAM_DESTINATION,
        level,
        source: "cli",
        now,
        confirm,
        remoteAlias: remoteAliasOf(process.cwd()),
      });
    let outcome = set(argv.includes("--yes"));
    if (!outcome.ok && outcome.reason === "needs-confirm") {
      const what = LEVEL_LABELS[level].toLowerCase();
      requireYes(`Share ${what} of ${here.name} with the team?`, argv);
      outcome = set(true);
    }
    if (!outcome.ok) throw new Refusal(setLevelMessage(outcome.reason));
    const unchanged = outcome.old === level && !outcome.rebound;
    out(`sharing: ${here.name} → ${LEVEL_LABELS[level]}${unchanged ? " (unchanged)" : ""}`);
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
    const [value, ...more] = parse(argv, ["--yes"]).rest;
    if (value === undefined || more.length > 0) {
      throw new UsageError(`${which} takes one comma list, or none`);
    }
    const key = LIST_KEYS[which];
    const validated = validatePatch({ [key]: value });
    if (!validated.ok) throw new UsageError(`${which}: ${validated.errors[key]}`);
    return ({ db, dataDir, policy, now }) => {
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
  project: { name: string; level: Level; boundAlias: string } | null,
  change: ChangeRow | null,
): string[] {
  const last =
    change === null
      ? "no change yet"
      : `last change: ${change.what} ${change.old} → ${change.new}, ${new Date(change.at).toISOString()}, from the ${change.source}`;
  const inert =
    policy.inert.length === 0 ? "" : ` (${policy.inert.join(", ")} not in the taxonomy; ignored)`;
  const projects = COUNTED.map((level) => {
    const count = report.perProject.filter((each) => each.level === level).length;
    return `${count} ${LEVEL_LABELS[level].toLowerCase()}`;
  });
  const bound =
    project === null || project.boundAlias === "" ? "" : ` (bound to ${project.boundAlias})`;
  const lines = [
    `sharing   epoch ${policy.epoch} · ${last}`,
    `roots     ${shareListText([...policy.roots])}`,
    `areas     ${shareListText([...policy.areas])}${inert}`,
    ...policy.problems
      .filter((problem) => !problem.startsWith(INERT_PROBLEM))
      .map((problem) => `problem   ${problem}`),
    `projects  ${projects.join(" · ")}`,
    `this      ${project === null ? "not a known project" : `${project.name}: ${LEVEL_LABELS[project.level]}${bound}`}`,
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
  const { options, rest } = parse(argv, ["--list"]);
  if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
  return ({ db, dataDir, policy, now }) => {
    const report = wouldLeave(db, dataDir, process.env, policy, {
      now,
      fresh: true,
      list: options.has("--list"),
    });
    const here = findProject(db, process.cwd());
    const level = here === null ? "local" : levelOf(policy, here.id, TEAM_DESTINATION).level;
    const row = here === null ? undefined : policy.levels.get(levelKey(here.id, TEAM_DESTINATION));
    const boundAlias = level === "local" ? "" : (row?.boundAlias ?? "");
    const current = here === null ? null : { name: here.name, level, boundAlias };
    for (const line of formatShareStatus(policy, report, current, lastChange(db))) out(line);
  };
};

// --- explain ------------------------------------------------------------------------------

/**
 * `share explain <scope>/<slug>` and `share explain memory <id>`: the ruling for one item,
 * with its reason. `project/<slug>` is an entry of the current folder's project.
 */
const explain: Subcommand = (argv) => {
  const [first, second, ...more] = parse(argv, []).rest;
  const ofMemory = first === "memory";
  const misses = ofMemory ? second === undefined : second !== undefined;
  if (first === undefined || more.length > 0 || misses) {
    throw new UsageError("explain takes <scope>/<slug>, or memory <id>");
  }
  if (ofMemory && !/^\d+$/.test(second ?? "")) {
    throw new UsageError("explain memory <id>: the id is the memory's number");
  }
  const ref = ofMemory ? `memory ${second}` : first;
  return ({ db, policy }) => {
    const generation = generationOf(db);
    // A store with no generation never ran the sharing schema: no memory has a uid in it.
    const item: Item | null = !ofMemory
      ? findEntry(db, ref, findProject(db, process.cwd())?.id ?? null)
      : generation === null
        ? null
        : findMemory(db, process.env, generation, Number(second));
    if (item === null) throw new Refusal(`${ref}: not found`);
    const records = ledgerRecords(db, TEAM_DESTINATION, item.kind).get(item.uid) ?? [];
    const { answer, reason } = decide(policy, TEAM_DESTINATION, item, records);
    out(`${ref}: ${answer} · ${reason} · ${REASON_TEXT[reason]}`);
  };
};

const SUBCOMMANDS = new Map<string, Subcommand>([
  ["project", project],
  ["roots", list("roots")],
  ["areas", list("areas")],
  ["status", status],
  ["explain", explain],
]);

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
    act({ db, dataDir, now, policy: policyInForce(db, dataDir, now) });
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
