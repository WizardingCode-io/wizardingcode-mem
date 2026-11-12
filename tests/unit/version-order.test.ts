import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OLDER_JS } from "../../scripts/plugins.ts";
import { highestVersion, olderThan } from "../../src/util/version.ts";
import { VERSION_ORDER } from "../fixtures/version-order.ts";
import { shellOlderBlock } from "../helpers/version.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

describe("one version order, in three implementations", () => {
  test("TypeScript: olderThan", () => {
    for (const pair of VERSION_ORDER) {
      expect({ ...pair, got: olderThan(pair.have, pair.wanted) }).toEqual({
        ...pair,
        got: pair.older,
      });
    }
  });

  test("JavaScript: the older() of the OpenCode package", async () => {
    // Untyped generated JavaScript, so it is loaded by path with the shape it exports.
    const { older } = (await import(`${ROOT}plugins/opencode/binary.js`)) as {
      older: (have: string | null, wanted: string) => boolean;
    };
    for (const pair of VERSION_ORDER) {
      expect({ ...pair, got: older(pair.have, pair.wanted) }).toEqual({ ...pair, got: pair.older });
    }
  });

  test("shell: the older() of the plugins' script", () => {
    const block = shellOlderBlock(read("scripts/templates/wizardingcode-mem.sh"));
    for (const pair of VERSION_ORDER) {
      const run = Bun.spawnSync(
        ["sh", "-c", `${block}\nolder "$1" "$2"`, "sh", pair.have ?? "", pair.wanted],
        { stdout: "ignore", stderr: "pipe" },
      );
      expect({ ...pair, got: run.exitCode === 0 }).toEqual({ ...pair, got: pair.older });
    }
  });
});

describe("the highest of some versions", () => {
  test("is the one no other is above, by the same order", () => {
    expect(highestVersion(["0.9.0", "0.10.0-rc.1", "0.9.1", "0.10.0-rc.10", "0.10.0-rc.9"])).toBe(
      "0.10.0-rc.10",
    );
    expect(highestVersion(["0.9.0", "0.10.0-rc.1", "0.10.0"])).toBe("0.10.0");
    expect(highestVersion([])).toBeUndefined();
  });
});

describe("the copies of older()", () => {
  test("the npm shim carries OLDER_JS byte for byte", () => {
    const shim = read("npm/bin/wizardingcode-mem.js");
    const start = shim.indexOf("function older(");
    expect(start).toBeGreaterThan(-1);
    const end = shim.indexOf("\n}\n", start);
    expect(shim.slice(start, end + 2)).toBe(OLDER_JS);
  });

  test("scripts/install.sh carries the plugins' script's block byte for byte", () => {
    expect(shellOlderBlock(read("scripts/install.sh"))).toBe(
      shellOlderBlock(read("scripts/templates/wizardingcode-mem.sh")),
    );
  });
});
