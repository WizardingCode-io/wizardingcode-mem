// The check for a newer release: one request whose answer is only a redirect's Location,
// a state file read strictly, and the rules for when a request may be made at all.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkForRelease,
  due,
  latestRelease,
  mode,
  REQUEST_LIMIT_MS,
} from "../../src/update/check.ts";
import { readState, STATE_FILE, type UpdateState, writeState } from "../../src/update/state.ts";

const REPO = "o/r";
const TAG = (version: string) => `https://github.com/${REPO}/releases/tag/v${version}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

interface Call {
  url: string;
  init: RequestInit | undefined;
}
/** A fetch that answers one status and Location, records how it was called, and has no readable body. */
function redirect(status: number, location: string | null, calls: Call[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const untouchable = () => {
      throw new Error("the body was read");
    };
    return {
      status,
      headers: new Headers(location === null ? {} : { Location: location }),
      get body() {
        return untouchable();
      },
      text: untouchable,
      json: untouchable,
    };
  }) as unknown as typeof fetch;
}
const state = (over: Partial<UpdateState> = {}): UpdateState => ({
  latest: null,
  checkedAt: null,
  attemptAt: null,
  failedAt: null,
  reason: null,
  ...over,
});

describe("latestRelease", () => {
  test.each([301, 302])("a %i to the release's tag gives its version", async (status) => {
    const calls: Call[] = [];
    expect(await latestRelease(redirect(status, TAG("1.2.3"), calls), REPO)).toEqual({
      ok: true,
      version: "1.2.3",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`https://github.com/${REPO}/releases/latest`);
  });

  test("the request is a GET that follows nothing and names nothing of the machine", async () => {
    const calls: Call[] = [];
    await latestRelease(redirect(302, TAG("1.2.3"), calls), REPO);
    const init = calls[0]?.init as RequestInit & Record<string, unknown>;
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({ "User-Agent": "wizardingcode-mem" });
    expect("body" in init).toBe(false);
    expect("credentials" in init).toBe(false);
  });

  test.each([
    ["a page", 200, null, "HTTP 200"],
    ["a missing repository", 404, null, "HTTP 404"],
    ["a rate limit", 429, null, "HTTP 429"],
    ["a redirect with no Location", 302, null, "not a release redirect"],
    ["plain http", 302, `http://github.com/${REPO}/releases/tag/v1.2.3`, "not a release redirect"],
    [
      "another host",
      302,
      `https://example.com/${REPO}/releases/tag/v1.2.3`,
      "not a release redirect",
    ],
    [
      "another repository",
      302,
      "https://github.com/o/other/releases/tag/v1.2.3",
      "not a release redirect",
    ],
    ["a trailing path", 302, `${TAG("1.2.3")}/x`, "not a release redirect"],
    ["two numbers", 302, TAG("1.2"), "not a release redirect"],
    ["a pre-release", 302, TAG("1.2.3-rc.1"), "not a release redirect"],
    ["a number of six digits", 302, TAG("123456.0.0"), "not a release redirect"],
    ["a status of two digits", 99, null, "not a release redirect"],
  ])("%s is a reason, not a version", async (_what, status, location, reason) => {
    expect(await latestRelease(redirect(status, location), REPO)).toEqual({ ok: false, reason });
  });

  test("a request that throws is offline", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await latestRelease(failing, REPO)).toEqual({ ok: false, reason: "offline" });
  });

  test("the limit is five seconds, and a request that never settles is cut at the limit given", async () => {
    expect(REQUEST_LIMIT_MS).toBe(5000);
    const never = (() => new Promise(() => {})) as unknown as typeof fetch;
    const started = performance.now();
    expect(await latestRelease(never, REPO, { timeoutMs: 20 })).toEqual({
      ok: false,
      reason: "timed out",
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("due", () => {
  test.each<[string, UpdateState | null, boolean]>([
    ["no state", null, true],
    ["nothing recorded", state(), true],
    ["an attempt in the future", state({ attemptAt: NOW + 1, checkedAt: NOW - HOUR }), true],
    ["a success in the future", state({ checkedAt: NOW + 1 }), true],
    ["a failure in the future", state({ failedAt: NOW + 1, checkedAt: NOW - HOUR }), true],
    ["an attempt 59 seconds old and nothing else", state({ attemptAt: NOW - 59_000 }), false],
    ["an attempt 60 seconds old and nothing else", state({ attemptAt: NOW - 60_000 }), true],
    ["a failure just under an hour old", state({ failedAt: NOW - HOUR + 1 }), false],
    ["a failure an hour old", state({ failedAt: NOW - HOUR }), true],
    [
      "a failure an hour old, after an older success",
      state({ failedAt: NOW - HOUR, checkedAt: NOW - 2 * HOUR }),
      true,
    ],
    [
      "a failure just under an hour old, after an older success",
      state({ failedAt: NOW - HOUR + 1, checkedAt: NOW - 3 * DAY }),
      false,
    ],
    ["a success just under a day old", state({ checkedAt: NOW - DAY + 1 }), false],
    ["a success a day old", state({ checkedAt: NOW - DAY }), true],
    [
      "a success two hours old, after an older failure",
      state({ checkedAt: NOW - 2 * HOUR, failedAt: NOW - 5 * HOUR }),
      false,
    ],
  ])("%s", (_what, value, expected) => {
    expect(due(value, NOW)).toBe(expected);
  });
});

describe("mode", () => {
  test.each<[string | null, string | undefined, string]>([
    [null, undefined, "check"],
    ["check", undefined, "check"],
    ["off", undefined, "off"],
    ["off", "1", "off"],
    ["maybe", undefined, "off-unknown"],
    ["maybe", "true", "off-unknown"],
    [null, "true", "ci"],
    ["check", "1", "ci"],
    [null, "", "check"],
  ])("the key %p with CI %p is %s", (value, ci, expected) => {
    expect(mode(value, ci === undefined ? {} : { CI: ci })).toBe(
      expected as ReturnType<typeof mode>,
    );
  });
});

describe("the state file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wizardingcode-mem-update-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const raw = (value: unknown) => writeFileSync(join(dir, STATE_FILE), JSON.stringify(value));

  test("what was written is read back, in a file only its owner reads", () => {
    const written = state({ latest: "1.2.3", checkedAt: NOW, attemptAt: NOW });
    writeState(dir, written);
    expect(readState(dir)).toEqual(written);
    expect(statSync(join(dir, STATE_FILE)).mode & 0o777).toBe(0o600);
  });

  test.each<[string, unknown]>([
    ["a version with an escape sequence", { ...state(), latest: "1.0.0\u001b[31m" }],
    ["a version with a pre-release", { ...state(), latest: "1.0.0-rc.1" }],
    ["a reason with a line break", { ...state(), reason: "offline\nrm -rf" }],
    ["a reason that is not one of the four", { ...state(), reason: "because" }],
    ["a time that is a text", { ...state(), checkedAt: "x" }],
    ["a missing field", { latest: null }],
    ["an array", []],
  ])("%s reads as no state", (_what, value) => {
    raw(value);
    expect(readState(dir)).toBeNull();
  });

  test("a missing file and a file that is not JSON read as no state", () => {
    expect(readState(dir)).toBeNull();
    writeFileSync(join(dir, STATE_FILE), "{ not json");
    expect(readState(dir)).toBeNull();
  });
});

describe("checkForRelease", () => {
  let home: string;
  let dir: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "wizardingcode-mem-update-"));
    // A data directory that does not exist yet: the first check creates it.
    dir = join(home, "mem");
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });
  const input = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => ({
    dataDir: dir,
    mode: "check" as const,
    now: NOW,
    fetch: fetchImpl,
    repository: REPO,
    ...over,
  });

  test("a success creates the folder and records the latest", async () => {
    const calls: Call[] = [];
    const result = await checkForRelease(input(redirect(302, TAG("1.2.3"), calls)));
    expect(result.asked).toBe(true);
    expect(existsSync(join(dir, STATE_FILE))).toBe(true);
    expect(readState(dir)).toEqual(state({ latest: "1.2.3", checkedAt: NOW, attemptAt: NOW }));
    expect(calls).toHaveLength(1);
  });

  test("a lower latest replaces a higher one, and a success clears the reason", async () => {
    writeState(dir, state({ latest: "9.9.9", failedAt: NOW - 2 * HOUR, reason: "offline" }));
    await checkForRelease(input(redirect(302, TAG("1.2.3"))));
    expect(readState(dir)).toEqual(
      state({ latest: "1.2.3", checkedAt: NOW, attemptAt: NOW, failedAt: NOW - 2 * HOUR }),
    );
  });

  test("a failure keeps the last known version and records the reason", async () => {
    writeState(dir, state({ latest: "1.2.3", checkedAt: NOW - 2 * DAY }));
    await checkForRelease(input(redirect(429, null)));
    expect(readState(dir)).toEqual(
      state({
        latest: "1.2.3",
        checkedAt: NOW - 2 * DAY,
        attemptAt: NOW,
        failedAt: NOW,
        reason: "HTTP 429",
      }),
    );
  });

  test("nothing is asked when the check is not due, and a forced one asks all the same", async () => {
    writeState(dir, state({ latest: "1.2.3", checkedAt: NOW - HOUR }));
    const calls: Call[] = [];
    const quiet = await checkForRelease(input(redirect(302, TAG("1.2.4"), calls)));
    expect(quiet.asked).toBe(false);
    expect(calls).toHaveLength(0);
    const forced = await checkForRelease(
      input(redirect(302, TAG("1.2.4"), calls), { force: true }),
    );
    expect(forced.asked).toBe(true);
    expect(readState(dir)?.latest).toBe("1.2.4");
  });

  test("a second check started while the first is waiting asks nothing", async () => {
    const calls: Call[] = [];
    let answer: (value: unknown) => void = () => {};
    const slow = ((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Promise((resolve) => {
        answer = resolve;
      });
    }) as unknown as typeof fetch;
    const first = checkForRelease(input(slow));
    // The first has recorded its attempt and is now waiting for github.com.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await checkForRelease(input(slow, { now: NOW + 1000 }));
    expect(second.asked).toBe(false);
    answer({ status: 302, headers: new Headers({ Location: TAG("1.2.3") }) });
    expect((await first).asked).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("a time in the future costs one request, not one at every drain", async () => {
    writeState(dir, state({ latest: "1.2.3", checkedAt: NOW + 30 * DAY }));
    const calls: Call[] = [];
    await checkForRelease(input(redirect(429, null, calls)));
    await checkForRelease(input(redirect(429, null, calls), { now: NOW + 5 * 60_000 }));
    expect(calls).toHaveLength(1);
    expect(readState(dir)).toEqual(
      state({ latest: "1.2.3", attemptAt: NOW, failedAt: NOW, reason: "HTTP 429" }),
    );
  });

  test.each(["off", "off-unknown", "ci"] as const)("in mode %s nothing is asked", async (value) => {
    const calls: Call[] = [];
    const result = await checkForRelease(
      input(redirect(302, TAG("1.2.3"), calls), { mode: value }),
    );
    expect(result.asked).toBe(false);
    expect(calls).toHaveLength(0);
    expect(existsSync(dir)).toBe(false);
  });

  test("a forced check asks in CI, and still not when the key is off or unknown", async () => {
    const calls: Call[] = [];
    const fetchImpl = redirect(302, TAG("1.2.3"), calls);
    expect((await checkForRelease(input(fetchImpl, { mode: "ci", force: true }))).asked).toBe(true);
    for (const value of ["off", "off-unknown"] as const)
      expect((await checkForRelease(input(fetchImpl, { mode: value, force: true }))).asked).toBe(
        false,
      );
    expect(calls).toHaveLength(1);
  });

  test("a state that cannot be written is an error said, not thrown", async () => {
    // A file where the data directory should be.
    writeFileSync(dir, "in the way");
    const result = await checkForRelease(input(redirect(302, TAG("1.2.3"))));
    expect(result.error).toBeString();
    expect(readFileSync(dir, "utf8")).toBe("in the way");
  });
});
