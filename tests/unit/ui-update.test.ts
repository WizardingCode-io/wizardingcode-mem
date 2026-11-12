// What the viewer says of a release: the banner's line, the About card's status and its
// tone, and the mark on the Settings list. Pure texts, driven without a browser.
import { describe, expect, test } from "bun:test";
import { aboutMark, bannerLine, releaseStatus, type ViewerUpdate } from "../../ui/src/update.ts";

const base: ViewerUpdate = {
  running: "0.8.0",
  staged: null,
  latest: null,
  checkedAt: null,
  failedAt: null,
  reason: null,
  mode: "check",
  out: false,
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

describe("the banner's line", () => {
  test("names the release and who runs what", () => {
    expect(bannerLine(out())).toBe("wizardingcode-mem 0.9.0 is out. This copy is 0.8.0.");
    expect(
      bannerLine(
        out({ staged: "0.7.0", line: "0.9.0 is out (checked 3 h ago); the agents run 0.7.0" }),
      ),
    ).toBe("wizardingcode-mem 0.9.0 is out. The agents run 0.7.0.");
  });
});

describe("the banner at a phone's width", () => {
  test("keeps the one fact that must not be cut: which release is out", () => {
    expect(bannerShort(out())).toBe("0.9.0 is out.");
    expect(bannerShort(out({ staged: "0.7.0" }))).toBe("0.9.0 is out.");
  });
});

describe("the About card's status", () => {
  const cases: [string, ViewerUpdate, "warn" | "quiet" | "muted"][] = [
    [
      "out with a staged copy",
      out({ staged: "0.7.0", line: "0.9.0 is out (checked 3 h ago); the agents run 0.7.0" }),
      "warn",
    ],
    ["out with none", out(), "warn"],
    [
      "latest",
      { ...base, latest: "0.8.0", checkedAt: 1, line: "0.8.0 is the latest (checked 3 h ago)" },
      "quiet",
    ],
    [
      "ahead",
      {
        ...base,
        latest: "0.7.0",
        checkedAt: 1,
        line: "0.8.0 is ahead of the latest release 0.7.0 (checked 3 h ago)",
      },
      "quiet",
    ],
    ["off", { ...base, mode: "off", line: "off (WIZARDINGCODE_MEM_UPDATE in /data/env)" }, "muted"],
    [
      "off by the environment",
      {
        ...base,
        mode: "off",
        fromEnvironment: true,
        line: "off (WIZARDINGCODE_MEM_UPDATE in this command's environment; other processes may not see it)",
      },
      "muted",
    ],
    [
      "off-unknown",
      {
        ...base,
        mode: "off-unknown",
        line: "off (WIZARDINGCODE_MEM_UPDATE is neither check nor off)",
      },
      "muted",
    ],
    ["not checked in CI", { ...base, mode: "ci", line: "not checked in CI" }, "muted"],
    ["not checked yet", base, "muted"],
    [
      "could not check",
      {
        ...base,
        failedAt: 2,
        reason: "offline",
        line: "could not check (offline, 2 h ago); no release known yet",
      },
      "warn",
    ],
    [
      "a report that could not be built",
      { ...base, line: "not checked: EACCES: permission denied" },
      "warn",
    ],
  ];
  for (const [name, update, tone] of cases) {
    test(`${name}: the server's line, capitalised, in the ${tone} tone`, () => {
      const status = releaseStatus(update);
      expect(status.tone).toBe(tone);
      expect(status.text).toBe(update.line.charAt(0).toUpperCase() + update.line.slice(1));
    });
  }

  test("a failed check after a good one is still a warning, and a good one after a failure is not", () => {
    const failedLater = {
      ...base,
      latest: "0.8.0",
      checkedAt: 1,
      failedAt: 5,
      reason: "offline",
      line: "could not check (offline, 2 h ago); last known 0.8.0",
    };
    expect(releaseStatus(failedLater).tone).toBe("warn");
    const recovered = {
      ...base,
      latest: "0.8.0",
      checkedAt: 9,
      failedAt: 5,
      reason: "offline",
      line: "0.8.0 is the latest (checked 3 h ago)",
    };
    expect(releaseStatus(recovered).tone).toBe("quiet");
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
