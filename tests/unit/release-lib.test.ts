import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TARGETS } from "../../scripts/build.ts";
import {
  checkPackageVersion,
  decideHold,
  decideNpmView,
  decidePlan,
  decideToken,
  editManifest,
  editManifests,
  environmentState,
  latestLine,
  type Outcome,
  type PlanFacts,
  parseChecksums,
  parseContract,
  planSummary,
  previousPlain,
  publishArgs,
  publishFailure,
  REQUIRED_ASSETS,
  ReleaseError,
  renderFormula,
  summaryLine,
} from "../../scripts/release/lib.ts";
import { ACCEPTED_CONTRACTS, CONTRACT } from "../../src/team/contract.ts";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

// The pure decisions of the release's distribution (scripts/release/lib.ts): what may be
// distributed, what each target writes, and every line the run's summary carries.

describe("the run's summary", () => {
  test("every text of the summary table", () => {
    const lines: Array<[Parameters<typeof summaryLine>[0], Outcome, string]> = [
      [
        "npm",
        { kind: "published", name: "wizardingcode-mem", version: "0.9.0", tag: "latest" },
        "wizardingcode-mem 0.9.0: published (dist-tag latest)",
      ],
      [
        "npm",
        { kind: "already-published", name: "wizardingcode-mem", version: "0.9.0" },
        "wizardingcode-mem 0.9.0: already published",
      ],
      [
        "npm",
        { kind: "would-publish", name: "wizardingcode-mem", version: "0.9.0" },
        "wizardingcode-mem 0.9.0: would publish (dry run)",
      ],
      ["tap", { kind: "written", version: "0.9.0" }, "tap: written, 0.9.0"],
      ["tap", { kind: "already-at", version: "0.9.0" }, "tap: already at 0.9.0"],
      ["tap", { kind: "would-write", version: "0.9.0" }, "tap: would write 0.9.0 (dry run)"],
      ["tap", { kind: "skipped-prerelease" }, "tap: skipped: pre-release"],
      ["marketplace", { kind: "written", version: "0.9.0" }, "marketplace: written, 0.9.0"],
      ["marketplace", { kind: "already-at", version: "0.9.0" }, "marketplace: already at 0.9.0"],
      [
        "marketplace",
        { kind: "left-alone", higher: "0.10.0" },
        "marketplace: left alone, the manifest names 0.10.0",
      ],
      [
        "marketplace",
        { kind: "would-write", version: "0.9.0" },
        "marketplace: would write 0.9.0 (dry run)",
      ],
      ["marketplace", { kind: "skipped-prerelease" }, "marketplace: skipped: pre-release"],
      ["latest", { kind: "moved", version: "0.9.0" }, "latest: moved to 0.9.0"],
      ["latest", { kind: "would-move", version: "0.9.0" }, "latest: would move to 0.9.0 (dry run)"],
      [
        "latest",
        { kind: "held-contract", tag: "v0.10.0", accepts: 4, previous: "v0.9.0", speaks: 3 },
        "latest: held: v0.10.0 accepts contract 4 and up; v0.9.0 speaks 3",
      ],
      [
        "latest",
        { kind: "held-unreadable", read: "src/team/contract.ts at v0.10.0" },
        "latest: held: src/team/contract.ts at v0.10.0",
      ],
      [
        "latest",
        { kind: "moved-by-hand", version: "0.10.0" },
        "latest: moved to 0.10.0, the hold released by hand",
      ],
      ["latest", { kind: "skipped-prerelease" }, "latest: skipped: pre-release"],
      [
        "latest",
        { kind: "not-moved", job: "marketplace" },
        "latest: not moved: marketplace did not succeed",
      ],
      [
        "token",
        { kind: "token-ok", date: "2027-11-12", days: 365 },
        "MARKETPLACE_TOKEN expires on 2027-11-12 (365 days)",
      ],
      [
        "token",
        { kind: "token-renew", date: "2026-11-20", days: 8 },
        "renew it: MARKETPLACE_TOKEN expires on 2026-11-20 (8 days)",
      ],
      [
        "token",
        { kind: "token-unknown" },
        "MARKETPLACE_TOKEN: expiry unknown (no expiration header); check the date noted when it was created",
      ],
      [
        "tap",
        { kind: "failed", sentence: "the push was refused twice" },
        "tap: failed: the push was refused twice",
      ],
      ["npm", { kind: "failed", sentence: "npm said no" }, "npm: failed: npm said no"],
      [
        "plan",
        { kind: "refused", sentence: "the tag v9 does not exist" },
        "distribute: refused: the tag v9 does not exist",
      ],
    ];
    for (const [target, outcome, text] of lines) expect(summaryLine(target, outcome)).toBe(text);
  });

  test("a combination the table does not hold is an error, never an invented line", () => {
    expect(() => summaryLine("tap", { kind: "moved", version: "0.9.0" })).toThrow();
    expect(() => summaryLine("latest", { kind: "written", version: "0.9.0" })).toThrow();
  });

  test("plan writes the lines of the targets it causes to be skipped or held", () => {
    expect(planSummary({ prerelease: true, hold: null })).toEqual([
      "tap: skipped: pre-release",
      "marketplace: skipped: pre-release",
      "latest: skipped: pre-release",
    ]);
    expect(
      planSummary({
        prerelease: false,
        hold: { kind: "held-contract", tag: "v0.10.0", accepts: 4, previous: "v0.9.0", speaks: 3 },
      }),
    ).toEqual(["latest: held: v0.10.0 accepts contract 4 and up; v0.9.0 speaks 3"]);
    expect(planSummary({ prerelease: false, hold: null })).toEqual([]);
  });

  test("the latest job's line for a run that moves the tag", () => {
    expect(latestLine({ version: "0.9.0", dryRun: false, byHand: false })).toBe(
      "latest: moved to 0.9.0",
    );
    expect(latestLine({ version: "0.9.0", dryRun: true, byHand: true })).toBe(
      "latest: would move to 0.9.0 (dry run)",
    );
    expect(latestLine({ version: "0.9.0", dryRun: false, byHand: true })).toBe(
      "latest: moved to 0.9.0, the hold released by hand",
    );
  });
});

describe("the Homebrew formula", () => {
  const template = read("packaging/homebrew/wizardingcode-mem.rb.template");
  const sums = (names: string[]) =>
    names.map((name, index) => `${String(index + 1).repeat(64)}  ${name}`).join("\n");
  const NAMES = [
    "wizardingcode-mem-darwin-arm64",
    "wizardingcode-mem-darwin-x64",
    "wizardingcode-mem-linux-arm64",
    "wizardingcode-mem-linux-x64",
    "wizardingcode-mem-windows-x64.exe",
  ];

  test("checksums.txt is read by file name", () => {
    const parsed = parseChecksums(`${sums(NAMES)}\nnot a checksum line\n`);
    expect(parsed.size).toBe(5);
    expect(parsed.get("wizardingcode-mem-darwin-x64")).toBe("2".repeat(64));
  });

  test("rendered with a version and the release's checksums: the version in every URL, each checksum under its platform, no mark left", () => {
    const formula = renderFormula(template, "1.2.3", parseChecksums(sums(NAMES)));
    expect(formula).toContain('version "1.2.3"');
    expect(formula.match(/\/download\/v1\.2\.3\//g)).toHaveLength(4);
    expect(formula).not.toMatch(/@[A-Z0-9_]+@/);
    const lines = formula.split("\n");
    for (const [index, name] of NAMES.slice(0, 4).entries()) {
      const url = lines.findIndex((line) => line.includes(`/${name}"`));
      expect(url).toBeGreaterThan(-1);
      expect(lines[url + 1]).toContain(`sha256 "${String(index + 1).repeat(64)}"`);
    }
  });

  test("a checksums.txt that lacks a platform's binary fails, naming it", () => {
    const without = NAMES.filter((name) => name !== "wizardingcode-mem-linux-arm64");
    expect(() => renderFormula(template, "1.2.3", parseChecksums(sums(without)))).toThrow(
      new ReleaseError("checksums.txt has no wizardingcode-mem-linux-arm64"),
    );
  });

  test("a mark the release cannot fill fails, naming it", () => {
    expect(() =>
      renderFormula(`${template}\n# @SHA256_PLAN9_MIPS@\n`, "1.2.3", parseChecksums(sums(NAMES))),
    ).toThrow(new ReleaseError("the formula template still holds @SHA256_PLAN9_MIPS@"));
  });
});

describe("the marketplace's manifests", () => {
  const claude = read("tests/fixtures/release/marketplace.claude.json");
  const agents = read("tests/fixtures/release/marketplace.agents.json");
  const current = (
    JSON.parse(claude) as { plugins: Array<{ name: string; version: string }> }
  ).plugins.find((plugin) => plugin.name === "wizardingcode-mem")?.version as string;

  test("only the wizardingcode-mem entry's version and ref change; every other byte stays", () => {
    const edited = editManifest(claude, "claude", "99.0.0");
    expect(edited.outcome).toBe("written");
    expect(edited.text).not.toBe(claude);
    // Putting the two old values back gives the file as it was.
    expect(
      edited.text
        .replace('"version": "99.0.0"', `"version": "${current}"`)
        .replace('"ref": "v99.0.0"', `"ref": "v${current}"`),
    ).toBe(claude);
    const before = JSON.parse(claude) as Manifest;
    const after = JSON.parse(edited.text) as Manifest;
    expect(after.metadata).toEqual(before.metadata);
    for (const [index, plugin] of after.plugins.entries()) {
      if (plugin.name === "wizardingcode-mem") {
        expect(plugin.version).toBe("99.0.0");
        expect(plugin.source.ref).toBe("v99.0.0");
      } else expect(plugin).toEqual(before.plugins[index] as Manifest["plugins"][number]);
    }
  });

  test("the agents' manifest carries only a ref", () => {
    const edited = editManifest(agents, "agents", "99.0.0");
    expect(edited.outcome).toBe("written");
    expect(edited.text.replace('"ref": "v99.0.0"', `"ref": "v${current}"`)).toBe(agents);
  });

  test("an entry already at the version is left as it is", () => {
    expect(editManifest(claude, "claude", current)).toEqual({
      text: claude,
      outcome: "already-at",
    });
    expect(editManifest(agents, "agents", current)).toEqual({
      text: agents,
      outcome: "already-at",
    });
  });

  test("an entry at a higher version is left alone, and named", () => {
    expect(editManifest(claude, "claude", "0.0.1")).toEqual({
      text: claude,
      outcome: "left-alone",
      higher: current,
    });
  });

  test("an entry whose ref is not a version tag, and a manifest without the entry, fail", () => {
    expect(() =>
      editManifest(agents.replace(`"ref": "v${current}"`, '"ref": "main"'), "agents", "9.0.0"),
    ).toThrow("the agents manifest's wizardingcode-mem entry's ref is not a version tag");
    expect(() =>
      editManifest(claude.replaceAll('"wizardingcode-mem"', '"another"'), "claude", "9.0.0"),
    ).toThrow("the claude manifest has no wizardingcode-mem entry");
    expect(() =>
      editManifest(claude.replace(`"ref": "v${current}"`, '"ref": "main"'), "claude", "9.0.0"),
    ).toThrow("the claude manifest's wizardingcode-mem entry's ref is not a version tag");
    // The entry's own version, not another plugin's or the marketplace's, is the one read.
    const noVersion = claude.replace(`"version": "${current}",`, "");
    expect(noVersion).not.toBe(claude);
    expect(() => editManifest(noVersion, "claude", "9.0.0")).toThrow(
      "the claude manifest's wizardingcode-mem entry has no version",
    );
  });

  test("when either manifest is at a higher version, neither is written", () => {
    const higher = agents.replace(`"ref": "v${current}"`, '"ref": "v99.0.0"');
    expect(editManifests(claude, higher, "98.0.0")).toEqual({
      claude,
      agents: higher,
      outcome: "left-alone",
      higher: "99.0.0",
    });
    const both = editManifests(claude, agents, "98.0.0");
    expect(both.outcome).toBe("written");
    expect(both.claude).toContain('"ref": "v98.0.0"');
    expect(both.agents).toContain('"ref": "v98.0.0"');
    expect(editManifests(claude, agents, current).outcome).toBe("already-at");
    // Either one: Claude's manifest higher stops the write to the agents' too.
    const claudeHigher = claude
      .replace(`"version": "${current}"`, '"version": "99.0.0"')
      .replace(`"ref": "v${current}"`, '"ref": "v99.0.0"');
    expect(editManifests(claudeHigher, agents, "98.0.0")).toEqual({
      claude: claudeHigher,
      agents,
      outcome: "left-alone",
      higher: "99.0.0",
    });
  });

  interface Manifest {
    metadata: unknown;
    plugins: Array<{ name: string; version?: string; source: { ref?: string } }>;
  }
});

describe("what may be distributed", () => {
  const ready = {
    exists: true,
    policy: { protected_branches: false, custom_branch_policies: true },
    branches: [{ name: "main", type: "branch" }],
  };
  const base: PlanFacts = {
    ref: "refs/heads/main",
    tag: "v0.9.0",
    tags: ["v0.8.0", "v0.9.0", "v0.9.0-rc.1"],
    tagSha: "a".repeat(40),
    onMain: true,
    packageVersion: "0.9.0",
    hasDistribute: true,
    release: { isDraft: false, assets: [...REQUIRED_ASSETS] },
    environment: ready,
  };
  const refused = (facts: Partial<PlanFacts>) => {
    const decision = decidePlan({ ...base, ...facts });
    return decision.ok ? "accepted" : decision.sentence;
  };

  test("the six assets are the build's five binaries and checksums.txt", () => {
    expect(REQUIRED_ASSETS).toEqual([...TARGETS.map((target) => target.file), "checksums.txt"]);
    expect(REQUIRED_ASSETS).toHaveLength(6);
  });

  test("a plain release that passes every check gives its version and its commit", () => {
    expect(decidePlan(base)).toEqual({
      ok: true,
      version: "0.9.0",
      sha: "a".repeat(40),
      prerelease: false,
    });
  });

  test("each refusal, with its sentence", () => {
    expect(refused({ ref: "refs/heads/feature" })).toBe(
      "distribute runs from main only; this run is on refs/heads/feature",
    );
    expect(refused({ tag: "v0.9" })).toBe(
      "v0.9 is not a version tag (v<major>.<minor>.<patch>, with an optional pre-release)",
    );
    expect(refused({ tag: "v0.9.0; rm -rf /" })).toContain("is not a version tag");
    expect(refused({ tagSha: null })).toBe("the tag v0.9.0 does not exist");
    expect(refused({ onMain: false })).toBe(
      "v0.9.0 is not on main; only a commit that reached main by a pull request is distributed",
    );
    expect(refused({ packageVersion: "0.8.0" })).toBe(
      "v0.9.0 does not match its commit's package.json (0.8.0)",
    );
    expect(refused({ packageVersion: null })).toBe(
      "v0.9.0 does not match its commit's package.json (unreadable)",
    );
    expect(refused({ hasDistribute: false })).toBe(
      "v0.9.0 was cut before the release distributed itself (its tree has no .github/workflows/distribute.yml)",
    );
    expect(refused({ tags: [...base.tags, "v0.9.1"] })).toBe(
      "v0.9.0 is not the highest release (v0.9.1 exists); an older release is never distributed",
    );
    expect(refused({ release: null })).toBe("the GitHub release v0.9.0 does not exist");
    expect(refused({ release: { isDraft: true, assets: [...REQUIRED_ASSETS] } })).toBe(
      "the GitHub release v0.9.0 is a draft",
    );
    expect(
      refused({
        release: {
          isDraft: false,
          assets: REQUIRED_ASSETS.filter(
            (name) => name !== "checksums.txt" && name !== "wizardingcode-mem-linux-x64",
          ),
        },
      }),
    ).toBe("the GitHub release v0.9.0 lacks: wizardingcode-mem-linux-x64, checksums.txt");
    expect(refused({ environment: { exists: false, policy: null, branches: [] } })).toBe(
      "the environment release does not exist; create it with its rule first (docs/runbooks/release.md)",
    );
  });

  test("the environment's rule must be exactly the branch main", () => {
    const unruled =
      "the environment release must allow the branch main only (docs/runbooks/release.md)";
    expect(refused({ environment: { ...ready, policy: null } })).toBe(unruled);
    expect(
      refused({
        environment: {
          ...ready,
          policy: { protected_branches: true, custom_branch_policies: false },
        },
      }),
    ).toBe(unruled);
    expect(
      refused({
        environment: { ...ready, branches: [...ready.branches, { name: "dev", type: "branch" }] },
      }),
    ).toBe(unruled);
    expect(refused({ environment: { ...ready, branches: [{ name: "main", type: "tag" }] } })).toBe(
      unruled,
    );
    expect(refused({ environment: { ...ready, branches: [] } })).toBe(unruled);
    expect(environmentState(ready)).toBe("ready");
    expect(environmentState({ exists: false, policy: null, branches: [] })).toBe("missing");
  });

  test("the first refusal that applies is the one given", () => {
    expect(refused({ ref: "refs/heads/x", tagSha: null, release: null })).toContain(
      "runs from main only",
    );
    expect(refused({ onMain: false, release: null })).toContain("is not on main");
  });

  test("a fix release stays distributable after a later pre-release tag exists", () => {
    expect(
      refused({
        tag: "v0.9.1",
        packageVersion: "0.9.1",
        tags: [...base.tags, "v0.9.1", "v0.10.0-rc.1"],
      }),
    ).toBe("accepted");
  });

  test("a pre-release must be the highest tag of all", () => {
    const pre = { tag: "v0.10.0-rc.1", packageVersion: "0.10.0-rc.1" };
    expect(decidePlan({ ...base, ...pre, tags: [...base.tags, "v0.10.0-rc.1"] })).toEqual({
      ok: true,
      version: "0.10.0-rc.1",
      sha: "a".repeat(40),
      prerelease: true,
    });
    expect(refused({ ...pre, tags: [...base.tags, "v0.10.0-rc.1", "v0.10.0-rc.2"] })).toBe(
      "v0.10.0-rc.1 is not the highest release (v0.10.0-rc.2 exists); an older release is never distributed",
    );
  });

  test("a tag that is not a version tag changes no decision", () => {
    expect(refused({ tags: [...base.tags, "vnext", "v99"] })).toBe("accepted");
  });
});

describe("the hold of latest", () => {
  const source = (contract: number, accepted: number[]) =>
    `/** The contract. */\nexport const CONTRACT = ${contract};\n\nexport const ACCEPTED_CONTRACTS: readonly number[] = [${accepted.join(", ")}];\n`;
  const input = { tag: "v0.10.0", previous: "v0.9.0", releaseHold: false };

  test("the parser reads the real file as the constants it exports", () => {
    expect(parseContract(read("src/team/contract.ts"))).toEqual({
      contract: CONTRACT,
      accepted: [...ACCEPTED_CONTRACTS],
    });
    expect(parseContract("export const CONTRACT = two;\n")).toBeNull();
    expect(parseContract(source(3, []))).toBeNull();
  });

  test("the previous plain release is the highest plain tag below", () => {
    expect(
      previousPlain("v0.10.0", ["v0.8.0", "v0.9.0", "v0.10.0-rc.1", "v0.10.0", "v0.11.0"]),
    ).toBe("v0.9.0");
    expect(previousPlain("v0.8.0", ["v0.8.0"])).toBeNull();
  });

  test("held when the tag's lowest accepted contract is above what the previous release speaks", () => {
    expect(
      decideHold({ ...input, atTag: source(5, [4, 5]), atPrevious: source(3, [2, 3]) }),
    ).toEqual({
      held: true,
      byHand: false,
      outcome: { kind: "held-contract", tag: "v0.10.0", accepts: 4, previous: "v0.9.0", speaks: 3 },
    });
  });

  test("not held when the previous release's contract is still accepted", () => {
    expect(
      decideHold({ ...input, atTag: source(4, [3, 4]), atPrevious: source(3, [2, 3]) }),
    ).toEqual({
      held: false,
      byHand: false,
      outcome: null,
    });
  });

  test("not held with no previous plain release, or when the file is missing at it", () => {
    const free = { held: false, byHand: false, outcome: null };
    expect(
      decideHold({ ...input, previous: null, atTag: source(4, [4]), atPrevious: "missing" }),
    ).toEqual(free);
    expect(decideHold({ ...input, atTag: source(4, [4]), atPrevious: "missing" })).toEqual(free);
  });

  test("held, naming the read, when a read fails: the rule fails closed", () => {
    expect(decideHold({ ...input, atTag: null, atPrevious: source(3, [2, 3]) }).outcome).toEqual({
      kind: "held-unreadable",
      read: "src/team/contract.ts at v0.10.0",
    });
    expect(
      decideHold({ ...input, atTag: "nothing to parse", atPrevious: source(3, [2, 3]) }).held,
    ).toBe(true);
    expect(
      decideHold({ ...input, atTag: source(4, [3, 4]), atPrevious: "unreadable" }).outcome,
    ).toEqual({
      kind: "held-unreadable",
      read: "src/team/contract.ts at v0.9.0",
    });
    expect(
      decideHold({ ...input, atTag: source(4, [3, 4]), atPrevious: "nothing to parse" }).held,
    ).toBe(true);
  });

  test("release_hold releases a hold, and only a hold", () => {
    expect(
      decideHold({
        ...input,
        releaseHold: true,
        atTag: source(5, [4, 5]),
        atPrevious: source(3, [2, 3]),
      }),
    ).toEqual({ held: false, byHand: true, outcome: null });
    expect(
      decideHold({
        ...input,
        releaseHold: true,
        atTag: source(4, [3, 4]),
        atPrevious: source(3, [2, 3]),
      }),
    ).toEqual({ held: false, byHand: false, outcome: null });
  });
});

describe("npm", () => {
  test("a package whose version is not the tag's is refused", () => {
    expect(
      checkPackageVersion({ name: "wizardingcode-mem", version: "0.9.0" }, "0.9.0"),
    ).toBeNull();
    expect(checkPackageVersion({ name: "wizardingcode-mem", version: "0.8.0" }, "0.9.0")).toBe(
      "wizardingcode-mem is at 0.8.0 in the tag's tree, not 0.9.0",
    );
  });

  test("npm view: an answer is published, nothing or E404 is absent, anything else an error", () => {
    expect(decideNpmView({ code: 0, stdout: "0.9.0\n", stderr: "" })).toBe("published");
    expect(decideNpmView({ code: 0, stdout: "\n", stderr: "" })).toBe("absent");
    expect(
      decideNpmView({
        code: 1,
        stdout: "",
        stderr: "npm error code E404\nnpm error 404 No match found",
      }),
    ).toBe("absent");
    expect(decideNpmView({ code: 1, stdout: "", stderr: "npm error code ETIMEDOUT" })).toEqual({
      error: "npm error code ETIMEDOUT",
    });
  });

  test("the publish command: never a lifecycle script, next for a pre-release, --dry-run on a dry run", () => {
    const base = ["publish", "--access", "public", "--ignore-scripts"];
    expect(publishArgs({ prerelease: false, dryRun: false })).toEqual(base);
    expect(publishArgs({ prerelease: true, dryRun: false })).toEqual([...base, "--tag", "next"]);
    expect(publishArgs({ prerelease: false, dryRun: true })).toEqual([...base, "--dry-run"]);
    expect(publishArgs({ prerelease: true, dryRun: true })).toEqual([
      ...base,
      "--tag",
      "next",
      "--dry-run",
    ]);
  });

  test("a publish refused because the version exists is a conflict, not a missing publisher", () => {
    expect(
      publishFailure(
        "npm error code E403\nnpm error 403 You cannot publish over the previously published versions: 0.9.0.",
      ),
    ).toBe("conflict");
    expect(publishFailure("npm error code EPUBLISHCONFLICT")).toBe("conflict");
  });

  test("an authentication failure gains the sentence about the trusted publisher", () => {
    const hint =
      "The trusted publisher for this package may not be registered for the workflow distribute.yml and the environment release (docs/runbooks/release.md).";
    for (const code of ["ENEEDAUTH", "E401", "E403", "E404"]) {
      expect(publishFailure(`npm error code ${code}`)).toEqual({
        message: `npm error code ${code}\n${hint}`,
      });
    }
    expect(publishFailure("npm error code ETIMEDOUT")).toEqual({
      message: "npm error code ETIMEDOUT",
    });
  });
});

describe("the marketplace token's state", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const base = {
    token: true,
    status: 200,
    error: null,
    push: true,
    expiration: null,
    now,
    repo: "o/r",
  };
  const decide = (input: Partial<Parameters<typeof decideToken>[0]>) =>
    decideToken({ ...base, ...input });

  test("each failure has its sentence", () => {
    expect(decide({ token: false })).toEqual({
      level: "error",
      message: "the secret MARKETPLACE_TOKEN is not set in the environment release",
    });
    expect(decide({ status: null, error: "getaddrinfo ENOTFOUND" }).message).toBe(
      "could not reach api.github.com for o/r: getaddrinfo ENOTFOUND",
    );
    expect(decide({ status: 401 }).message).toBe("MARKETPLACE_TOKEN is invalid or expired (o/r)");
    for (const status of [403, 404]) {
      expect(decide({ status })).toEqual({
        level: "error",
        message: "MARKETPLACE_TOKEN is not granted to o/r, or the organisation has not approved it",
      });
    }
    expect(decide({ status: 500 }).message).toBe("o/r answered 500");
    expect(decide({ push: false })).toEqual({
      level: "error",
      message: "MARKETPLACE_TOKEN cannot push to o/r",
    });
  });

  test("with no expiration header the expiry is unknown: a warning, and a pass", () => {
    const unknown = {
      level: "warning" as const,
      message:
        "MARKETPLACE_TOKEN: expiry unknown (no expiration header); check the date noted when it was created",
    };
    expect(decide({})).toEqual(unknown);
    expect(decide({ expiration: "soon" })).toEqual(unknown);
    // The push permission unreported is not a failure: only a false is.
    expect(decide({ push: null })).toEqual(unknown);
  });

  test("thirty days or more is fine; fewer is a warning that still passes", () => {
    expect(decide({ expiration: "2027-11-12 10:00:00 UTC" })).toEqual({
      level: "ok",
      message: "MARKETPLACE_TOKEN expires on 2027-11-12 (365 days)",
    });
    expect(decide({ expiration: "2026-12-12T10:00:00Z" }).level).toBe("ok");
    expect(decide({ expiration: "2026-12-11T10:00:00Z" })).toEqual({
      level: "warning",
      message: "renew it: MARKETPLACE_TOKEN expires on 2026-12-11 (29 days)",
    });
  });
});
