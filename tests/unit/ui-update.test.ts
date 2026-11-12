// What the viewer says of a release: the banner's line, the About card's status with its
// tone and sign, the agents' note, the channels' rows, the switch and the mark on the
// Settings list. Pure texts, driven without a browser.
import { describe, expect, test } from "bun:test";
import {
  aboutMark,
  agentsNote,
  bannerLine,
  bannerShort,
  channelRows,
  checksDaily,
  releaseStatus,
  type ViewerUpdate,
} from "../../ui/src/update.ts";

const base: ViewerUpdate = {
  running: "0.8.0",
  staged: null,
  latest: null,
  checkedAt: null,
  failedAt: null,
  reason: null,
  mode: "check",
  out: false,
  failed: false,
  built: true,
  line: "not checked yet",
  agents: null,
  commands: [],
  fromEnvironment: false,
  banner: false,
};
const out = (over: Partial<ViewerUpdate> = {}): ViewerUpdate => ({
  ...base,
  latest: "0.9.0",
  checkedAt: 1,
  out: true,
  banner: true,
  line: "0.9.0 is out (checked 3 h ago); this copy is 0.8.0",
  ...over,
});
const staged = out({
  staged: "0.7.0",
  line: "0.9.0 is out (checked 3 h ago); the agents run 0.7.0",
  agents:
    "agents run 0.7.0 from /data/bin/wizardingcode-mem; this copy is 0.8.0: wizardingcode-mem install moves them to it",
});

describe("the banner's line", () => {
  test("names the release and who runs what", () => {
    expect(bannerLine(out())).toBe("wizardingcode-mem 0.9.0 is out. This copy is 0.8.0.");
    expect(bannerLine(staged)).toBe("wizardingcode-mem 0.9.0 is out. The agents run 0.7.0.");
  });

  test("at a phone's width it keeps the one fact that must not be cut: which release is out", () => {
    expect(bannerShort(out())).toBe("0.9.0 is out.");
    expect(bannerShort(staged)).toBe("0.9.0 is out.");
  });
});

describe("the About card's status", () => {
  const cases: [
    string,
    ViewerUpdate,
    string,
    "warn" | "quiet" | "muted",
    "out" | "problem" | "ok" | "idle",
  ][] = [
    [
      "out with a staged copy",
      staged,
      "0.9.0 is out (checked 3 h ago); the agents run 0.7.0",
      "warn",
      "out",
    ],
    ["out with none", out(), "0.9.0 is out (checked 3 h ago); this copy is 0.8.0", "warn", "out"],
    [
      "latest",
      { ...base, latest: "0.8.0", checkedAt: 1, line: "0.8.0 is the latest (checked 3 h ago)" },
      "0.8.0 is the latest (checked 3 h ago)",
      "quiet",
      "ok",
    ],
    [
      "ahead",
      {
        ...base,
        latest: "0.7.0",
        checkedAt: 1,
        line: "0.8.0 is ahead of the latest release 0.7.0 (checked 3 h ago)",
      },
      "0.8.0 is ahead of the latest release 0.7.0 (checked 3 h ago)",
      "quiet",
      "ok",
    ],
    [
      "off",
      { ...base, mode: "off", line: "off (WIZARDINGCODE_MEM_UPDATE in /data/env)" },
      "Off (WIZARDINGCODE_MEM_UPDATE in /data/env)",
      "muted",
      "idle",
    ],
    [
      "off by the environment",
      {
        ...base,
        mode: "off",
        fromEnvironment: true,
        line: "off (WIZARDINGCODE_MEM_UPDATE in this command's environment; other processes may not see it)",
      },
      "Off (WIZARDINGCODE_MEM_UPDATE in the environment this viewer was started with)",
      "muted",
      "idle",
    ],
    [
      "off-unknown",
      {
        ...base,
        mode: "off-unknown",
        line: "off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)",
      },
      "Off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)",
      "muted",
      "idle",
    ],
    [
      "not checked in CI",
      { ...base, mode: "ci", line: "not checked in CI" },
      "Not checked in CI",
      "muted",
      "idle",
    ],
    ["not checked yet", base, "Not checked yet", "muted", "idle"],
    [
      "could not check",
      {
        ...base,
        failed: true,
        failedAt: 2,
        reason: "offline",
        line: "could not check (offline, 2 h ago); no release known yet",
      },
      "Could not check (offline, 2 h ago); no release known yet",
      "warn",
      "problem",
    ],
    [
      "a report that could not be built",
      { ...base, built: false, line: "not checked: EACCES: permission denied" },
      "Not checked: EACCES: permission denied",
      "warn",
      "problem",
    ],
  ];
  for (const [name, update, text, tone, sign] of cases) {
    test(`${name}: ${tone}, ${sign}`, () => {
      expect(releaseStatus(update)).toEqual({ text, tone, sign });
    });
  }

  test("a failed check with a release still known is a problem; the server says which, never the wording", () => {
    const failedLater = {
      ...base,
      latest: "0.8.0",
      checkedAt: 1,
      failedAt: 5,
      failed: true,
      reason: "offline",
      line: "could not check (offline, 2 h ago); last known 0.8.0",
    };
    expect(releaseStatus(failedLater)).toMatchObject({ tone: "warn", sign: "problem" });
    // The same words with `failed` false are a plain fact: the tone follows the field.
    expect(releaseStatus({ ...failedLater, failed: false })).toMatchObject({
      tone: "quiet",
      sign: "ok",
    });
    expect(releaseStatus({ ...base, line: "not checked: something" })).toMatchObject({
      tone: "muted",
      sign: "idle",
    });
  });
});

describe("the agents' note", () => {
  test("is left out when the status already says what the agents run, and said otherwise", () => {
    expect(agentsNote(staged)).toBeNull();
    expect(agentsNote(base)).toBeNull();
    const behind = {
      ...base,
      latest: "0.8.0",
      checkedAt: 1,
      staged: "0.7.0",
      line: "0.7.0 is the latest (checked 3 h ago)",
      agents:
        "agents run 0.7.0 from /data/bin/wizardingcode-mem; this copy is 0.8.0: wizardingcode-mem install moves them to it",
    };
    expect(agentsNote(behind)).toBe(
      "Agents run 0.7.0 from /data/bin/wizardingcode-mem; this copy is 0.8.0: wizardingcode-mem install moves them to it",
    );
  });
});

describe("the channels' rows", () => {
  test("a name and a sentence each start with a capital; a shell command is left as it is typed", () => {
    expect(
      channelRows({
        ...out(),
        commands: [
          {
            channel: "plugin",
            command: "update the wizardingcode-mem plugin from your agent's plugin manager",
            shell: false,
          },
          {
            channel: "Homebrew",
            command: "brew upgrade wizardingcode-mem && wizardingcode-mem install",
            shell: true,
          },
          {
            channel: "npm (and Windows)",
            command: "npx wizardingcode-mem@latest install",
            shell: true,
          },
          {
            channel: "script",
            command: "curl -fsSL https://example.test/install.sh | sh",
            shell: true,
          },
        ],
      }),
    ).toEqual([
      {
        channel: "Plugin",
        text: "Update the wizardingcode-mem plugin from your agent's plugin manager",
        shell: false,
      },
      {
        channel: "Homebrew",
        text: "brew upgrade wizardingcode-mem && wizardingcode-mem install",
        shell: true,
      },
      { channel: "npm (and Windows)", text: "npx wizardingcode-mem@latest install", shell: true },
      { channel: "Script", text: "curl -fsSL https://example.test/install.sh | sh", shell: true },
    ]);
    expect(channelRows(base)).toEqual([]);
  });
});

describe("the switch", () => {
  test("is on only while a check can run, whatever the key holds", () => {
    expect(checksDaily(base, null)).toBe(true);
    expect(checksDaily({ ...base, mode: "ci" }, null)).toBe(true);
    expect(checksDaily({ ...base, mode: "off" }, "off")).toBe(false);
    // An unknown value turns the check off: the switch must not read on.
    expect(checksDaily({ ...base, mode: "off-unknown" }, "sometimes")).toBe(false);
    // Before the report is read, the setting's own value decides.
    expect(checksDaily(null, "off")).toBe(false);
    expect(checksDaily(null, null)).toBe(true);
  });
});

describe("the Settings list's mark", () => {
  test("About is marked while a release is out, dismissed banner or not, and never otherwise", () => {
    expect(aboutMark(out())).toBe("new");
    expect(aboutMark(out({ banner: false }))).toBe("new");
    expect(aboutMark(base)).toBeUndefined();
    expect(aboutMark({ ...base, mode: "off", line: "off" })).toBeUndefined();
    expect(aboutMark(null)).toBeUndefined();
  });
});
