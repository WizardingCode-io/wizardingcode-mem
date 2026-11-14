// A host for the tests of src/host/: a folder with compose.yml, .env and upgrade-state/, and a
// Docker that is a small model of one server container, the images on the host and a registry.
// No program runs. A test sets the model, calls the tool, and reads the calls and the files.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { BOUNDS } from "../../src/host/bounds.ts";
import type { Deps } from "../../src/host/deps.ts";
import { readEnvLine, realWriter } from "../../src/host/files.ts";
import type { RunResult } from "../../src/host/run.ts";
import { readState, type State, stateDir } from "../../src/host/state.ts";
import { type HostCall, hostRunner } from "./host-runner.ts";

export const IMAGE = "ghcr.io/acme/team";
export const COSIGN = `ghcr.io/acme/verifier@sha256:${"9".repeat(64)}`;
export const VOLUME = "proj_data";
export const sha = (char: string) => `sha256:${char.repeat(64)}`;

export type Start = "healthy" | "exit1" | "exit2" | "unhealthy";

export interface WorldImage {
  id: string;
  /** Its digest in the repository; null for an image that was never pulled from it. */
  digest: string | null;
  version: string;
  teamSchema: number;
  contract: number;
  accepts: number[];
  /** What each start of it does, in turn; the last one repeats. */
  start: Start[];
  /** Its `serve status` cannot run. */
  statusBroken?: boolean;
  /** What its confined `serve version` prints, when not the honest lines. */
  versionOutput?: string;
  /** It migrates the database at start even when it then fails. */
  migratesAnyway?: boolean;
}

export interface WorldContainer {
  id: string;
  imageId: string;
  ref: string;
  state: "running" | "restarting" | "exited";
  health: "healthy" | "starting" | "unhealthy";
  exitCode: number;
}

export const OLD: WorldImage = {
  id: sha("1"),
  digest: sha("a"),
  version: "0.9.1",
  teamSchema: 2,
  contract: 2,
  accepts: [1, 2],
  start: ["healthy"],
};
export const NEW: WorldImage = {
  id: sha("2"),
  digest: sha("b"),
  version: "0.9.2",
  teamSchema: 2,
  contract: 2,
  accepts: [1, 2],
  start: ["healthy"],
};

export interface World {
  folder: string;
  deps: Deps;
  calls: HostCall[];
  /** The writer's steps, as `<step> <file name>`. */
  writes: string[];
  out: string[];
  err: string[];
  fetched: string[];
  sleeps: number[];
  images: WorldImage[];
  /** The ids of the images on the host. */
  present: Set<string>;
  container: WorldContainer | null;
  /** More containers of the service, for the refusal. */
  extraContainers: string[];
  dbSchema: number;
  freeBytes: number | null;
  dbBytes: number | null;
  composeVersion: string | null;
  dockerSilent: boolean;
  registryDigest: string | null;
  verifier: Partial<RunResult>;
  pullFails: boolean;
  /** The read of the schema with a named image fails. */
  schemaUnreadable: boolean;
  /** The container has no volume at /data. */
  noVolume: boolean;
  now: number;
  env(): string;
  setEnv(text: string): void;
  state(): State;
  setState(state: State): void;
  /** The calls whose command line matches. */
  ran(pattern: RegExp): HostCall[];
}

const imageByRef = (world: World, ref: string): WorldImage | undefined => {
  const digest = /@(sha256:[0-9a-f]{64})$/.exec(ref)?.[1];
  if (digest !== undefined) return world.images.find((image) => image.digest === digest);
  const version = /:(\d+\.\d+\.\d+)$/.exec(ref)?.[1];
  return world.images.find((image) => image.version === version);
};

const versionLines = (image: WorldImage) =>
  `version=${image.version}\nteam_schema=${image.teamSchema}\ncontract=${image.contract}\naccepts=${image.accepts.join(",")}\n`;

/** A folder and its model, with the server running `OLD` healthy and `latest` naming `NEW`. */
export function hostWorld(over: Partial<World> = {}): World {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "wcm-host-world-")));
  writeFileSync(join(folder, "compose.yml"), "services: {}\n");
  writeFileSync(
    join(folder, ".env"),
    `SERVER_DOMAIN=team.example.com\nWIZARDINGCODE_MEM_VERSION=${OLD.version}\n`,
    { mode: 0o640 },
  );
  mkdirSync(join(stateDir(folder), "logs"), { recursive: true, mode: 0o700 });
  let containers = 1;

  const world = {
    folder,
    writes: [] as string[],
    out: [] as string[],
    err: [] as string[],
    fetched: [] as string[],
    sleeps: [] as number[],
    images: [structuredClone(OLD), structuredClone(NEW)],
    present: new Set([OLD.id]),
    container: {
      id: "c1",
      imageId: OLD.id,
      ref: `${IMAGE}:${OLD.version}`,
      state: "running",
      health: "healthy",
      exitCode: 0,
    } as WorldContainer | null,
    extraContainers: [] as string[],
    dbSchema: 2,
    freeBytes: (4 * 1024 * 1024 * 1024) as number | null,
    dbBytes: 1000 as number | null,
    composeVersion: "5.7.0" as string | null,
    dockerSilent: false,
    registryDigest: NEW.digest,
    verifier: { code: 0 } as Partial<RunResult>,
    pullFails: false,
    schemaUnreadable: false,
    noVolume: false,
    now: Date.UTC(2026, 10, 13, 12, 0, 0),
    env: () => readFileSync(join(folder, ".env"), "utf8"),
    setEnv: (text: string) => writeFileSync(join(folder, ".env"), text),
    state: () => readState(folder),
    setState: (state: State) =>
      writeFileSync(join(stateDir(folder), "state.json"), JSON.stringify(state), { mode: 0o600 }),
  } as unknown as World;

  const byId = (id: string | undefined) => world.images.find((image) => image.id === id);

  function start(compose: string[]): Partial<RunResult> {
    const line = readEnvLine(world.env());
    const image = line === null ? undefined : imageByRef(world, `${IMAGE}:${line.value}`);
    if (line === null || image === undefined || !world.present.has(image.id))
      return { code: 1, stderr: "no such image" };
    const how = image.start.length > 1 ? (image.start.shift() as Start) : (image.start[0] as Start);
    containers += 1;
    const base = { id: `c${containers}`, imageId: image.id, ref: `${IMAGE}:${line.value}` };
    const migrate = () => {
      if (image.teamSchema > world.dbSchema) world.dbSchema = image.teamSchema;
    };
    if (!compose.includes("--no-deps")) return { code: 1, stderr: "the model wants --no-deps" };
    if (how === "healthy") {
      // A binary refuses a database at a newer schema than its own: exit 3, in a restart loop.
      if (world.dbSchema > image.teamSchema) {
        world.container = { ...base, state: "restarting", health: "starting", exitCode: 3 };
        return { code: 1, stderr: `container ${base.id} is unhealthy` };
      }
      migrate();
      world.container = { ...base, state: "running", health: "healthy", exitCode: 0 };
      return { code: 0, stderr: `Container ${base.id} Healthy` };
    }
    if (image.migratesAnyway === true) migrate();
    world.container =
      how === "unhealthy"
        ? { ...base, state: "running", health: "unhealthy", exitCode: 0 }
        : { ...base, state: "restarting", health: "starting", exitCode: how === "exit1" ? 1 : 2 };
    return { code: 1, stderr: `container ${base.id} is unhealthy` };
  }

  function inspect(id: string): Partial<RunResult> {
    const c = world.container;
    if (c === null || c.id !== id) return { code: 1, stderr: "no such object" };
    return {
      stdout: JSON.stringify({
        Id: c.id,
        Name: "/proj-server-1",
        Image: c.imageId,
        Config: {
          Image: c.ref,
          Labels: {
            "com.docker.compose.project": "proj",
            "com.docker.compose.service": "server",
            "com.docker.compose.project.working_dir": folder,
            "com.docker.compose.project.config_files": `${folder}/compose.yml,${folder}/compose.override.yml`,
          },
        },
        State: {
          Status: c.state,
          ExitCode: c.exitCode,
          StartedAt: new Date(world.now - 3_600_000).toISOString(),
          Health: { Status: c.health },
        },
        Mounts: world.noVolume ? [] : [{ Type: "volume", Name: VOLUME, Destination: "/data" }],
      }),
    };
  }

  function answer(call: HostCall): Partial<RunResult> | undefined {
    const { cmd, line } = call;
    if (cmd[0] !== "docker") return undefined;
    if (world.dockerSilent) return { code: 1, stderr: "Cannot connect to the Docker daemon" };
    if (/^docker compose version --short$/.test(line))
      return world.composeVersion === null
        ? { code: 1, stderr: "docker: 'compose' is not a docker command" }
        : { stdout: `${world.composeVersion}\n` };
    if (cmd[1] === "ps") {
      const asked = /working_dir=(\S+)/.exec(line)?.[1];
      const ids = asked === folder && world.container !== null ? [world.container.id] : [];
      if (asked === folder) ids.push(...world.extraContainers);
      return { stdout: ids.length === 0 ? "" : `${ids.join("\n")}\n` };
    }
    if (cmd[1] === "inspect") return inspect(cmd.at(-1) as string);
    if (cmd[1] === "exec") {
      const c = world.container;
      const image = byId(c?.imageId);
      if (c === null || c.id !== cmd[2] || c.state !== "running" || image === undefined)
        return { code: 1, stderr: "container is not running" };
      if (line.endsWith("serve version")) return { stdout: versionLines(image) };
      if (image.statusBroken === true) return { code: 1, stderr: "cannot run" };
      return {
        stdout: `version: ${image.version}\nschema: ${world.dbSchema}\nserverId: x\nfreeBytes: ${world.freeBytes ?? "unknown"}\ndbBytes: ${world.dbBytes ?? "unknown"}\nlease: none\n`,
      };
    }
    if (cmd[1] === "run") {
      if (cmd.includes(COSIGN)) return world.verifier;
      const volume = cmd.includes("-v");
      const image = byId(cmd.find((part) => /^sha256:[0-9a-f]{64}$/.test(part)));
      if (image === undefined) return { code: 125, stderr: "no such image" };
      if (!volume)
        return line.endsWith("serve version")
          ? { stdout: image.versionOutput ?? versionLines(image) }
          : { code: 64 };
      if (world.schemaUnreadable) return { code: 1, stderr: "disk I/O error" };
      if (world.dbSchema > image.teamSchema)
        return { code: 3, stderr: "team.db is at a newer schema than this binary" };
      return { stdout: `version: ${image.version}\nschema: ${world.dbSchema}\n` };
    }
    if (cmd[1] === "pull") {
      const image = imageByRef(world, cmd.at(-1) as string);
      if (world.pullFails || image === undefined)
        return { code: 1, stderr: "manifest unknown\u001b[31m" };
      world.present.add(image.id);
      return {};
    }
    if (cmd[1] === "image" && cmd[2] === "inspect") {
      const target = cmd.at(-1) as string;
      const image = byId(target) ?? imageByRef(world, target);
      if (image === undefined || !world.present.has(image.id))
        return { code: 1, stderr: "no such image" };
      return line.includes("RepoDigests")
        ? { stdout: JSON.stringify(image.digest === null ? [] : [`${IMAGE}@${image.digest}`]) }
        : { stdout: `${image.id}\n` };
    }
    if (cmd[1] === "image" && cmd[2] === "ls")
      return { stdout: `${[...world.present].join("\n")}\n` };
    if (cmd[1] === "image" && cmd[2] === "rm") {
      world.present.delete(cmd.at(-1) as string);
      return {};
    }
    if (cmd[1] === "logs") return { stdout: `log of ${cmd.at(-1)}\n`, stderr: "its last words\n" };
    if (cmd[1] === "compose" && cmd.includes("up")) return start(cmd);
    if (cmd[1] === "compose" && cmd.includes("stop")) {
      if (world.container !== null) world.container = { ...world.container, state: "exited" };
      return {};
    }
    return undefined;
  }

  const { run, calls } = hostRunner(answer);
  const note = (step: string, path: string) => world.writes.push(`${step} ${basename(path)}`);
  world.calls = calls;
  world.ran = (pattern) => calls.filter((call) => pattern.test(call.line));
  world.deps = {
    run,
    fetch: (async (input: string | URL | Request) => {
      world.fetched.push(String(input));
      return world.registryDigest === null
        ? new Response(null, { status: 404 })
        : new Response(null, {
            status: 200,
            headers: { "docker-content-digest": world.registryDigest },
          });
    }) as unknown as typeof fetch,
    now: () => world.now,
    sleep: (ms) => {
      world.sleeps.push(ms);
      world.now += ms;
    },
    writer: {
      write: (path, text, mode) => {
        note("write", path);
        realWriter.write(path, text, mode);
      },
      sync: (path) => {
        note("sync", path);
        realWriter.sync(path);
      },
      rename: (from, to) => {
        note("rename", to);
        realWriter.rename(from, to);
      },
      syncDir: (dir) => {
        note("syncDir", dir);
        realWriter.syncDir(dir);
      },
    },
    env: {
      PATH: "/usr/bin",
      WIZARDINGCODE_MEM_HOST_LOCKED: "1",
      WIZARDINGCODE_MEM_VERSION: "9.9.9",
      COMPOSE_FILE: "/elsewhere.yml",
      COMPOSE_PROJECT_NAME: "elsewhere",
      DOCKER_HOST: "tcp://elsewhere:2375",
      DOCKER_CONTEXT: "elsewhere",
    },
    leaseMs: 30_000,
    bounds: BOUNDS,
    target: {
      image: IMAGE,
      registry: "https://ghcr.io",
      cosignImage: COSIGN,
      verifyArgs: (reference) => ["verify", reference, "--the-identity"],
    },
    out: (text) => world.out.push(text),
    err: (text) => world.err.push(text),
    version: "0.9.1",
  };
  Object.assign(world, over);
  return world;
}

/** The index of the first call that matches; -1 when none does. */
export const indexOfCall = (world: World, pattern: RegExp): number =>
  world.calls.findIndex((call) => pattern.test(call.line));
