import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageBinary } from "../../src/install/binary.ts";
import {
  type InstallContext,
  installClaudeCode,
  uninstallClaudeCode,
} from "../../src/install/claude-code.ts";
import { openDb } from "../../src/store/db.ts";
import { makeClaudeMemDb } from "../helpers/claude-mem-db.ts";
import { runCliWith } from "../helpers/cli.ts";

let home: string;
let settingsPath: string;
let dataDir: string;
let commands: string[][];
let hostCliWorks: boolean;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-install-"));
  mkdirSync(join(home, ".claude"));
  settingsPath = join(home, ".claude", "settings.json");
  dataDir = join(home, ".wizardingcode-mem");
  commands = [];
  hostCliWorks = true;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const BIN = "/opt/wizardingcode-mem/bin/wizardingcode-mem";
const context = (binaryPath = BIN): InstallContext => ({
  settingsPath,
  dataDir,
  binaryPath,
  now: () => 1_700_000_000_000,
  run: (command) => {
    commands.push(command);
    return { ok: hostCliWorks, output: "" };
  },
});
const settings = () => JSON.parse(readFileSync(settingsPath, "utf8"));
const receipts = () => {
  const dir = join(dataDir, "install");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => join(dir, name))
    : [];
};
const ours = (event: string, matcher?: string) => ({
  ...(matcher === undefined ? {} : { matcher }),
  hooks: [{ type: "command", command: BIN, args: ["hook", "claude-code", event], timeout: 5 }],
});

describe("install claude-code", () => {
  test("with no settings file, creates one holding the hooks in exec form", () => {
    const result = installClaudeCode(context());
    expect(result.changed).toBe(true);
    expect(settings()).toEqual({
      hooks: {
        SessionStart: [ours("session-start")],
        UserPromptSubmit: [ours("prompt")],
        Stop: [ours("turn-end")],
        SessionEnd: [ours("session-end")],
        PostToolUse: [ours("file-read", "Read")],
      },
    });
  });

  test("a tool-failed hook left by a development install is removed by uninstall", () => {
    const theirs = { matcher: "Bash", hooks: [{ type: "command", command: "notify" }] };
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [ours("session-start")],
          PostToolUse: [ours("file-read", "Read")],
          PostToolUseFailure: [theirs, ours("tool-failed", "Bash")],
        },
      }),
    );
    uninstallClaudeCode(context());
    expect(settings().hooks).toEqual({ PostToolUseFailure: [theirs] });
  });

  test("keeps a user's own PostToolUse group, and uninstall removes only ours", () => {
    const theirs = { matcher: "Edit", hooks: [{ type: "command", command: "fmt" }] };
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PostToolUse: [theirs] } }, null, 2));
    installClaudeCode(context());
    expect(settings().hooks.PostToolUse).toEqual([theirs, ours("file-read", "Read")]);
    installClaudeCode(context());
    expect(settings().hooks.PostToolUse).toHaveLength(2);
    // The file moved on after install, so uninstall edits instead of restoring.
    writeFileSync(settingsPath, `${readFileSync(settingsPath, "utf8")}\n`);
    uninstallClaudeCode(context());
    expect(settings().hooks).toEqual({ PostToolUse: [theirs] });
  });

  test("an install from before the new events still uninstalls cleanly, matcher groups included", () => {
    const theirs = { matcher: "Edit", hooks: [{ type: "command", command: "fmt" }] };
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [ours("session-start")],
          UserPromptSubmit: [ours("prompt")],
          Stop: [ours("turn-end")],
          SessionEnd: [ours("session-end")],
          PostToolUse: [theirs, ours("file-read", "Read")],
        },
      }),
    );
    uninstallClaudeCode(context());
    expect(settings().hooks).toEqual({ PostToolUse: [theirs] });
  });

  test("a user's own Read group beside ours stays a separate group and survives uninstall", () => {
    const theirs = { matcher: "Read", hooks: [{ type: "command", command: "audit-reads" }] };
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PostToolUse: [theirs] } }));
    installClaudeCode(context());
    expect(settings().hooks.PostToolUse).toEqual([theirs, ours("file-read", "Read")]);
    writeFileSync(settingsPath, `${readFileSync(settingsPath, "utf8")}\n`);
    uninstallClaudeCode(context());
    expect(settings().hooks).toEqual({ PostToolUse: [theirs] });
  });

  test("leaves everything that is not ours exactly as it was", () => {
    const theirs = { hooks: [{ type: "command", command: "other-tool start" }] };
    writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          permissions: { allow: ["Bash(npm test:*)"] },
          hooks: { SessionStart: [theirs], PreToolUse: [{ matcher: "Bash", hooks: [] }] },
          model: "opus",
        },
        null,
        2,
      ),
    );
    installClaudeCode(context());
    const after = settings();
    expect(after.permissions).toEqual({ allow: ["Bash(npm test:*)"] });
    expect(after.model).toBe("opus");
    expect(after.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [] }]);
    expect(after.hooks.SessionStart).toEqual([theirs, ours("session-start")]);
    expect(Object.keys(after)).toEqual(["permissions", "hooks", "model"]);
  });

  test("installing twice changes nothing the second time", () => {
    installClaudeCode(context());
    const first = readFileSync(settingsPath, "utf8");
    const second = installClaudeCode(context());
    expect(second.changed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(first);
    expect(settings().hooks.Stop).toHaveLength(1);
  });

  test("installing a binary at a new path replaces the old entries", () => {
    installClaudeCode(context("/old/place/wizardingcode-mem"));
    installClaudeCode(context());
    const text = readFileSync(settingsPath, "utf8");
    expect(text).not.toContain("/old/place");
    expect(settings().hooks.UserPromptSubmit).toEqual([ours("prompt")]);
  });

  test("takes the place of a shibaox-mem install, the product's name until 0.3.0", () => {
    installClaudeCode(context("/Users/me/.shibaox/mem/bin/shibaox-mem"));
    installClaudeCode(context());
    expect(readFileSync(settingsPath, "utf8")).not.toContain("shibaox");
    expect(settings().hooks.UserPromptSubmit).toEqual([ours("prompt")]);
  });

  test("keeps the file's own indentation", () => {
    writeFileSync(settingsPath, '{\n\t"model": "opus"\n}\n');
    installClaudeCode(context());
    const text = readFileSync(settingsPath, "utf8");
    expect(text).toStartWith('{\n\t"model": "opus",\n\t"hooks": {\n\t\t"SessionStart"');
    expect(text).toEndWith("}\n");
  });

  test("a settings file that is not valid JSON is refused and left untouched", () => {
    const broken = '{ "model": "opus", }';
    writeFileSync(settingsPath, broken);
    expect(() => installClaudeCode(context())).toThrow(/not valid JSON/);
    expect(readFileSync(settingsPath, "utf8")).toBe(broken);
    expect(commands).toEqual([]);
  });

  test("a settings file whose hooks are not an object is refused", () => {
    writeFileSync(settingsPath, '{ "hooks": [] }');
    expect(() => installClaudeCode(context())).toThrow(/hooks/);
  });

  test("backs the file up before changing it, and records what it did", () => {
    const original = '{\n  "model": "opus"\n}\n';
    writeFileSync(settingsPath, original);
    installClaudeCode(context());
    const backups = readdirSync(join(dataDir, "install", "backups"));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dataDir, "install", "backups", backups[0] as string), "utf8")).toBe(
      original,
    );
    expect(receipts()).toHaveLength(1);
    expect(JSON.parse(readFileSync(receipts()[0] as string, "utf8"))).toMatchObject({
      agent: "claude-code",
      settingsPath,
      binaryPath: BIN,
    });
  });

  test("registers the MCP server through the host's own command", () => {
    const result = installClaudeCode(context());
    expect(commands).toEqual([
      ["claude", "mcp", "remove", "--scope", "user", "wizardingcode-mem"],
      ["claude", "mcp", "remove", "--scope", "user", "shibaox-mem"],
      ["claude", "mcp", "add", "--scope", "user", "wizardingcode-mem", "--", BIN, "mcp"],
    ]);
    expect(result.mcp).toBe("registered");
  });

  test("when the host's command is unavailable, says what to run by hand", () => {
    hostCliWorks = false;
    const result = installClaudeCode(context());
    expect(result.changed).toBe(true);
    expect(result.mcp).toBe("manual");
    expect(result.mcpCommand.join(" ")).toBe(
      `claude mcp add --scope user wizardingcode-mem -- ${BIN} mcp`,
    );
  });
});

describe("uninstall claude-code", () => {
  test("puts back the original file, byte for byte, when nothing else changed since", () => {
    const original = '{\n    "model":   "opus",\n    "hooks": {"Stop": []}\n}';
    writeFileSync(settingsPath, original);
    installClaudeCode(context());
    expect(uninstallClaudeCode(context()).settings).toBe("restored");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  test("removes the file it created, when it is otherwise empty", () => {
    installClaudeCode(context());
    expect(uninstallClaudeCode(context()).settings).toBe("removed");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("keeps changes made to the file after installing, removing only what is ours", () => {
    writeFileSync(settingsPath, JSON.stringify({ model: "opus" }, null, 2));
    installClaudeCode(context());
    const edited = settings();
    edited.model = "sonnet";
    edited.hooks.Stop.unshift({ hooks: [{ type: "command", command: "their-hook" }] });
    writeFileSync(settingsPath, JSON.stringify(edited, null, 2));

    expect(uninstallClaudeCode(context()).settings).toBe("edited");
    expect(settings()).toEqual({
      model: "sonnet",
      hooks: { Stop: [{ hooks: [{ type: "command", command: "their-hook" }] }] },
    });
  });

  test("works without a receipt, recognising its own entries by their shape", () => {
    installClaudeCode(context());
    rmSync(join(dataDir, "install"), { recursive: true });
    expect(uninstallClaudeCode(context()).settings).toBe("edited");
    expect(settings()).toEqual({});
  });

  test("with nothing installed, changes nothing", () => {
    const original = '{ "model": "opus" }';
    writeFileSync(settingsPath, original);
    expect(uninstallClaudeCode(context()).settings).toBe("untouched");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  test("unregisters the MCP server and forgets the receipt, but keeps the memories", () => {
    installClaudeCode(context());
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "wizardingcode-mem.db"), "data");
    commands = [];
    uninstallClaudeCode(context());
    expect(commands).toEqual([
      ["claude", "mcp", "remove", "--scope", "user", "wizardingcode-mem"],
      ["claude", "mcp", "remove", "--scope", "user", "shibaox-mem"],
    ]);
    expect(receipts()).toEqual([]);
    expect(readFileSync(join(dataDir, "wizardingcode-mem.db"), "utf8")).toBe("data");
  });
});

describe("install and uninstall, over time", () => {
  // Reinstalling happens on every upgrade. What the user did to the file in between is theirs.
  test("changes made between two installs survive an uninstall", () => {
    writeFileSync(settingsPath, JSON.stringify({ model: "opus" }, null, 2));
    installClaudeCode(context("/old/place/wizardingcode-mem"));
    const edited = settings();
    edited.permissions = { allow: ["Bash(npm test:*)"] };
    writeFileSync(settingsPath, JSON.stringify(edited, null, 2));
    installClaudeCode(context());

    expect(uninstallClaudeCode(context()).settings).toBe("edited");
    expect(settings()).toEqual({ model: "opus", permissions: { allow: ["Bash(npm test:*)"] } });
  });

  test("a file wizardingcode-mem created is not deleted once the user has put settings in it", () => {
    installClaudeCode(context("/old/place/wizardingcode-mem"));
    const edited = settings();
    edited.model = "sonnet";
    writeFileSync(settingsPath, JSON.stringify(edited, null, 2));
    installClaudeCode(context());

    expect(uninstallClaudeCode(context()).settings).toBe("edited");
    expect(settings()).toEqual({ model: "sonnet" });
  });

  test("reinstalling over an untouched install still restores the original exactly", () => {
    const original = '{\n    "model":   "opus"\n}';
    writeFileSync(settingsPath, original);
    installClaudeCode(context("/old/place/wizardingcode-mem"));
    installClaudeCode(context());
    expect(uninstallClaudeCode(context()).settings).toBe("restored");
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  test("two Claude Code profiles sharing one data directory do not touch each other", () => {
    const other = join(home, "work", "settings.json");
    mkdirSync(join(home, "work"));
    const mine = '{\n  "model": "opus"\n}\n';
    const theirs = '{\n  "model": "sonnet"\n}\n';
    writeFileSync(settingsPath, mine);
    writeFileSync(other, theirs);
    const work = { ...context(), settingsPath: other };

    installClaudeCode(context());
    installClaudeCode(work);
    expect(uninstallClaudeCode(work).settings).toBe("restored");
    expect(readFileSync(other, "utf8")).toBe(theirs);
    // The first profile is still installed, and still knows how to undo itself.
    expect(settings().hooks.Stop).toEqual([ours("turn-end")]);
    expect(uninstallClaudeCode(context()).settings).toBe("restored");
    expect(readFileSync(settingsPath, "utf8")).toBe(mine);
  });

  test.skipIf(process.platform === "win32")(
    "a settings file that is a symlink stays one, and its target is what changes",
    () => {
      const dotfiles = join(home, "dotfiles");
      mkdirSync(dotfiles);
      const target = join(dotfiles, "claude-settings.json");
      const original = '{\n  "model": "opus"\n}\n';
      writeFileSync(target, original);
      symlinkSync(target, settingsPath);

      installClaudeCode(context());
      expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
      expect(JSON.parse(readFileSync(target, "utf8")).hooks.Stop).toEqual([ours("turn-end")]);

      expect(uninstallClaudeCode(context()).settings).toBe("restored");
      expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
      expect(readFileSync(target, "utf8")).toBe(original);
    },
  );
});

describe("stageBinary", () => {
  test("copies the binary to a stable, executable place inside the data directory", () => {
    const source = join(home, "downloaded-wizardingcode-mem");
    writeFileSync(source, "#!/bin/sh\necho hi\n");
    const staged = stageBinary(source, dataDir);
    expect(staged).toBe(
      join(
        dataDir,
        "bin",
        process.platform === "win32" ? "wizardingcode-mem.exe" : "wizardingcode-mem",
      ),
    );
    expect(readFileSync(staged, "utf8")).toBe("#!/bin/sh\necho hi\n");
    if (process.platform !== "win32") expect(statSync(staged).mode & 0o111).not.toBe(0);
  });

  test("a binary already in place is left alone", () => {
    const source = join(home, "downloaded-wizardingcode-mem");
    writeFileSync(source, "v1");
    const staged = stageBinary(source, dataDir);
    expect(stageBinary(staged, dataDir)).toBe(staged);
    expect(readFileSync(staged, "utf8")).toBe("v1");
  });
});

describe("wizardingcode-mem install, with claude-mem present", () => {
  const env = () => ({
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    WIZARDINGCODE_MEM_CLAUDE_MEM_DIR: join(home, ".claude-mem"),
    PATH: "/nonexistent",
  });
  let binary: string;

  beforeEach(() => {
    binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    mkdirSync(join(home, ".claude-mem"));
    makeClaudeMemDb(join(home, ".claude-mem", "claude-mem.db"), [
      { project: "shop", type: "decision", title: "We use pnpm in the shop." },
      { project: "shop", type: "bugfix", title: "Fixed the cart rounding." },
      { project: "warehouse", type: "gotcha", title: "Stock counts lag by a minute." },
    ]);
    writeFileSync(
      settingsPath,
      JSON.stringify({ model: "opus", enabledPlugins: { "claude-mem@thedotmack": true } }, null, 2),
    );
  });

  const imported = () => {
    const db = openDb({ dataDir, busyTimeoutMs: 2000 });
    try {
      return db.query<{ n: number }, []>("SELECT count(*) AS n FROM memories").get()?.n ?? 0;
    } finally {
      db.close();
    }
  };

  test("imports, retires claude-mem and installs, when told to go ahead", async () => {
    const result = await runCliWith(
      { env: env() },
      "install",
      "claude-code",
      "--binary",
      binary,
      "--yes",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("3 memories from 2 projects");
    expect(result.stdout).toContain("shop: 2");
    // The host's command is not on PATH here, so disabling is left to the user, and said so.
    expect(result.stdout).toContain("claude plugin disable claude-mem@thedotmack");
    expect(result.stdout).toContain("~/.claude-mem");
    expect(imported()).toBe(3);
    expect(settings().hooks.Stop[0].hooks[0]).toMatchObject({
      command: binary,
      args: ["hook", "claude-code", "turn-end"],
    });
    // The settings are the host's to change: we asked it, it was not there, so they stand.
    expect(settings().enabledPlugins).toEqual({ "claude-mem@thedotmack": true });
  });

  test("without a terminal and without --yes, only imports and says what it did not do", async () => {
    const result = await runCliWith({ env: env() }, "install", "claude-code", "--binary", binary);
    expect(result.exitCode).toBe(0);
    expect(imported()).toBe(3);
    expect(result.stdout).toContain("still enabled");
    expect(result.stdout).toContain("--yes");
  });

  test("--keep-claude-mem imports and leaves claude-mem alone, without asking", async () => {
    const result = await runCliWith(
      { env: env() },
      "install",
      "claude-code",
      "--binary",
      binary,
      "--keep-claude-mem",
    );
    expect(result.exitCode).toBe(0);
    expect(imported()).toBe(3);
    expect(result.stdout).toContain("still enabled");
    expect(result.stdout).not.toContain("--yes");
  });

  test("--no-import installs without touching claude-mem's data", async () => {
    const result = await runCliWith(
      { env: env() },
      "install",
      "claude-code",
      "--binary",
      binary,
      "--no-import",
      "--keep-claude-mem",
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dataDir, "wizardingcode-mem.db"))).toBe(false);
  });

  test("installing again does not import again", async () => {
    await runCliWith(
      { env: env() },
      "install",
      "claude-code",
      "--binary",
      binary,
      "--keep-claude-mem",
    );
    const again = await runCliWith(
      { env: env() },
      "install",
      "claude-code",
      "--binary",
      binary,
      "--keep-claude-mem",
    );
    expect(again.stdout).toContain("nothing new to import");
    expect(imported()).toBe(3);
  });
});

describe("wizardingcode-mem import claude-mem", () => {
  const env = () => ({
    HOME: home,
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    WIZARDINGCODE_MEM_CLAUDE_MEM_DIR: join(home, ".claude-mem"),
  });

  test("imports from the default location and reports", async () => {
    mkdirSync(join(home, ".claude-mem"));
    makeClaudeMemDb(join(home, ".claude-mem", "claude-mem.db"), [
      { project: "shop", type: "decision", title: "We use pnpm." },
    ]);
    const result = await runCliWith({ env: env() }, "import", "claude-mem");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 memories from 1 projects");
  });

  test("--db points at another file", async () => {
    const other = join(home, "backup.db");
    makeClaudeMemDb(other, [{ project: "p", type: "decision", title: "x" }]);
    const result = await runCliWith({ env: env() }, "import", "claude-mem", "--db", other);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1 memories");
  });

  test("with no database to import from, says where it looked", async () => {
    const result = await runCliWith({ env: env() }, "import", "claude-mem");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(join(home, ".claude-mem", "claude-mem.db"));
  });

  test("an unknown source is a usage error", async () => {
    const result = await runCliWith({ env: env() }, "import", "other-tool");
    expect(result.exitCode).toBe(64);
  });
});

describe("wizardingcode-mem install / uninstall", () => {
  // PATH is emptied so that the host's real command can never run from a test.
  const env = () => ({
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    PATH: "/nonexistent",
  });

  test("installs with an explicit binary, then uninstalls cleanly", async () => {
    const binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    const original = '{\n  "model": "opus"\n}\n';
    writeFileSync(settingsPath, original);
    const installed = await runCliWith(
      { env: env() },
      "install",
      "claude-code",
      "--binary",
      binary,
    );
    expect(installed.stderr).toBe("");
    expect(installed.exitCode).toBe(0);
    expect(installed.stdout).toContain(settingsPath);
    expect(installed.stdout).toContain(
      `claude mcp add --scope user wizardingcode-mem -- ${binary} mcp`,
    );
    expect(settings().hooks.Stop[0].hooks[0]).toEqual({
      type: "command",
      command: binary,
      args: ["hook", "claude-code", "turn-end"],
      timeout: 5,
    });

    const removed = await runCliWith({ env: env() }, "uninstall", "claude-code");
    expect(removed.exitCode).toBe(0);
    expect(removed.stdout).toContain(dataDir);
    expect(readFileSync(settingsPath, "utf8")).toBe(original);
  });

  test("a --binary that does not exist is refused before anything is written", async () => {
    const result = await runCliWith({ env: env() }, "install", "claude-code", "--binary", BIN);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(BIN);
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("run from source without --binary, explains what is needed", async () => {
    const result = await runCliWith({ env: env() }, "install", "claude-code");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--binary");
    expect(existsSync(settingsPath)).toBe(false);
  });

  test("an agent it does not know is a usage error", async () => {
    const result = await runCliWith({ env: env() }, "install", "some-agent");
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain("claude-code");
  });
});

describe("wizardingcode-mem install, with the shibaox-mem plugin of 0.3.0 still enabled", () => {
  let binary: string;
  let calls: string;
  const env = () => ({
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    WIZARDINGCODE_MEM_DATA_DIR: dataDir,
    WIZARDINGCODE_MEM_CLAUDE_MEM_DIR: join(home, ".claude-mem"),
    PATH: join(home, "bin"),
  });

  beforeEach(() => {
    binary = join(home, "wizardingcode-mem");
    writeFileSync(binary, "");
    calls = join(home, "calls.txt");
    // A stand-in for Claude Code's CLI that records what it was asked to do.
    mkdirSync(join(home, "bin"));
    writeFileSync(join(home, "bin", "claude"), `#!/bin/sh\necho "$@" >> '${calls}'\n`, {
      mode: 0o755,
    });
    writeFileSync(
      settingsPath,
      JSON.stringify({ enabledPlugins: { "shibaox-mem@shibaox-plugins": true } }, null, 2),
    );
  });

  test.skipIf(process.platform === "win32")(
    "uninstalls it through Claude Code, when told to go ahead",
    async () => {
      const result = await runCliWith(
        { env: env() },
        "install",
        "claude-code",
        "--binary",
        binary,
        "--yes",
      );
      expect(result.exitCode).toBe(0);
      expect(readFileSync(calls, "utf8")).toContain("plugin uninstall shibaox-mem@shibaox-plugins");
      expect(result.stdout).toContain("shibaox-mem@shibaox-plugins: uninstalled");
    },
  );

  test.skipIf(process.platform === "win32")(
    "without a terminal and without --yes, only says what to run",
    async () => {
      const result = await runCliWith({ env: env() }, "install", "claude-code", "--binary", binary);
      expect(result.exitCode).toBe(0);
      expect(existsSync(calls) ? readFileSync(calls, "utf8") : "").not.toContain("uninstall");
      expect(result.stdout).toContain("claude plugin uninstall shibaox-mem@shibaox-plugins");
    },
  );
});
