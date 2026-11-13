// The team runbook (docs/runbooks/team-server.md, part 7 of the knowledge and team journey)
// held to the code: every command it cites is one the CLI knows, every variable one the code
// reads, every repository file one that exists, every server log event one the server writes.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const at = (path: string) => join(ROOT, path);
const source = (path: string) => (existsSync(at(path)) ? readFileSync(at(path), "utf8") : "");

const RUNBOOK = "docs/runbooks/team-server.md";
const runbook = source(RUNBOOK);

/** Every `.ts` and `.sql` file under a folder, as text. */
function sourcesUnder(folder: string): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|sql)$/.test(name)) parts.push(readFileSync(path, "utf8"));
    }
  };
  walk(at(folder));
  return parts.join("\n");
}

/** The CLI's top-level commands, from the one table in src/cli/main.ts. */
const COMMANDS = [...source("src/cli/main.ts").matchAll(/^\s+([a-z-]+): \(\) => import\(/gm)].map(
  (m) => m[1] as string,
);

const word = (token: string) => new RegExp(`(^|[^A-Za-z0-9_-])${token}([^A-Za-z0-9_-]|$)`);

describe("the team runbook", () => {
  test("exists, with the operator's side before the member's", () => {
    expect(runbook.length).toBeGreaterThan(0);
    const operator = runbook.indexOf("## The operator");
    const member = runbook.indexOf("## The member");
    expect(operator).toBeGreaterThan(-1);
    expect(member).toBeGreaterThan(operator);
  });

  test("every wizardingcode-mem command it cites is one the CLI knows", () => {
    const cited = [...runbook.matchAll(/`wizardingcode-mem ([^`]+)`/g)].map((m) =>
      (m[1] as string).trim(),
    );
    expect(cited.length).toBeGreaterThan(10);
    expect(COMMANDS.length).toBeGreaterThan(10);
    const unknown: string[] = [];
    for (const line of cited) {
      const tokens = line.split(/\s+/);
      const command = tokens[0] as string;
      if (!COMMANDS.includes(command)) {
        unknown.push(line);
        continue;
      }
      // The subcommand words that follow, up to the first option or placeholder, must be
      // named in the command's own module (its usage text names each subcommand).
      const module = source(`src/cli/commands/${command}.ts`);
      for (const token of tokens.slice(1)) {
        // An option, a placeholder, a value (a host, a list, a path, a quoted name) ends the
        // subcommand words.
        if (/^[-<A-Z0-9"'…]|[:/.,…]/.test(token)) break;
        if (!word(token).test(module)) unknown.push(`${line} (${token} not in ${command}.ts)`);
      }
    }
    expect(unknown).toEqual([]);
  });

  test("every WIZARDINGCODE_* variable it names is read under src/ or set by the deployment files", () => {
    const named = [...new Set([...runbook.matchAll(/WIZARDINGCODE_[A-Z_]+/g)].map((m) => m[0]))];
    expect(named.length).toBeGreaterThan(2);
    const code = [
      sourcesUnder("src"),
      source("compose.yml"),
      source(".env.example"),
      source("Dockerfile"),
    ].join("\n");
    expect(named.filter((name) => !code.includes(name))).toEqual([]);
  });

  test("every repository file it names exists", () => {
    const named = [
      ...new Set(
        [...runbook.matchAll(/`([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)`/g)]
          .map((m) => m[1] as string)
          .filter(
            (span) =>
              /^(Dockerfile|compose\.yml|Caddyfile|\.env\.example|docs\/|src\/|tests\/|scripts\/)/.test(
                span,
              ) && !span.includes("<"),
          ),
      ),
    ];
    expect(named.length).toBeGreaterThan(3);
    expect(named.filter((path) => !existsSync(at(path)))).toEqual([]);
  });

  test("every server log event it names is one src/team writes", () => {
    const named = [...new Set([...runbook.matchAll(/`event: "([a-z-]+)"`/g)].map((m) => m[1]))];
    expect(named.length).toBeGreaterThan(5);
    const team = sourcesUnder("src/team");
    expect(named.filter((event) => !team.includes(`event: "${event}"`))).toEqual([]);
  });

  test("the rollback is the restore command, and every named command comes before the start", () => {
    /** The text of one `###` section, its heading included. */
    const sectionOf = (heading: string): string => {
      const start = runbook.indexOf(`### ${heading}\n`);
      expect(start).toBeGreaterThan(-1);
      const next = runbook.indexOf("\n### ", start + 1);
      return runbook.slice(start, next === -1 ? undefined : next);
    };
    const section = sectionOf("Rollback");
    expect(section).toContain("docker compose run --rm server serve restore --to-schema");
    expect(section).not.toContain("cp /data/team.db");
    expect(section).not.toContain("rm -f /data/team.db-wal");
    const order = [
      "serve instance renew",
      "serve purge",
      "serve mirror --rebuild",
      "docker compose up -d server",
    ].map((command) => section.indexOf(command, section.indexOf("serve restore --to-schema")));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    for (const words of [
      "docker compose exec",
      "run no `docker compose up`",
      "serve revoke",
      "serve invitation revoke",
      "serve withdraw",
      "15 minutes",
      "docker compose restart caddy",
      "unknown subcommand",
      "team-before-rollback-",
      "erased",
      "no upgrade copy",
      "new invitation",
      "same team schema",
    ]) {
      expect(section).toContain(words);
    }
    expect(sectionOf("Before the first start, once")).toContain(
      "everyone who can push a tag or a branch",
    );
  });

  test("the documents that point at it do", () => {
    expect(source("README.md")).toContain(RUNBOOK);
    expect(source("CLAUDE.md")).toContain(RUNBOOK);
    expect(source("docs/adr/0026-team-server.md")).toContain("runbooks/team-server.md");
    expect(source("docs/adr/0027-sync-client.md")).toContain("runbooks/team-server.md");
  });
});
