// The apply, a failed start, and an apply that was interrupted (ADR 0033). The intent is
// written before .env changes, so that a kill or a reboot at any step leaves something the
// next run reads right. Unattended, a failed start goes back by the previous image when the
// database's schema did not move; attended, nothing is undone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import {
  type Container,
  composeOf,
  findContainer,
  healthOf,
  iso,
  removeOtherImages,
  saveLogs,
  schemaWith,
  stopServer,
  upWait,
} from "./docker.ts";
import { envLineBody, modeOf, replaceFile, withEnvBody, withEnvLine } from "./files.ts";
import { EXIT } from "./rule.ts";
import { appendHistory, type Intent, pushRejected, type State, writeState } from "./state.ts";

const RUNBOOK = "see Rollback in docs/runbooks/team-server.md";

export interface Ctx {
  deps: Deps;
  folder: string;
  state: State;
  verb: "follow" | "upgrade";
}

/** How a run ends: its exit, the outcome's name for the state, and the lines a person reads, the last one first in importance. */
export interface Ended {
  exit: number;
  outcome: string;
  lines: string[];
  /** Something on the host changed, so the history gets a line. */
  changed: boolean;
  versions?: { from: string; to: string };
}

const envPath = (folder: string): string => join(folder, ".env");

function describe(container: Container | null): string {
  if (container === null) return "no container";
  const exit = container.state === "running" ? "" : ` (exit ${container.exitCode})`;
  return `the container is ${container.state}${exit}, health ${container.health}`;
}

/** Rewrites the one line of .env, at the mode the file has. */
function writeEnv(ctx: Ctx, text: string): void {
  const path = envPath(ctx.folder);
  replaceFile(ctx.deps.writer, path, text, modeOf(path));
}

/**
 * Starts the server and waits for health, then reads what runs. A container that exited with
 * code 1 may have met a fresh lease (30 s after an unclean stop): the lease's length is
 * waited out and the start tried once more. A second failure is a failure.
 */
function waitHealthy(
  ctx: Ctx,
  compose: string[],
  waitMs: number,
  wantId: string,
): { ok: boolean; container: Container | null } {
  const { deps } = ctx;
  for (let attempt = 0; ; attempt++) {
    upWait(deps, compose, waitMs);
    const found = findContainer(deps, ctx.folder);
    const container = found.kind === "one" ? found.container : null;
    if (container !== null && healthOf(container) === "healthy" && container.imageId === wantId)
      return { ok: true, container };
    const lease =
      container !== null &&
      (container.state === "exited" || container.state === "restarting") &&
      container.exitCode === 1;
    if (attempt === 0 && lease) {
      deps.sleep(deps.leaseMs + deps.bounds.leaseMargin);
      continue;
    }
    return { ok: false, container };
  }
}

/** The intent's change recorded as applied, with what ran before it. */
function recordApplied(ctx: Ctx, intent: Intent): void {
  ctx.state.lastChange = {
    kind: "applied",
    from: intent.fromVersion,
    to: intent.version,
    at: ctx.deps.now(),
  };
  ctx.state.previous = {
    id: intent.fromId,
    version: intent.fromVersion,
    envLine: intent.fromEnvLine,
  };
  delete ctx.state.intent;
  writeState(ctx.deps.writer, ctx.folder, ctx.state);
}

/**
 * A start that failed, unattended. With `reject`, a container of the candidate was seen
 * failing: its log is saved first and its digest rejected once the previous image runs
 * again. Without it (the run was cut and nothing shows the release to be bad), the previous
 * image is started and nothing is rejected: `null` then says "go on".
 */
export function failedStartUnattended(
  ctx: Ctx,
  intent: Intent,
  seen: { reject: boolean; container: Container | null },
): Ended | null {
  const { deps, folder, state } = ctx;
  const compose = composeOf(intent);
  const versions = { from: intent.fromVersion, to: intent.version };
  let log: string | undefined;
  if (seen.reject && seen.container !== null) {
    log = saveLogs(deps, folder, seen.container.id, intent.version);
    // A restart loop is stopped so that it writes nothing more; an unhealthy server is left serving.
    if (seen.container.state !== "running") stopServer(deps, compose);
  }
  // Never by asking the candidate: the previous image says whether it can still read the data.
  const schema = schemaWith(deps, intent.fromId, intent.volume);
  let reason: string;
  if (schema === "newer") {
    reason = `${intent.version} migrated the database although it reported schema ${intent.schema}`;
  } else if (schema === "unreadable" || schema.schema !== intent.schema) {
    reason = "the database's schema could not be read with the previous image";
  } else {
    const text = readFileSync(envPath(folder), "utf8");
    if (envLineBody(text) !== intent.fromEnvLine)
      writeEnv(ctx, withEnvBody(text, intent.fromEnvLine));
    const back = waitHealthy(ctx, compose, deps.bounds.waitUnattended, intent.fromId);
    if (back.ok) {
      delete state.intent;
      if (!seen.reject) {
        writeState(deps.writer, folder, state);
        appendHistory(
          deps.writer,
          folder,
          [iso(deps.now()), ctx.verb, "interrupted", 0, versions.from, versions.to].join("\t"),
        );
        return null;
      }
      const why = describe(seen.container);
      pushRejected(state, {
        digest: intent.digest,
        version: intent.version,
        at: deps.now(),
        reason: why,
        ...(log === undefined ? {} : { log }),
      });
      state.lastChange = {
        kind: "rejected",
        ...versions,
        at: deps.now(),
        reason: why,
        ...(log === undefined ? {} : { log }),
      };
      writeState(deps.writer, folder, state);
      return {
        exit: EXIT.rejected,
        outcome: "rejected",
        lines: [
          `rejected: ${versions.to} did not start; ${versions.from} runs again; log ${log ?? "none"}`,
        ],
        changed: true,
        versions,
      };
    }
    reason = `${versions.from} did not come back healthy after ${versions.to} failed to start`;
  }
  delete state.intent;
  state.lastChange = {
    kind: "down",
    ...versions,
    at: deps.now(),
    reason,
    ...(log === undefined ? {} : { log }),
  };
  writeState(deps.writer, folder, state);
  return {
    exit: EXIT.down,
    outcome: "down",
    lines: [`down: ${reason}; ${RUNBOOK}`],
    changed: true,
    versions,
  };
}

/** A start that failed, attended: the log, what runs, and what the operator does next. Nothing is undone. */
function failedStartAttended(ctx: Ctx, intent: Intent, container: Container | null): Ended {
  const { deps, folder, state } = ctx;
  const versions = { from: intent.fromVersion, to: intent.version };
  const log = container === null ? undefined : saveLogs(deps, folder, container.id, intent.version);
  const schema = schemaWith(deps, intent.fromId, intent.volume);
  const restore = `docker compose run --rm server serve restore --to-schema ${intent.schema}, then ${RUNBOOK}`;
  const lines = [
    `upgrade-failed: ${describe(container)}; log ${log ?? "none"}; nothing was undone`,
  ];
  if (schema === "newer") lines.push(`the database's schema moved; to go back: ${restore}`);
  else if (schema === "unreadable")
    lines.push(
      `the database's schema could not be read; if \`serve status\` shows a schema above ${intent.schema}: ${restore}`,
    );
  delete state.intent;
  state.lastChange = {
    kind: "upgrade-failed",
    ...versions,
    at: deps.now(),
    reason: describe(container),
    ...(log === undefined ? {} : { log }),
  };
  writeState(deps.writer, folder, state);
  return { exit: EXIT.down, outcome: "upgrade-failed", lines, changed: true, versions };
}

/** Applies a verified candidate: the intent, .env, the start, and what the start gave. */
export function apply(
  ctx: Ctx,
  candidate: { digest: string; id: string; version: string },
  running: { container: Container; version: string; schema: number },
  attended: boolean,
): Ended {
  const { deps, folder, state } = ctx;
  const text = readFileSync(envPath(folder), "utf8");
  const intent: Intent = {
    digest: candidate.digest,
    id: candidate.id,
    version: candidate.version,
    fromId: running.container.imageId,
    fromEnvLine: envLineBody(text) ?? "",
    fromVersion: running.version,
    schema: running.schema,
    project: running.container.project,
    directory: running.container.directory,
    files: running.container.files,
    volume: running.container.volume ?? "",
    attended,
    at: deps.now(),
  };
  state.intent = intent;
  writeState(deps.writer, folder, state);
  writeEnv(ctx, withEnvLine(text, `${candidate.version}@${candidate.digest}`));
  const waitMs = attended ? deps.bounds.waitAttended : deps.bounds.waitUnattended;
  const started = waitHealthy(ctx, composeOf(intent), waitMs, candidate.id);
  if (!started.ok)
    return attended
      ? failedStartAttended(ctx, intent, started.container)
      : (failedStartUnattended(ctx, intent, {
          reject: true,
          container: started.container,
        }) as Ended);
  recordApplied(ctx, intent);
  removeOtherImages(deps, [candidate.id, intent.fromId]);
  return {
    exit: EXIT.ok,
    outcome: "apply",
    lines: [`applied: ${intent.fromVersion} -> ${intent.version}`],
    changed: true,
    versions: { from: intent.fromVersion, to: intent.version },
  };
}

/**
 * An intent found at the start of a run: an apply was interrupted. `null` says the intent is
 * settled and the run goes on; otherwise the run ends here.
 */
export function reconcile(ctx: Ctx, intent: Intent, container: Container | null): Ended | null {
  const { deps, folder, state } = ctx;
  const versions = { from: intent.fromVersion, to: intent.version };
  const health = healthOf(container);
  const note = (what: string) =>
    appendHistory(
      deps.writer,
      folder,
      [iso(deps.now()), ctx.verb, what, 0, versions.from, versions.to].join("\t"),
    );
  if (container !== null && health === "healthy") {
    if (container.imageId === intent.id) {
      recordApplied(ctx, intent);
      note("applied");
      return null;
    }
    if (container.imageId === intent.fromId) {
      const text = readFileSync(envPath(folder), "utf8");
      if (envLineBody(text) !== intent.fromEnvLine)
        writeEnv(ctx, withEnvBody(text, intent.fromEnvLine));
    }
    delete state.intent;
    writeState(deps.writer, folder, state);
    note("interrupted");
    return null;
  }
  if (health === "starting" && deps.now() - intent.at < deps.bounds.intentStarting)
    return {
      exit: EXIT.ok,
      outcome: "starting",
      lines: ["starting: the server is starting; nothing was looked at"],
      changed: false,
    };
  if (intent.attended)
    return {
      exit: EXIT.down,
      outcome: "down",
      lines: [
        `down: an attended upgrade to ${intent.version} was interrupted and the server is not running healthy; nothing was changed; ${RUNBOOK}`,
      ],
      changed: false,
      versions,
    };
  // Only a container of the candidate that was seen failing shows the release to be bad.
  const reject = container !== null && container.imageId === intent.id;
  return failedStartUnattended(ctx, intent, { reject, container });
}
