import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (name: string) => readFileSync(join(ROOT, name), "utf8");
const parseYaml = (text: string): unknown =>
  (Bun as unknown as { YAML: { parse(text: string): unknown } }).YAML.parse(text);

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
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: string;
}
interface Workflow {
  permissions?: Record<string, string>;
  jobs: Record<
    string,
    { needs?: string | string[]; permissions?: Record<string, string>; steps: Step[] }
  >;
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
  test("release.yml: a docker job after sign publishes the image for both platforms, and publish waits for it", () => {
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
    expect(tags).toMatch(
      /type=raw,value=latest,enable=\$\{\{ !contains\(github\.ref_name, '-'\) \}\}/,
    );
    const build = docker?.steps.find((step) => step.uses?.startsWith("docker/build-push-action@"));
    expect(build?.with).toMatchObject({ context: ".", file: "Dockerfile", push: true });
    expect(String(build?.with?.platforms)).toBe("linux/amd64,linux/arm64");
    expect(release.jobs.publish?.needs).toEqual(["sign", "docker"]);
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
