// deploy/upgrade.sh, the launcher (ADR 0033), run under sh (and dash) with stand-ins for
// docker, flock and timeout on a PATH that holds nothing else but the tools it needs. The
// stand-ins write what they were asked to a log and answer from files a case sets.
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMAGE } from "../../src/host/signature.ts";

const LAUNCHER = join(import.meta.dir, "..", "..", "deploy", "upgrade.sh");
const SHELLS = ["/bin/sh", ...(existsSync("/bin/dash") ? ["/bin/dash"] : [])];
/** What the launcher may find on PATH beside the stand-ins. */
// The last three are the stand-ins' own needs, not the launcher's.
const SYSTEM = [
  "awk",
  "id",
  "ls",
  "date",
  "mkdir",
  "chmod",
  "mv",
  "cat",
  "rm",
  "dirname",
  "sh",
  "basename",
  "cp",
  "tr",
  "true",
];
const IMG = `sha256:${"1".repeat(64)}`;

const STUB_DOCKER = `#!/bin/sh
echo "docker $*" >> "$STUB/log"
sub="$1"
[ ! -e "$STUB/fail-$sub" ] || exit 1
case "$*" in
  "ps -a -q --filter label=com.docker.compose.service=server --filter label=com.docker.compose.project.working_dir="*)
    all="$*"
    asked="\${all##*working_dir=}"
    if [ ! -e "$STUB/ps-dir" ] || [ "$(cat "$STUB/ps-dir")" = "$asked" ]; then cat "$STUB/ps" 2>/dev/null; fi ;;
  "ps -a -q --filter label=io.wizardingcode.mem.upgrade=tool") cat "$STUB/labelled" 2>/dev/null ;;
  "ps -a --filter label=com.docker.compose.service=server --format"*) cat "$STUB/elsewhere" 2>/dev/null ;;
  inspect*) cat "$STUB/inspect" ;;
  create*) echo created1 ;;
  cp*) for last; do :; done; cp "$STUB/tool.sh" "$last" ;;
  rm*) : ;;
  *) echo "unscripted docker $*" >&2; exit 97 ;;
esac
exit 0
`;
const STUB_FLOCK = `#!/bin/sh
echo "flock $*" >> "$STUB/log"
[ "$1" = "-n" ] && shift
if [ "$1" = "-E" ]; then code="$2"; shift 2; else code=1; fi
shift
[ ! -e "$STUB/held" ] || exit "$code"
exec "$@"
`;
const STUB_TIMEOUT = `#!/bin/sh
echo "timeout $1" >> "$STUB/log"
[ ! -e "$STUB/timed-out" ] || exit 124
shift
exec "$@"
`;
const STUB_LS = `#!/bin/sh
for last; do :; done
name="$(basename "$last")"
if [ -e "$STUB/owner-$name" ]; then echo "drwx------ 2 4242 20 64 Nov 13 12:00 $last"; exit 0; fi
exec "$REAL_LS" "$@"
`;
const TOOL = `#!/bin/sh
echo "tool $*" >> "$STUB/log"
echo "tool-marker \${WIZARDINGCODE_MEM_HOST_LOCKED:-unset}" >> "$STUB/log"
[ ! -e "$STUB_STATE/lock.info" ] || echo "tool-lock-info $(cat "$STUB_STATE/lock.info" | tr '\\n' ' ')" >> "$STUB/log"
exit "$(cat "$STUB/tool-exit" 2>/dev/null || echo 0)"
`;

interface Host {
  folder: string;
  stub: string;
  bin: string;
  set(name: string, text?: string): void;
  run(
    shell: string,
    args: string[],
    over?: { script?: string; without?: string[] },
  ): { exit: number; out: string; err: string; log: string[] };
}

/** The program's file: a shell's own `command -v` answers a bare name for a builtin such as `true`. */
function which(name: string): string {
  const found = ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]
    .map((dir) => join(dir, name))
    .find((path) => existsSync(path));
  if (found === undefined) throw new Error(`${name} is not on this machine`);
  return found;
}

/** A folder with the launcher, .env and compose.yml, and a healthy server of the repository's image. */
function host(): Host {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wcm-launcher-")));
  const folder = join(root, "srv");
  const stub = join(root, "stub");
  const bin = join(root, "bin");
  for (const dir of [folder, stub, bin]) mkdirSync(dir);
  copyFileSync(LAUNCHER, join(folder, "upgrade.sh"));
  writeFileSync(join(folder, ".env"), "WIZARDINGCODE_MEM_VERSION=0.9.1\n");
  writeFileSync(join(folder, "compose.yml"), "services: {}\n");
  const put = (name: string, text: string) => {
    writeFileSync(join(bin, name), text);
    chmodSync(join(bin, name), 0o755);
  };
  put("docker", STUB_DOCKER);
  put("flock", STUB_FLOCK);
  put("timeout", STUB_TIMEOUT);
  put("ls", STUB_LS);
  for (const name of SYSTEM.filter((n) => n !== "ls")) symlinkSync(which(name), join(bin, name));
  writeFileSync(join(stub, "tool.sh"), TOOL);
  chmodSync(join(stub, "tool.sh"), 0o755);
  writeFileSync(join(stub, "ps"), "c1\n");
  writeFileSync(join(stub, "inspect"), `${IMG} running healthy ${IMAGE}:0.9.1\n`);
  writeFileSync(join(stub, "log"), "");
  return {
    folder,
    stub,
    bin,
    set: (name, text = "") => writeFileSync(join(stub, name), text),
    run(shell, args, over = {}) {
      let path = bin;
      if (over.without !== undefined) {
        path = mkdtempSync(join(root, "bin-"));
        for (const name of [...SYSTEM, "docker", "flock", "timeout"])
          if (!over.without.includes(name)) symlinkSync(join(bin, name), join(path, name));
      }
      writeFileSync(join(stub, "log"), "");
      const result = Bun.spawnSync([shell, over.script ?? join(folder, "upgrade.sh"), ...args], {
        env: {
          PATH: path,
          STUB: stub,
          STUB_STATE: join(folder, "upgrade-state"),
          REAL_LS: which("ls"),
          HOME: root,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      if (process.env.WCM_LAUNCHER_TRACE === "1")
        console.log(args.join(" "), result.exitCode, result.stderr.toString().trim());
      return {
        exit: result.exitCode,
        out: result.stdout.toString(),
        err: result.stderr.toString(),
        log: readFileSync(join(stub, "log"), "utf8").split("\n").filter(Boolean),
      };
    },
  };
}
const dockerCalls = (log: string[]) => log.filter((line) => line.startsWith("docker "));
const toolCalls = (log: string[]) => log.filter((line) => line.startsWith("tool serve"));

for (const shell of SHELLS)
  describe(`deploy/upgrade.sh under ${shell}`, () => {
    test("accepts only status, follow, follow --dry-run and upgrade: anything else is its usage and exit 64, with no tool run", () => {
      const h = host();
      for (const args of [
        [],
        ["frobnicate"],
        ["status", "--dry-run"],
        ["follow", "--bogus"],
        ["upgrade", "--dry-run"],
        ["follow", "--dry-run", "more"],
      ]) {
        const r = h.run(shell, args);
        expect({ args, exit: r.exit }).toEqual({ args, exit: 64 });
        expect(r.err).toContain("Usage: upgrade.sh status | follow [--dry-run] | upgrade");
        expect(r.log).toEqual([]);
      }
    });

    test("names a missing docker, flock, awk or timeout", () => {
      const h = host();
      for (const name of ["docker", "flock", "awk", "timeout"]) {
        const r = h.run(shell, ["status"], { without: [name] });
        expect({ name, exit: r.exit }).toEqual({ name, exit: 69 });
        expect(r.err).toContain(`${name} is not installed`);
      }
    });

    test("runs every docker call under timeout, 30 s and 120 s for the copy", () => {
      const h = host();
      const r = h.run(shell, ["follow"]);
      expect(r.exit).toBe(0);
      const dockers = dockerCalls(r.log);
      expect(dockers.length).toBeGreaterThanOrEqual(5);
      // Each docker line is preceded by its timeout line.
      for (const line of dockers) {
        const at = r.log.indexOf(line);
        const before = r.log[at - 1] ?? "";
        expect({ line, before }).toEqual({
          line,
          before: line.startsWith("docker cp ") ? "timeout 120" : "timeout 30",
        });
      }
    });

    test("answers exit 13 when a docker call fails or exceeds its bound, never 'no container'", () => {
      for (const arrange of ["fail-ps", "fail-inspect", "timed-out", "fail-create", "fail-cp"]) {
        const h = host();
        h.set(arrange);
        const r = h.run(shell, ["follow"]);
        expect({ arrange, exit: r.exit }).toEqual({ arrange, exit: 13 });
        expect(r.err).toContain("Docker did not answer");
        expect(toolCalls(r.log)).toEqual([]);
      }
    });

    test("refuses a user who is not the folder's owner", () => {
      const h = host();
      h.set("owner-srv");
      const r = h.run(shell, ["status"]);
      expect(r.exit).toBe(69);
      expect(r.err).toMatch(/belongs to user 4242/);
      expect(r.log).toEqual([]);
    });

    test("refuses a symbolic link at upgrade-state, tool, the tool, the lock or .env", () => {
      const cases: Array<[string, (h: Host) => void]> = [
        [
          "upgrade-state",
          (h) => {
            mkdirSync(join(h.folder, "real"));
            symlinkSync(join(h.folder, "real"), join(h.folder, "upgrade-state"));
          },
        ],
        [
          "upgrade-state/tool",
          (h) => {
            mkdirSync(join(h.folder, "upgrade-state"), { mode: 0o700 });
            mkdirSync(join(h.folder, "real"));
            symlinkSync(join(h.folder, "real"), join(h.folder, "upgrade-state", "tool"));
          },
        ],
        [
          "upgrade-state/tool/wizardingcode-mem",
          (h) => {
            mkdirSync(join(h.folder, "upgrade-state", "tool"), { recursive: true, mode: 0o700 });
            symlinkSync("/bin/sh", join(h.folder, "upgrade-state", "tool", "wizardingcode-mem"));
          },
        ],
        [
          "upgrade-state/lock",
          (h) => {
            mkdirSync(join(h.folder, "upgrade-state"), { mode: 0o700 });
            symlinkSync(join(h.folder, ".env"), join(h.folder, "upgrade-state", "lock"));
          },
        ],
        [
          ".env",
          (h) => {
            writeFileSync(join(h.folder, "real.env"), "x");
            Bun.spawnSync(["/bin/rm", join(h.folder, ".env")]);
            symlinkSync(join(h.folder, "real.env"), join(h.folder, ".env"));
          },
        ],
      ];
      for (const [name, arrange] of cases) {
        const h = host();
        arrange(h);
        const r = h.run(shell, ["follow"]);
        expect({ name, exit: r.exit }).toEqual({ name, exit: 69 });
        expect(r.err).toContain(`${join(h.folder, name)} is a symbolic link`);
        expect(r.log).toEqual([]);
      }
    });

    test("refuses an upgrade-state or a tool that is not the user's own, group-writable or writable by others", () => {
      for (const dir of ["upgrade-state", "upgrade-state/tool"])
        for (const how of ["owner", "770", "707"]) {
          const h = host();
          mkdirSync(join(h.folder, "upgrade-state", "tool"), { recursive: true, mode: 0o700 });
          if (how === "owner") h.set(`owner-${dir.split("/").pop()}`);
          else chmodSync(join(h.folder, dir), Number.parseInt(how, 8));
          const r = h.run(shell, ["follow"]);
          expect({ dir, how, exit: r.exit }).toEqual({ dir, how, exit: 69 });
          expect(r.err).toContain(join(h.folder, dir));
          expect(r.log).toEqual([]);
        }
    });

    test("finds the container by the two labels, under the logical or the physical form of the folder", () => {
      const h = host();
      const link = join(h.folder, "..", "link");
      symlinkSync(h.folder, link);
      h.set("ps-dir", h.folder);
      const r = h.run(shell, ["status"], { script: join(link, "upgrade.sh") });
      expect(r.exit).toBe(0);
      const asked = dockerCalls(r.log).filter((line) =>
        line.includes(
          "compose.service=server --filter label=com.docker.compose.project.working_dir=",
        ),
      );
      expect(asked.map((line) => line.split("working_dir=")[1])).toEqual([link, h.folder]);
      expect(toolCalls(r.log)).toEqual([`tool serve host status --dir ${link} --lock free`]);
    });

    test("names the other directory when a server of the repository exists only elsewhere", () => {
      const h = host();
      h.set("ps", "");
      h.set("elsewhere", `ghcr.io/other/thing:1\t/srv/other\n${IMAGE}:0.9.1\t/srv/team\n`);
      const r = h.run(shell, ["status"]);
      expect(r.exit).toBe(69);
      expect(r.err).toContain("/srv/team");
      expect(r.err).not.toContain("/srv/other");
    });

    test("refuses more than one server container", () => {
      const h = host();
      h.set("ps", "c1\nc2\n");
      const r = h.run(shell, ["follow"]);
      expect(r.exit).toBe(69);
      expect(r.err).toMatch(/more than one server container.*c1.*c2/s);
    });

    test("refuses an image that is not of its IMAGE, before any copy", () => {
      const h = host();
      h.set("inspect", `${IMG} running healthy ghcr.io/someone/else:0.9.1\n`);
      const r = h.run(shell, ["follow"]);
      expect(r.exit).toBe(69);
      expect(r.err).toContain("ghcr.io/someone/else:0.9.1");
      expect(dockerCalls(r.log).filter((line) => /^docker (create|cp)/.test(line))).toEqual([]);
    });

    test("copies the binary from a created, never started, labelled container of the running image's id, removing an earlier one first", () => {
      const h = host();
      h.set("labelled", "stale9\n");
      const r = h.run(shell, ["follow"]);
      expect(r.exit).toBe(0);
      const steps = dockerCalls(r.log).filter((line) =>
        /^docker (rm|create|cp|start|run|exec)/.test(line),
      );
      expect(steps).toEqual([
        "docker rm -f stale9",
        `docker create --label io.wizardingcode.mem.upgrade=tool ${IMG}`,
        `docker cp created1:/usr/local/bin/wizardingcode-mem ${join(h.folder, "upgrade-state", "tool")}/.wizardingcode-mem.new`,
        "docker rm -f created1",
      ]);
      expect(readFileSync(join(h.folder, "upgrade-state", "tool", "image"), "utf8").trim()).toBe(
        IMG,
      );
      expect(existsSync(join(h.folder, "upgrade-state", "tool", ".wizardingcode-mem.new"))).toBe(
        false,
      );
    });

    test("copies only when that id is not the recorded one, and keeps the tool it has when the container is not healthy", () => {
      const h = host();
      expect(h.run(shell, ["follow"]).exit).toBe(0);
      const again = h.run(shell, ["follow"]);
      expect(dockerCalls(again.log).filter((line) => /^docker (create|cp)/.test(line))).toEqual([]);
      expect(toolCalls(again.log)).toHaveLength(1);

      for (const state of ["running unhealthy", "restarting starting", "exited none"]) {
        h.set("inspect", `sha256:${"2".repeat(64)} ${state} ${IMAGE}:0.9.2\n`);
        const r = h.run(shell, ["follow"]);
        expect({ state, exit: r.exit }).toEqual({ state, exit: 0 });
        expect(dockerCalls(r.log).filter((line) => /^docker (create|cp)/.test(line))).toEqual([]);
        expect(toolCalls(r.log)).toHaveLength(1);
      }
      expect(readFileSync(join(h.folder, "upgrade-state", "tool", "image"), "utf8").trim()).toBe(
        IMG,
      );
    });

    test("says to start the server when there is neither a healthy container nor a tool", () => {
      for (const arrange of [
        (h: Host) => h.set("ps", ""),
        (h: Host) => h.set("inspect", `${IMG} exited none ${IMAGE}:0.9.1\n`),
      ]) {
        const h = host();
        arrange(h);
        const r = h.run(shell, ["follow"]);
        expect(r.exit).toBe(69);
        expect(r.err).toContain(
          `no healthy server in ${h.folder} and no tool yet; start the server by the runbook first`,
        );
      }
    });

    test("runs follow and upgrade under flock without waiting, exit 75 when held, with lock.info written and removed", () => {
      const h = host();
      for (const [args, tool] of [
        [["follow"], "follow"],
        [["follow", "--dry-run"], "follow"],
        [["upgrade"], "upgrade"],
      ] as const) {
        const r = h.run(shell, [...args]);
        expect({ args, exit: r.exit }).toEqual({ args, exit: 0 });
        expect(r.log[0]).toBe(
          `flock -n -E 75 ${join(h.folder, "upgrade-state", "lock")} ${join(h.folder, "upgrade.sh")} ${args.join(" ")}`,
        );
        expect(toolCalls(r.log)).toEqual([
          `tool serve host ${args.join(" ")} --dir ${h.folder}`.replace(
            `${tool} --dry-run --dir ${h.folder}`,
            `${tool} --dir ${h.folder} --dry-run`,
          ),
        ]);
        expect(r.log).toContain("tool-marker 1");
        const info = r.log.find((line) => line.startsWith("tool-lock-info ")) ?? "";
        expect(info).toMatch(
          new RegExp(`^tool-lock-info ${tool} \\d+ \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ $`),
        );
        expect(existsSync(join(h.folder, "upgrade-state", "lock.info"))).toBe(false);
      }
      h.set("held");
      const held = h.run(shell, ["follow"]);
      expect(held.exit).toBe(75);
      expect(held.err).toContain(`another run holds the lock; see ${h.folder}/upgrade.sh status`);
      expect(toolCalls(held.log)).toEqual([]);
    });

    test("runs status without the lock but tells the tool whether it is held", () => {
      const h = host();
      const free = h.run(shell, ["status"]);
      expect(toolCalls(free.log)).toEqual([`tool serve host status --dir ${h.folder} --lock free`]);
      expect(free.log).toContain("tool-marker unset");
      expect(free.log.filter((line) => line.startsWith("flock -n -E"))).toEqual([]);
      h.set("held");
      const held = h.run(shell, ["status"]);
      expect(held.exit).toBe(0);
      expect(toolCalls(held.log)).toEqual([`tool serve host status --dir ${h.folder} --lock held`]);
    });

    test("gives the tool's exit, and turns its 64 and a tool that cannot run into their sentences", () => {
      const h = host();
      h.set("tool-exit", "14");
      expect(h.run(shell, ["follow"]).exit).toBe(14);
      h.set("tool-exit", "64");
      const old = h.run(shell, ["follow"]);
      expect(old.exit).toBe(69);
      expect(old.err).toContain(
        "the tool does not know this command: either the running server is older than the first release with `serve host`",
      );
      expect(old.err).toContain(
        "or this launcher is older than the tool (copy deploy/upgrade.sh again)",
      );
      h.set("tool-exit", "126");
      const alien = h.run(shell, ["follow"]);
      expect(alien.exit).toBe(69);
      expect(alien.err).toContain(
        "the server's binary does not run on this host (for example another C library)",
      );
    });
  });
