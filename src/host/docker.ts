// Everything the host's tool asks of Docker (ADR 0033). Each call goes through the injected
// runner with a time bound and an environment that cannot point Docker or Compose elsewhere.
// Nothing an image or a registry answers is evaluated: it is read strictly, or not at all.
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Deps } from "./deps.ts";
import type { CandidateFacts, RunningFacts } from "./rule.ts";
import { dockerEnv, type RunResult, shownText } from "./run.ts";
import { pruneLogs, stateDir } from "./state.ts";

const SHA = /^sha256:[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const INTEGER = /^\d+$/;
/** What every throwaway run of an image gets: nothing to write to, nothing to gain. */
const CONFINED = [
  "--rm",
  "--read-only",
  "--tmpfs",
  "/tmp",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
];

/** The server's container, as `docker inspect` gives it. */
export interface Container {
  id: string;
  name: string;
  imageId: string;
  /** The reference it was started with: `<image>:<what .env named>`. */
  imageRef: string;
  state: string;
  exitCode: number;
  /** `healthy`, `starting`, `unhealthy`, or `none` for an image with no health check. */
  health: string;
  startedAt: string;
  /** The volume mounted at /data; null when there is none. */
  volume: string | null;
  project: string;
  directory: string;
  files: string[];
}

export type Found =
  | { kind: "silent" }
  | { kind: "none" }
  | { kind: "many"; names: string[] }
  | { kind: "one"; container: Container };

function docker(deps: Deps, args: string[], timeoutMs: number): RunResult {
  return deps.run(["docker", ...args], { env: dockerEnv(deps.env), timeoutMs });
}
const failed = (result: RunResult): boolean => result.timedOut || result.code !== 0;
/** The last line of `text` that is not blank. */
const lastLine = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";

/** The first `<a>.<b>.<c>` in Compose's answer; null when it gave none. */
export function composeVersion(deps: Deps): string | null {
  const result = docker(deps, ["compose", "version", "--short"], deps.bounds.quick);
  if (failed(result)) return null;
  return /(\d+)\.(\d+)\.(\d+)/.exec(result.stdout)?.[0] ?? null;
}

/** The folder as it was given and as the disk has it: Compose records whichever `up` was typed in. */
function formsOf(folder: string): string[] {
  try {
    return [...new Set([folder, realpathSync(folder)])];
  } catch {
    return [folder];
  }
}

/** The container of the service `server` whose Compose project lives in `folder`, running or not. */
export function findContainer(deps: Deps, folder: string): Found {
  const ids = new Set<string>();
  for (const form of formsOf(folder)) {
    const listed = docker(
      deps,
      [
        "ps",
        "-a",
        "-q",
        "--filter",
        "label=com.docker.compose.service=server",
        "--filter",
        `label=com.docker.compose.project.working_dir=${form}`,
      ],
      deps.bounds.quick,
    );
    if (failed(listed)) return { kind: "silent" };
    for (const id of listed.stdout.split("\n").map((line) => line.trim())) if (id) ids.add(id);
  }
  if (ids.size === 0) return { kind: "none" };
  if (ids.size > 1) return { kind: "many", names: [...ids] };
  const [id] = [...ids] as [string];
  const inspected = docker(deps, ["inspect", "--format", "{{json .}}", id], deps.bounds.quick);
  if (failed(inspected)) return { kind: "silent" };
  try {
    const raw = JSON.parse(inspected.stdout) as {
      Id?: string;
      Name?: string;
      Image?: string;
      Config?: { Image?: string; Labels?: Record<string, string> };
      State?: {
        Status?: string;
        ExitCode?: number;
        StartedAt?: string;
        Health?: { Status?: string };
      };
      Mounts?: Array<{ Type?: string; Name?: string; Destination?: string }>;
    };
    const labels = raw.Config?.Labels ?? {};
    const mount = (raw.Mounts ?? []).find((m) => m.Destination === "/data" && m.Type === "volume");
    return {
      kind: "one",
      container: {
        id: raw.Id ?? id,
        name: (raw.Name ?? id).replace(/^\//, ""),
        imageId: raw.Image ?? "",
        imageRef: raw.Config?.Image ?? "",
        state: raw.State?.Status ?? "",
        exitCode: raw.State?.ExitCode ?? 0,
        health: raw.State?.Health?.Status ?? "none",
        startedAt: raw.State?.StartedAt ?? "",
        volume: mount?.Name ?? null,
        project: labels["com.docker.compose.project"] ?? "",
        directory: labels["com.docker.compose.project.working_dir"] ?? "",
        files: (labels["com.docker.compose.project.config_files"] ?? "").split(",").filter(Boolean),
      },
    };
  } catch {
    return { kind: "silent" };
  }
}

/** Healthy, still starting, or anything else. */
export function healthOf(container: Container | null): "healthy" | "starting" | "other" {
  if (container === null || container.state !== "running") return "other";
  if (container.health === "healthy") return "healthy";
  return container.health === "starting" ? "starting" : "other";
}

/** `docker compose` addressed to one project by name, directory and files, so an override stays in force. */
export function composeOf(project: {
  project: string;
  directory: string;
  files: string[];
}): string[] {
  return [
    "compose",
    "--project-directory",
    project.directory,
    "-p",
    project.project,
    ...project.files.flatMap((file) => ["-f", file]),
  ];
}

/** `key<separator> value` lines as a map; later lines of a key do not replace the first. */
function keyed(text: string, separator: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf(separator);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!map.has(key)) map.set(key, line.slice(at + separator.length).trim());
  }
  return map;
}
const integers = (text: string | undefined): number[] | null =>
  text !== undefined && /^\d+(,\d+)*$/.test(text) ? text.split(",").map(Number) : null;
const bytes = (text: string | undefined): number | null =>
  text !== undefined && INTEGER.test(text) ? Number(text) : null;

/** The running image's digest in the target's repository, or null. */
function repoDigest(deps: Deps, imageId: string): string | null {
  const result = docker(
    deps,
    ["image", "inspect", "--format", "{{json .RepoDigests}}", imageId],
    deps.bounds.quick,
  );
  if (failed(result)) return null;
  try {
    const prefix = `${deps.target.image}@`;
    const entry = (JSON.parse(result.stdout) as string[]).find((e) => e.startsWith(prefix));
    const digest = entry?.slice(prefix.length) ?? "";
    return SHA.test(digest) ? digest : null;
  } catch {
    return null;
  }
}

/** What the running server says of itself; `unreadable` when it does not say it for certain. */
export function runningFacts(deps: Deps, container: Container): RunningFacts | "unreadable" {
  const exec = (sub: string) =>
    docker(deps, ["exec", container.id, "wizardingcode-mem", "serve", sub], deps.bounds.quick);
  const status = exec("status");
  if (failed(status)) return "unreadable";
  const said = keyed(status.stdout, ":");
  const version = said.get("version") ?? "";
  const schema = said.get("schema") ?? "";
  if (!VERSION.test(version) || !INTEGER.test(schema)) return "unreadable";
  const asked = exec("version");
  if (failed(asked)) return "unreadable";
  const accepts = integers(keyed(asked.stdout, "=").get("accepts"));
  if (accepts === null) return "unreadable";
  return {
    version,
    schema: Number(schema),
    accepts,
    freeBytes: bytes(said.get("freeBytes")),
    dbBytes: bytes(said.get("dbBytes")),
    digest: repoDigest(deps, container.imageId),
  };
}

/**
 * The database's schema as the image `imageId` reads it, beside whatever runs: `newer` when
 * that image exits 3 (the database is past what it reads), `unreadable` for anything else.
 */
export function schemaWith(
  deps: Deps,
  imageId: string,
  volume: string,
): { schema: number } | "newer" | "unreadable" {
  const result = docker(
    deps,
    ["run", ...CONFINED, "--network", "none", "-v", `${volume}:/data`, imageId, "serve", "status"],
    deps.bounds.quick,
  );
  if (result.timedOut) return "unreadable";
  if (result.code === 3) return "newer";
  const schema = result.code === 0 ? (keyed(result.stdout, ":").get("schema") ?? "") : "";
  return INTEGER.test(schema) ? { schema: Number(schema) } : "unreadable";
}

/**
 * The verifier, from its own image, confined, with no login. Only its exit status is read:
 * 0 verified; Docker's own codes (the run itself failed) and a bound exceeded are "could
 * not"; anything else is "not verified", with its last lines kept for a person.
 */
export function verify(
  deps: Deps,
  digest: string,
): "verified" | "could-not" | { notVerified: string } {
  const result = docker(
    deps,
    [
      "run",
      ...CONFINED,
      "-e",
      "HOME=/tmp",
      "-e",
      "DOCKER_CONFIG=/tmp/none",
      deps.target.cosignImage,
      ...deps.target.verifyArgs(`${deps.target.image}@${digest}`),
    ],
    deps.bounds.verifier,
  );
  if (result.timedOut || [125, 126, 127].includes(result.code)) return "could-not";
  if (result.code === 0) return "verified";
  const lines = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3);
  return { notVerified: shownText(lines.join(" | ")) };
}

/** The images of the target's repository on the host other than `keep` are removed, never by force. */
export function removeOtherImages(deps: Deps, keep: Array<string | undefined>): void {
  const listed = docker(
    deps,
    ["image", "ls", "--no-trunc", "--format", "{{.ID}}", deps.target.image],
    deps.bounds.quick,
  );
  if (failed(listed)) return;
  const ids = new Set(
    listed.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  for (const id of ids) {
    if (keep.includes(id) || !SHA.test(id)) continue;
    // A refusal (an image still in use) is Docker's to give; nothing depends on the removal.
    docker(deps, ["image", "rm", id], deps.bounds.quick);
  }
}

/**
 * A verified candidate, pulled by its digest and asked what it is in a confined run by its
 * id. Its answer is untrusted text and is read strictly. After the pull the repository's
 * other images are removed, so a host keeps the running one, the previous one and this one.
 */
export function pullCandidate(
  deps: Deps,
  digest: string,
  keep: Array<string | undefined>,
): { id: string; facts: CandidateFacts } | { failed: string } {
  const reference = `${deps.target.image}@${digest}`;
  const pulled = docker(deps, ["pull", reference], deps.bounds.pull);
  if (failed(pulled))
    return {
      failed: pulled.timedOut
        ? "the pull exceeded its bound"
        : shownText(lastLine(pulled.stderr) || "the pull failed"),
    };
  const inspected = docker(
    deps,
    ["image", "inspect", "--format", "{{.Id}}", reference],
    deps.bounds.quick,
  );
  const id = inspected.stdout.trim();
  if (failed(inspected) || !SHA.test(id))
    return { failed: "the pulled image could not be inspected" };
  removeOtherImages(deps, [...keep, id]);
  const asked = docker(
    deps,
    ["run", ...CONFINED, "--network", "none", "--user", "10001:10001", id, "serve", "version"],
    deps.bounds.quick,
  );
  const said = keyed(asked.stdout, "=");
  const version = said.get("version") ?? "";
  const teamSchema = said.get("team_schema") ?? "";
  const contract = said.get("contract") ?? "";
  const accepts = integers(said.get("accepts"));
  if (
    failed(asked) ||
    !VERSION.test(version) ||
    !INTEGER.test(teamSchema) ||
    !INTEGER.test(contract) ||
    accepts === null
  )
    return { failed: "its serve version could not be read for certain" };
  return {
    id,
    facts: { version, teamSchema: Number(teamSchema), contract: Number(contract), accepts },
  };
}

/** `up` of the server alone, with the image already on the host, waiting for health. */
export function upWait(deps: Deps, compose: string[], waitMs: number): RunResult {
  return docker(
    deps,
    [
      ...compose,
      "up",
      "-d",
      "--no-deps",
      "--pull",
      "never",
      "--wait",
      "--wait-timeout",
      String(Math.round(waitMs / 1000)),
      "server",
    ],
    waitMs + deps.bounds.upMargin,
  );
}

export function stopServer(deps: Deps, compose: string[]): RunResult {
  return docker(deps, [...compose, "stop", "server"], deps.bounds.stop);
}

/** Seconds, UTC, ISO 8601. */
export const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The container's last 200 log lines, saved before anything stops or recreates it: a
 * recreate deletes them. The file can hold the server's bootstrap code; it is 0600, and the
 * ten newest are kept. Gives the file's name.
 */
export function saveLogs(deps: Deps, folder: string, containerId: string, version: string): string {
  const result = docker(deps, ["logs", "--tail", "200", containerId], deps.bounds.quick);
  const logs = join(stateDir(folder), "logs");
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const name = `${iso(deps.now()).replace(/[-:]/g, "")}-${version}.log`;
  deps.writer.write(join(logs, name), `${result.stdout}${result.stderr}`, 0o600);
  pruneLogs(folder);
  return name;
}
