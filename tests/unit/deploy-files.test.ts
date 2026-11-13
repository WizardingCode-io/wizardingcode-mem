import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summaryLine } from "../../scripts/release/lib.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const parseYaml = (text: string): unknown =>
  (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML.parse(text);

/** A workflow expression, spelled so that it is never a JavaScript template placeholder. */
const OPEN = `$${"{{"}`;
const expr = (text: string) => `${OPEN} ${text} }}`;

const DIGEST = /@sha256:[0-9a-f]{64}/;
const IMAGE = "ghcr.io/wizardingcode-io/wizardingcode-mem";

interface Service {
  image?: string;
  environment?: string[] | Record<string, string>;
  init?: boolean;
  ports?: string[];
  read_only?: boolean;
  tmpfs?: string[];
  cap_drop?: string[];
  security_opt?: string[];
  stop_grace_period?: string;
  restart?: string;
  volumes?: string[];
}
interface Compose {
  services: Record<string, Service>;
  volumes: Record<string, unknown>;
}
interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
}
interface Job {
  needs?: string | string[];
  permissions?: Record<string, string>;
  environment?: string;
  if?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  outputs?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on?: Record<
    string,
    { inputs?: Record<string, { required?: boolean; type?: string; default?: unknown }> }
  >;
  "run-name"?: string;
  concurrency?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const envList = (service: Service): string[] =>
  Array.isArray(service.environment)
    ? service.environment
    : Object.entries(service.environment ?? {}).map(([key, value]) => `${key}=${value}`);

describe("the Dockerfile", () => {
  const dockerfile = read("Dockerfile");
  const lines = dockerfile.split("\n");

  test("a pick stage maps the target architecture to the build's file names and the binary is copied executable", () => {
    expect(dockerfile).toMatch(/^FROM .* AS pick$/m);
    expect(dockerfile).toContain("ARG TARGETARCH");
    expect(dockerfile).toContain("wizardingcode-mem-linux-x64");
    expect(dockerfile).toContain("wizardingcode-mem-linux-arm64");
    expect(dockerfile).toMatch(/^COPY --from=pick --chmod=0755 /m);
  });

  test("every base is pinned by digest, the user is 10001, /data is the volume and the home, the health check runs serve health every 60 s", () => {
    const froms = lines.filter((line) => line.startsWith("FROM "));
    expect(froms.length).toBeGreaterThanOrEqual(2);
    for (const from of froms) expect(from).toMatch(DIGEST);
    expect(dockerfile).toMatch(/^USER 10001$/m);
    expect(dockerfile).toMatch(/^VOLUME \/data$/m);
    expect(dockerfile).toMatch(/^EXPOSE 8787$/m);
    const health = lines.find((line) => line.startsWith("HEALTHCHECK")) ?? "";
    expect(health).toContain("--interval=60s");
    expect(health).toMatch(/"serve", ?"health"/);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["wizardingcode-mem"\]$/m);
    expect(dockerfile).toMatch(/^CMD \["serve"\]$/m);
    expect(dockerfile).not.toContain("tini");
  });

  test("the environment names the data directory, the host, the brand home and the migration off, and never trust-proxy", () => {
    expect(dockerfile).toContain("WIZARDINGCODE_MEM_TEAM_DATA=/data");
    expect(dockerfile).toContain("WIZARDINGCODE_MEM_TEAM_HOST=0.0.0.0");
    expect(dockerfile).toContain("WIZARDINGCODE_MEM_MIGRATE=off");
    expect(dockerfile).toContain("WIZARDINGCODE_HOME=/data/home");
    expect(dockerfile).not.toContain("TRUST_PROXY");
    expect(dockerfile).toMatch(/apt-get install .*\bgit\b/);
    expect(dockerfile).toMatch(/apt-get install .*\bca-certificates\b/);
  });

  test(".dockerignore keeps everything out but the Linux binaries", () => {
    const ignore = read(".dockerignore").trim().split("\n");
    expect(ignore[0]).toBe("*");
    expect(ignore).toContain("!dist/wizardingcode-mem-linux-*");
  });
});

describe("the compose file, the Caddyfile and the environment example", () => {
  const compose = parseYaml(read("compose.yml")) as Compose;

  test("server: the image by version, trust-proxy on, init, a 30 s grace, hardened, no published port", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["caddy", "server"]);
    const server = compose.services.server as Service;
    expect(server.image).toMatch(
      new RegExp(`^${IMAGE.replaceAll(".", "\\.")}:\\$\\{WIZARDINGCODE_MEM_VERSION:\\?`),
    );
    expect(envList(server)).toContain("WIZARDINGCODE_MEM_TEAM_TRUST_PROXY=on");
    expect(server.init).toBe(true);
    expect(server.ports).toBeUndefined();
    expect(server.read_only).toBe(true);
    expect(server.tmpfs).toContain("/tmp");
    expect(server.cap_drop).toEqual(["ALL"]);
    expect(server.security_opt).toContain("no-new-privileges:true");
    expect(server.stop_grace_period).toBe("30s");
    expect(server.restart).toBe("unless-stopped");
    expect(server.volumes).toContain("data:/data");
    expect(Object.keys(compose.volumes)).toContain("data");
  });

  test("caddy: a pinned image, the domain from the environment, ports 80 and 443, the Caddyfile read-only", () => {
    const caddy = compose.services.caddy as Service;
    expect(caddy.image).toMatch(/^caddy:2@sha256:[0-9a-f]{64}$/);
    expect(envList(caddy).some((entry) => /^SERVER_DOMAIN=\$\{SERVER_DOMAIN:\?/.test(entry))).toBe(
      true,
    );
    expect(caddy.ports).toEqual(["80:80", "443:443"]);
    expect(caddy.volumes).toContain("./Caddyfile:/etc/caddy/Caddyfile:ro");
    expect(caddy.volumes?.some((volume) => volume.startsWith("caddy_data:"))).toBe(true);
    expect(caddy.volumes?.some((volume) => volume.startsWith("caddy_config:"))).toBe(true);
    expect(caddy.restart).toBe("unless-stopped");
  });

  test("the Caddyfile proxies to the server, caps the body at 1 MiB and sends HSTS", () => {
    const caddyfile = read("Caddyfile");
    expect(caddyfile).toContain("{$SERVER_DOMAIN}");
    expect(caddyfile).toContain("reverse_proxy server:8787");
    expect(caddyfile).toMatch(/request_body\s*\{\s*max_size 1MiB\s*\}/);
    expect(caddyfile).toMatch(/header Strict-Transport-Security "max-age=31536000"/);
  });

  test(".env.example names the two keys with example values", () => {
    const example = read(".env.example");
    expect(example).toMatch(/^SERVER_DOMAIN=team\.example\.com$/m);
    expect(example).toMatch(/^WIZARDINGCODE_MEM_VERSION=\d+\.\d+\.\d+$/m);
  });
});

describe("the workflows", () => {
  const workflowFiles = () =>
    readdirSync(join(ROOT, ".github/workflows")).filter((name) => name.endsWith(".yml"));

  test("every use of docker/metadata-action turns the latest flavor off", () => {
    let uses = 0;
    for (const name of workflowFiles()) {
      const workflow = parseYaml(read(`.github/workflows/${name}`)) as Workflow;
      for (const [job, body] of Object.entries(workflow.jobs)) {
        for (const step of body.steps ?? []) {
          if (!step.uses?.startsWith("docker/metadata-action@")) continue;
          uses++;
          expect({ name, job, flavor: String(step.with?.flavor ?? "") }).toEqual({
            name,
            job,
            flavor: expect.stringContaining("latest=false"),
          });
        }
      }
    }
    expect(uses).toBeGreaterThan(0);
  });

  // A guard: it passed before the flavor was set, since the default flavor names no tag in the file.
  test("no workflow but distribute.yml names an image's latest tag", () => {
    for (const name of workflowFiles()) {
      const found = read(`.github/workflows/${name}`).match(/[a-z0-9./_-]+:latest\b/g) ?? [];
      if (name === "distribute.yml") expect(found.length).toBeGreaterThan(0);
      else expect({ name, found }).toEqual({ name, found: [] });
    }
  });

  test("release.yml: docker pushes the version tag only, publish reads the full history, and distribute starts distribute.yml", () => {
    const release = parseYaml(read(".github/workflows/release.yml")) as Workflow;
    const docker = release.jobs.docker;
    expect(docker).toBeDefined();
    expect(docker?.needs).toBe("sign");
    expect(docker?.permissions?.packages).toBe("write");
    const uses = (docker?.steps ?? []).map((step) => step.uses ?? "");
    expect(uses.some((use) => use.startsWith("actions/checkout@"))).toBe(true);
    const download = docker?.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    expect(download?.with).toMatchObject({ name: "binaries", path: "dist" });
    expect(uses.some((use) => use.startsWith("docker/setup-qemu-action@"))).toBe(true);
    expect(uses.some((use) => use.startsWith("docker/setup-buildx-action@"))).toBe(true);
    const login = docker?.steps.find((step) => step.uses?.startsWith("docker/login-action@"));
    expect(login?.with).toMatchObject({ registry: "ghcr.io" });
    const metadata = docker?.steps.find((step) => step.uses?.startsWith("docker/metadata-action@"));
    expect(String(metadata?.with?.images).trim()).toBe(IMAGE);
    const tags = String(metadata?.with?.tags);
    expect(tags).toContain("type=semver,pattern={{version}}");
    // The image's latest tag is moved last, by distribute.yml, never by the build.
    expect(tags).not.toContain("latest");
    // The action's default flavor adds latest to a plain release without the word in the file.
    expect(String(metadata?.with?.flavor ?? "")).toContain("latest=false");
    const build = docker?.steps.find((step) => step.uses?.startsWith("docker/build-push-action@"));
    expect(build?.with).toMatchObject({ context: ".", file: "Dockerfile", push: true });
    expect(String(build?.with?.platforms)).toBe("linux/amd64,linux/arm64");
    expect(release.jobs.publish?.needs).toEqual(["sign", "docker"]);
    const history = release.jobs.publish?.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(history?.with?.["fetch-depth"]).toBe(0);

    const distribute = release.jobs.distribute;
    expect(distribute?.needs).toBe("publish");
    expect(distribute?.["runs-on"]).toBe("ubuntu-latest");
    expect(distribute?.permissions).toEqual({ actions: "write" });
    // It only starts another workflow: a call that stalls is cut, not left to the runner's
    // default of six hours.
    expect(distribute?.["timeout-minutes"]).toBe(5);
    expect(distribute?.steps).toHaveLength(1);
    const start = distribute?.steps[0];
    expect(start?.uses).toBeUndefined();
    expect(start?.run).toContain(
      'gh workflow run distribute.yml --ref main -f tag="$GITHUB_REF_NAME"',
    );
    expect(start?.run).not.toContain(OPEN);
    expect(Object.keys(start?.env ?? {}).sort()).toEqual(["GH_REPO", "GH_TOKEN"]);
  });

  describe("distribute.yml", () => {
    const raw = () => read(".github/workflows/distribute.yml");
    const workflow = () => parseYaml(raw()) as Workflow;
    const PLAIN = "needs.plan.outputs.prerelease == 'false'";

    test("is dispatch-only, queued in one group, and starts from no permission", () => {
      const file = workflow();
      expect(Object.keys(file.on ?? {})).toEqual(["workflow_dispatch"]);
      const inputs = file.on?.workflow_dispatch?.inputs ?? {};
      expect(Object.keys(inputs).sort()).toEqual(["dry_run", "release_hold", "tag"]);
      expect(inputs.tag).toMatchObject({ required: true, type: "string" });
      expect(inputs.dry_run).toMatchObject({ type: "boolean", default: false });
      expect(inputs.release_hold).toMatchObject({ type: "boolean", default: false });
      expect(file["run-name"]).toBe(`distribute ${expr("inputs.tag")}`);
      expect(file.concurrency).toEqual({ group: "distribute", "cancel-in-progress": false });
      expect(file.permissions).toEqual({});
    });

    test("five jobs on ubuntu, each with a time limit; only three enter the environment", () => {
      const jobs = workflow().jobs;
      expect(Object.keys(jobs).sort()).toEqual(["latest", "marketplace", "npm", "plan", "tap"]);
      for (const [name, job] of Object.entries(jobs)) {
        expect({ name, runner: job["runs-on"], minutes: job["timeout-minutes"] }).toEqual({
          name,
          runner: "ubuntu-latest",
          minutes: 15,
        });
      }
      expect(jobs.npm?.environment).toBe("release");
      expect(jobs.tap?.environment).toBe("release");
      expect(jobs.marketplace?.environment).toBe("release");
      expect(jobs.plan?.environment).toBeUndefined();
      expect(jobs.latest?.environment).toBeUndefined();
    });

    test("each job has only the permissions it needs", () => {
      const jobs = workflow().jobs;
      expect(jobs.plan?.permissions).toEqual({ contents: "read", actions: "read" });
      expect(jobs.npm?.permissions).toEqual({ contents: "read", "id-token": "write" });
      expect(jobs.tap?.permissions).toEqual({ contents: "read" });
      expect(jobs.marketplace?.permissions).toEqual({ contents: "read" });
      expect(jobs.latest?.permissions).toEqual({ packages: "write" });
    });

    test("latest comes last, only for a plain release that is not held, and says so when a target failed", () => {
      const jobs = workflow().jobs;
      expect(jobs.npm?.needs).toBe("plan");
      expect(jobs.tap?.needs).toBe("plan");
      expect(jobs.marketplace?.needs).toBe("plan");
      expect(jobs.npm?.if).toBeUndefined();
      expect(jobs.tap?.if).toBe(PLAIN);
      expect(jobs.marketplace?.if).toBe(PLAIN);
      const latest = jobs.latest;
      expect(latest?.needs).toEqual(["plan", "npm", "tap", "marketplace"]);
      // A status function, so the job still runs to write its line when a needed job failed.
      expect(latest?.if).toBe(
        `\${{ !cancelled() && ${PLAIN} && needs.plan.outputs.held == 'false' }}`,
      );
      const [first] = latest?.steps ?? [];
      expect(first?.env).toEqual({
        NPM: expr("needs.npm.result"),
        TAP: expr("needs.tap.result"),
        MARKETPLACE: expr("needs.marketplace.result"),
      });
      // The one line of the summary written in the workflow itself: the text is summaryLine's.
      expect(first?.run).toContain(
        `echo "${summaryLine("latest", { kind: "not-moved", job: "$job" })}"`,
      );
      // Run as the runner runs it: the first needed job that did not succeed is named, exit 1.
      const step = (results: Record<string, string>) => {
        const file = join(mkdtempSync(join(tmpdir(), "wizardingcode-mem-latest-")), "summary");
        const out = Bun.spawnSync(["sh", "-e", "-c", first?.run ?? "exit 99"], {
          env: { PATH: process.env.PATH ?? "", GITHUB_STEP_SUMMARY: file, ...results },
          stdout: "pipe",
          stderr: "pipe",
        });
        return { code: out.exitCode, summary: existsSync(file) ? readFileSync(file, "utf8") : "" };
      };
      expect(step({ NPM: "success", TAP: "failure", MARKETPLACE: "success" })).toEqual({
        code: 1,
        summary: "latest: not moved: tap did not succeed\n",
      });
      expect(step({ NPM: "success", TAP: "success", MARKETPLACE: "skipped" })).toEqual({
        code: 1,
        summary: "latest: not moved: marketplace did not succeed\n",
      });
      expect(step({ NPM: "success", TAP: "success", MARKETPLACE: "success" })).toEqual({
        code: 0,
        summary: "",
      });
      const retag = latest?.steps.find((step) => step.run?.includes("imagetools create"));
      expect(retag?.if).toBe(expr("!inputs.dry_run"));
      expect(retag?.run).toContain(`-t ${IMAGE}:latest "${IMAGE}:$VERSION"`);
      // A failed retag still gets its line in the summary.
      expect(retag?.run).toContain(
        `echo "${summaryLine("latest", { kind: "failed", sentence: "the image's retag did not succeed" })}"`,
      );
      const last = latest?.steps.at(-1);
      expect(last?.env).toEqual({ LINE: expr("needs.plan.outputs.latest_line") });
    });

    test("npm publishes the commit plan judged, never the tag by name", () => {
      const jobs = workflow().jobs;
      expect(jobs.plan?.outputs).toEqual({
        version: expr("steps.plan.outputs.version"),
        sha: expr("steps.plan.outputs.sha"),
        prerelease: expr("steps.plan.outputs.prerelease"),
        held: expr("steps.plan.outputs.held"),
        latest_line: expr("steps.plan.outputs.latest_line"),
      });
      const tree = jobs.npm?.steps.find((step) => step.with?.path === "release");
      expect(tree?.uses).toStartWith("actions/checkout@");
      expect(tree?.with?.ref).toBe(expr("needs.plan.outputs.sha"));
      for (const job of Object.values(jobs)) {
        for (const step of job.steps) expect(String(step.with?.ref ?? "")).not.toContain("inputs.");
      }
      const runs = (jobs.npm?.steps ?? []).map((step) => step.run ?? "");
      expect(runs).toContain("bun scripts/release/npm.ts release/npm");
      expect(runs).toContain("bun scripts/release/npm.ts release/plugins/opencode");
    });

    test("nothing reaches a shell by interpolation, every action is pinned by commit, no checkout keeps credentials", () => {
      for (const [name, job] of Object.entries(workflow().jobs)) {
        for (const step of job.steps) {
          if (step.run !== undefined)
            expect({ name, run: step.run.includes(OPEN) }).toEqual({ name, run: false });
          if (step.uses !== undefined) {
            const pin = step.uses.split("@")[1] ?? "";
            expect({ uses: step.uses, pinned: /^[0-9a-f]{40}$/.test(pin) }).toEqual({
              uses: step.uses,
              pinned: true,
            });
            if (step.uses.startsWith("actions/checkout@"))
              expect(step.with?.["persist-credentials"]).toBe(false);
          }
        }
      }
    });

    test("the marketplace token is named four times, each in the environment of a step of tap or marketplace", () => {
      const SECRET = expr("secrets.MARKETPLACE_TOKEN");
      expect(raw().split("secrets.MARKETPLACE_TOKEN")).toHaveLength(5);
      const holders: string[] = [];
      for (const [name, job] of Object.entries(workflow().jobs)) {
        for (const step of job.steps) {
          for (const [key, value] of Object.entries(step.env ?? {})) {
            if (value.includes("secrets.MARKETPLACE_TOKEN")) {
              expect({ key, value }).toEqual({ key: "MARKETPLACE_TOKEN", value: SECRET });
              holders.push(`${name}: ${step.run}`);
            }
          }
        }
      }
      expect(holders.sort()).toEqual([
        "marketplace: bun scripts/release/push.ts --target marketplace",
        "marketplace: bun scripts/release/token.ts WizardingCode-io/wizardingcode-plugins",
        "tap: bun scripts/release/push.ts --target tap",
        "tap: bun scripts/release/token.ts WizardingCode-io/homebrew-wizardingcode",
      ]);
    });
  });

  test("ci.yml: the build job builds the image, runs it hardened, waits for health, checks the user and the exit code", () => {
    const ci = parseYaml(read(".github/workflows/ci.yml")) as Workflow;
    const runs = (ci.jobs.build?.steps ?? []).map((step) => step.run ?? "").join("\n");
    expect(runs).toContain("docker build -t wizardingcode-mem:ci .");
    expect(runs).toContain("docker run --rm wizardingcode-mem:ci --version");
    expect(runs).toContain(
      "--init --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true",
    );
    expect(runs).toContain("wizardingcode-mem serve health");
    expect(runs).toContain("id -u");
    expect(runs).toContain("10001");
    expect(runs).toContain("docker stop -t 30 wcm");
    expect(runs).toContain("docker inspect -f '{{.State.ExitCode}}' wcm");
    expect(runs).toContain("docker volume rm wcm-data");
  });
});
