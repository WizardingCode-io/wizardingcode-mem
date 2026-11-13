// The host's two changing verbs (ADR 0033): `follow`, which the timer runs, and `upgrade`,
// which the operator types. Both read the facts in the rule's order and stop at the first
// row that decides; only row 17 changes anything.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { olderThan } from "../util/version.ts";
import { apply, type Ctx, type Ended, reconcile } from "./apply.ts";
import { FLOOR_BYTES, MIN_COMPOSE } from "./bounds.ts";
import type { Deps } from "./deps.ts";
import {
  type Container,
  composeVersion,
  findContainer,
  healthOf,
  iso,
  pullCandidate,
  runningFacts,
  verify,
} from "./docker.ts";
import { type EnvLine, isLink, readEnvLine } from "./files.ts";
import { latestDigest } from "./registry.ts";
import { type CandidateFacts, decide, EXIT, type Facts, type RunningFacts } from "./rule.ts";
import {
  appendHistory,
  readState,
  type State,
  StateRefused,
  stateDir,
  writeState,
} from "./state.ts";

const RUNBOOK = "see Rollback in docs/runbooks/team-server.md";
const MIB = 1024 * 1024;
const mib = (bytes: number | null): string =>
  bytes === null ? "an unknown number of" : String(Math.floor(bytes / MIB));

interface Read {
  container: Container | null;
  env: EnvLine;
  running?: RunningFacts;
  digest?: string | null;
  verifierSaid?: string;
  pullFailed?: string;
  candidate?: { id: string; facts: CandidateFacts };
}

/** The sentence a person reads for an outcome that changed nothing. */
function sentence(row: number, outcome: string, read: Read, state: State, folder: string): string {
  const { running, candidate } = read;
  switch (outcome) {
    case "cannot-check":
      if (row === 1) return "Docker did not answer";
      if (row === 5) return "the running server did not answer serve status";
      if (row === 6) return "the registry did not give the digest of latest";
      if (row === 9) return "the verifier could not run";
      return `the image could not be pulled or read: ${read.pullFailed ?? "unknown"}`;
    case "starting":
      return "the server is starting; nothing was looked at";
    case "down":
      return state.lastChange?.kind === "down"
        ? `the server is not running healthy: ${state.lastChange.reason}; ${RUNBOOK}`
        : "the server is not running healthy";
    case "env-differs":
      return `.env names ${read.env.value} and ${read.container?.imageRef ?? "nothing"} runs; settle that first`;
    case "current":
      return `${running?.version} is what latest names`;
    case "rejected": {
      const entry = state.rejected?.find((r) => r.digest === read.digest);
      return `${entry?.version} (${read.digest}) failed to start here on ${iso(entry?.at ?? 0)}; log ${entry?.log ?? "none"}`;
    }
    case "not-verified":
      return `${read.digest} did not verify as signed by distribute.yml at main; the verifier said: ${read.verifierSaid ?? ""}`;
    case "low-disk": {
      const needed = FLOOR_BYTES + (row === 16 ? (running?.dbBytes ?? 0) : 0);
      return `${mib(running?.freeBytes ?? null)} MiB free on the data volume, ${Math.ceil(needed / MIB)} MiB needed`;
    }
    case "not-higher":
      return `latest names ${candidate?.facts.version}, which is not higher than ${running?.version}`;
    case "waits-migration":
      return `${candidate?.facts.version} migrates the team schema (${running?.schema} to ${candidate?.facts.teamSchema}); run ${folder}/upgrade.sh upgrade`;
    case "waits-contract": {
      const gone = running?.accepts.find((n) => !candidate?.facts.accepts.includes(n));
      return `${candidate?.facts.version} no longer accepts contract ${gone}; run ${folder}/upgrade.sh upgrade`;
    }
    default:
      return `${running?.version} -> ${candidate?.facts.version}`;
  }
}

async function runVerb(
  deps: Deps,
  folder: string,
  verb: "follow" | "upgrade",
  dryRun: boolean,
): Promise<number> {
  const refuse = (message: string): number => {
    deps.err(`wizardingcode-mem serve host ${verb}: ${message}`);
    return EXIT.unavailable;
  };
  // The lock's marker: a guard against the tool typed by hand, not a control.
  if (deps.env.WIZARDINGCODE_MEM_HOST_LOCKED !== "1")
    return refuse(`run it through ${folder}/upgrade.sh, which takes the lock`);
  const envFile = join(folder, ".env");
  const stateFile = join(stateDir(folder), "state.json");
  if (isLink(envFile)) return refuse(`${envFile} is a symbolic link`);
  if (isLink(stateFile)) return refuse(`${stateFile} is a symbolic link`);
  if (!existsSync(envFile)) return refuse(`${envFile} is missing`);
  if (dryRun)
    deps.out(
      "dry run: may download the candidate and remove an older candidate's image; changes no container, .env or state",
    );

  let state: State | undefined;
  const read: Read = { container: null, env: { value: "", version: "", digest: null } };
  /** Ends the run: the state's last run and the history unless this is a dry run, then the lines. */
  const finish = (ended: Ended): number => {
    if (!dryRun) {
      try {
        state ??= readState(folder);
      } catch (error) {
        if (error instanceof StateRefused) return refuse(error.message);
        throw error;
      }
      mkdirSync(stateDir(folder), { recursive: true, mode: 0o700 });
      const candidate =
        read.candidate !== undefined && typeof read.digest === "string"
          ? { candidate: { version: read.candidate.facts.version, digest: read.digest } }
          : {};
      state.lastRun = {
        verb,
        outcome: ended.outcome,
        exit: ended.exit,
        at: deps.now(),
        ...candidate,
      };
      writeState(deps.writer, folder, state);
      if (ended.changed || ended.exit !== EXIT.ok)
        appendHistory(
          deps.writer,
          folder,
          [
            iso(deps.now()),
            verb,
            ended.outcome,
            ended.exit,
            ended.versions?.from ?? read.running?.version ?? "",
            ended.versions?.to ?? read.candidate?.facts.version ?? "",
          ].join("\t"),
        );
    }
    for (const line of ended.lines) deps.out(dryRun ? `would: ${line}` : line);
    return ended.exit;
  };
  const unchanged = (row: number, outcome: string, exit: number): number =>
    finish({
      exit,
      outcome,
      lines: [`${outcome}: ${sentence(row, outcome, read, state ?? { format: 1 }, folder)}`],
      changed: false,
    });

  const compose = composeVersion(deps);
  if (compose === null) return unchanged(1, "cannot-check", EXIT.cannotCheck);
  if (olderThan(compose, MIN_COMPOSE))
    return refuse(`Docker Compose ${compose} is older than ${MIN_COMPOSE}, which this tool needs`);

  let found = findContainer(deps, folder);
  if (found.kind === "silent") return unchanged(1, "cannot-check", EXIT.cannotCheck);
  if (found.kind === "many")
    return refuse(`more than one server container belongs to ${folder}: ${found.names.join(", ")}`);
  if (found.kind === "one") {
    const { imageRef, volume } = found.container;
    if (
      !imageRef.startsWith(`${deps.target.image}:`) &&
      !imageRef.startsWith(`${deps.target.image}@`)
    )
      return refuse(`the server runs ${imageRef}, which is not an image of ${deps.target.image}`);
    if (volume === null) return refuse("the server's container has no volume at /data");
  }
  const env = readEnvLine(readFileSync(envFile, "utf8"));
  if (env === null)
    return refuse(
      `${envFile} must have one line WIZARDINGCODE_MEM_VERSION=<a>.<b>.<c> (or <a>.<b>.<c>@sha256:<digest>)`,
    );
  read.env = env;
  try {
    state = readState(folder);
  } catch (error) {
    if (error instanceof StateRefused) return refuse(error.message);
    throw error;
  }
  const ctx: Ctx = { deps, folder, state, verb };

  if (state.intent !== undefined) {
    if (dryRun) {
      deps.out(
        `would: finish the interrupted apply of ${state.intent.version} first; run ${folder}/upgrade.sh ${state.intent.attended ? "upgrade" : "follow"}`,
      );
      return EXIT.waits;
    }
    mkdirSync(stateDir(folder), { recursive: true, mode: 0o700 });
    const ended = reconcile(ctx, state.intent, found.kind === "one" ? found.container : null);
    if (ended !== null) return finish(ended);
    // The intent is settled; what runs and what .env names may both have changed.
    found = findContainer(deps, folder);
    if (found.kind === "silent" || found.kind === "many")
      return unchanged(1, "cannot-check", EXIT.cannotCheck);
    read.env = readEnvLine(readFileSync(envFile, "utf8")) ?? env;
  }

  const container = found.kind === "one" ? found.container : null;
  read.container = container;
  const facts: Facts = {
    attended: verb === "upgrade",
    rejected: (state.rejected ?? []).map((r) => r.digest),
    floorBytes: FLOOR_BYTES,
    docker: "ok",
  };
  for (;;) {
    const decided = decide(facts);
    if ("outcome" in decided) {
      if (decided.outcome !== "apply") return unchanged(decided.row, decided.outcome, decided.exit);
      break;
    }
    switch (decided.need) {
      case "container":
        facts.container = healthOf(container);
        break;
      case "envMatches":
        facts.envMatches = container?.imageRef.endsWith(`:${read.env.value}`) === true;
        break;
      case "running": {
        const running = runningFacts(deps, container as Container);
        facts.running = running;
        if (running !== "unreadable") read.running = running;
        break;
      }
      case "candidateDigest":
        read.digest = await latestDigest({
          fetch: deps.fetch,
          target: deps.target,
          timeoutMs: deps.bounds.registry,
        });
        facts.candidateDigest = read.digest;
        break;
      case "verification": {
        const verified = verify(deps, read.digest as string);
        if (typeof verified === "string") facts.verification = verified;
        else {
          facts.verification = "not-verified";
          read.verifierSaid = verified.notVerified;
        }
        break;
      }
      case "candidate": {
        const pulled = pullCandidate(deps, read.digest as string, [
          container?.imageId,
          state.previous?.id,
        ]);
        if ("failed" in pulled) {
          facts.candidate = null;
          read.pullFailed = pulled.failed;
        } else {
          facts.candidate = pulled.facts;
          read.candidate = pulled;
        }
        break;
      }
      default:
        facts.docker = "ok";
    }
  }

  const running = read.running as RunningFacts;
  const candidate = read.candidate as { id: string; facts: CandidateFacts };
  if (dryRun)
    return finish({
      exit: EXIT.ok,
      outcome: "apply",
      lines: [`apply: ${sentence(17, "apply", read, state, folder)}`],
      changed: false,
    });
  mkdirSync(stateDir(folder), { recursive: true, mode: 0o700 });
  return finish(
    apply(
      ctx,
      { digest: read.digest as string, id: candidate.id, version: candidate.facts.version },
      { container: container as Container, version: running.version, schema: running.schema },
      verb === "upgrade",
    ),
  );
}

/** The timer's verb: applies only what the rule's every row lets pass. */
export function follow(deps: Deps, folder: string, options: { dryRun: boolean }): Promise<number> {
  return runVerb(deps, folder, "follow", options.dryRun);
}

/** The operator's verb: also across a migration, a dropped contract, and a rejected release. */
export function upgrade(deps: Deps, folder: string): Promise<number> {
  return runVerb(deps, folder, "upgrade", false);
}
