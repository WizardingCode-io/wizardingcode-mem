// `serve host status` (ADR 0033): where a team server's host stands, for an operator who
// last looked months ago. It reads Docker, .env, the state and the lock's note; it writes
// nothing, starts nothing and asks no registry.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import { findContainer, healthOf, iso, runningFacts } from "./docker.ts";
import { isLink, readEnvLine } from "./files.ts";
import { EXIT } from "./rule.ts";
import { shownText } from "./run.ts";
import { readState, type State, StateRefused, stateDir } from "./state.ts";

const RUNBOOK = "see Rollback in docs/runbooks/team-server.md";

/** `ms` as the largest of seconds, minutes, hours and days that gives at least 1. */
function age(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** The verb and the time of the run that holds the lock, from the launcher's `lock.info`. */
function holder(folder: string): string {
  const path = join(stateDir(folder), "lock.info");
  if (isLink(path) || !existsSync(path)) return "";
  const [verb, , since] = readFileSync(path, "utf8").split("\n");
  return verb && since ? ` by ${shownText(verb, 20)} since ${shownText(since, 30)}` : "";
}

export async function status(
  deps: Deps,
  folder: string,
  lock: "held" | "free" | undefined,
): Promise<number> {
  const found = findContainer(deps, folder);
  if (found.kind === "silent") {
    deps.err("wizardingcode-mem serve host status: Docker did not answer");
    return EXIT.cannotCheck;
  }
  if (found.kind === "many") {
    deps.err(
      `wizardingcode-mem serve host status: more than one server container belongs to ${folder}: ${found.names.join(", ")}`,
    );
    return EXIT.unavailable;
  }
  let state: State;
  try {
    state = readState(folder);
  } catch (error) {
    if (!(error instanceof StateRefused)) throw error;
    deps.err(`wizardingcode-mem serve host status: ${error.message}`);
    return EXIT.unavailable;
  }
  const now = deps.now();
  const container = found.kind === "one" ? found.container : null;
  const healthy = healthOf(container) === "healthy";
  const envFile = join(folder, ".env");
  const env =
    existsSync(envFile) && !isLink(envFile) ? readEnvLine(readFileSync(envFile, "utf8")) : null;
  const envDiffers =
    container !== null && (env === null || !container.imageRef.endsWith(`:${env.value}`));

  if (container === null) deps.out(`runs: nothing (no server container in ${folder})`);
  else if (container.state !== "running")
    deps.out(`runs: nothing healthy (the container is ${shownText(container.state, 20)})`);
  else {
    const facts = runningFacts(deps, container);
    const version = facts === "unreadable" ? "an unknown version" : facts.version;
    const digest = facts === "unreadable" ? null : facts.digest;
    const since = Number.isNaN(Date.parse(container.startedAt))
      ? "an unknown time"
      : iso(Date.parse(container.startedAt));
    deps.out(
      `runs: ${version} (${digest ?? "no digest"}), ${shownText(container.health, 20)}, since ${since}`,
    );
    if (envDiffers) deps.out(`.env: names ${env?.value ?? "no version"}, which is not what runs`);
    if (facts !== "unreadable") deps.out(`schema: ${facts.schema}`);
  }

  const change = state.lastChange;
  deps.out(
    change === undefined
      ? "last change: none"
      : `last change: ${change.kind} ${change.from} -> ${change.to}, ${age(now - change.at)} ago${
          change.reason !== undefined && change.kind !== "rejected"
            ? `: ${shownText(change.reason)}`
            : ""
        }`,
  );
  const run = state.lastRun;
  deps.out(
    run === undefined
      ? "last run: none"
      : `last run: ${run.verb} ${run.outcome} (exit ${run.exit}), ${age(now - run.at)} ago`,
  );
  const intent = state.intent;
  if (intent !== undefined)
    deps.out(
      `interrupted: an ${intent.attended ? "attended" : "unattended"} apply of ${intent.version} begun ${age(now - intent.at)} ago`,
    );
  for (const rejected of state.rejected ?? [])
    deps.out(
      `rejected: ${rejected.version} ${rejected.digest}, ${age(now - rejected.at)} ago: ${shownText(rejected.reason)} (log ${rejected.log ?? "none"})`,
    );
  const waits = run?.outcome.startsWith("waits-") === true && run.candidate !== undefined;
  if (waits)
    deps.out(
      `waits: ${run?.candidate?.version} (${run?.outcome}); run ${folder}/upgrade.sh upgrade`,
    );
  if (lock === "held") deps.out(`lock: held${holder(folder)}`);
  if (lock === "free") deps.out("lock: free");
  deps.out(`tool: ${deps.version}`);

  let next = "nothing to do";
  if (intent !== undefined) next = `${folder}/upgrade.sh ${intent.attended ? "upgrade" : "follow"}`;
  else if (!healthy) next = RUNBOOK;
  else if (envDiffers) next = "docker compose up -d server, or put .env back";
  else if (waits) next = `${folder}/upgrade.sh upgrade`;
  else if (run?.outcome === "rejected")
    next = `${folder}/upgrade.sh upgrade, to try the rejected release again`;
  deps.out(`next: ${next}`);
  return EXIT.ok;
}
