import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtDigest } from "../../scripts/release/lib.ts";
import { readBuild, readEnvironment } from "../../scripts/release/read.ts";
import { type Answer, scripted } from "../helpers/scripted-runner.ts";

// What plan reads from GitHub, with gh's answers scripted: no program starts.

const SHA = "a".repeat(40);
const D = `sha256:${"1".repeat(64)}`;
const URL7 = "https://github.com/o/r/actions/runs/7";
const row = (id: number, more: Record<string, string> = {}) => ({
  databaseId: id,
  headSha: SHA,
  headBranch: "v0.9.0",
  createdAt: `2026-11-13T10:00:0${id}Z`,
  url: `https://github.com/o/r/actions/runs/${id}`,
  ...more,
});
const list = (rows: unknown): [RegExp, Answer] => [
  /^gh run list /,
  { stdout: JSON.stringify(rows) },
];
const view = (id: number, conclusion: string): [RegExp, Answer] => [
  new RegExp(`^gh run view ${id} `),
  {
    stdout: JSON.stringify({
      jobs: [
        { name: "build", conclusion: "success" },
        { name: "docker", conclusion },
      ],
    }),
  },
];
const download = (id: number, text: string): [RegExp, Answer] => [
  new RegExp(`^gh run download ${id} `),
  { write: { file: "image-digest.txt", text } },
];

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-read-")));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the release's build, as plan reads it", () => {
  test("one passing run with its artifact gives that digest", () => {
    const gh = scripted([list([row(7)]), view(7, "success"), download(7, `${D}\n`)]);
    const read = readBuild(gh.run, "o/r", "v0.9.0", SHA, dir);
    expect(Array.isArray(read)).toBe(true);
    if (!Array.isArray(read)) return;
    expect(builtDigest(read)).toEqual({ digest: D, run: URL7 });
    expect(gh.calls[0]).toBe(
      "gh run list --repo o/r --workflow release.yml --event push --branch v0.9.0 --json databaseId,headSha,headBranch,createdAt,url --limit 50",
    );
    expect(gh.calls[1]).toBe("gh run view 7 --repo o/r --json jobs");
    expect(gh.calls[2]).toBe(`gh run download 7 --repo o/r -n image-digest -D ${join(dir, "7")}`);
    expect(gh.calls).toHaveLength(3);
  });

  test("a run of another commit or another branch is not read", () => {
    const gh = scripted([
      list([row(7), row(8, { headSha: "c".repeat(40) }), row(9, { headBranch: "v0.9.0-rc.1" })]),
      view(7, "success"),
      download(7, `${D}\n`),
    ]);
    const read = readBuild(gh.run, "o/r", "v0.9.0", SHA, dir);
    expect(Array.isArray(read)).toBe(true);
    if (!Array.isArray(read)) return;
    expect(read.map((run) => run.url)).toEqual([URL7]);
    expect(gh.calls.filter((call) => call.startsWith("gh run view"))).toEqual([
      "gh run view 7 --repo o/r --json jobs",
    ]);
  });

  test("of two runs that built, only the newest one's artifact is downloaded", () => {
    const gh = scripted([
      list([row(7), row(8)]),
      view(7, "success"),
      view(8, "success"),
      download(8, `${D}\n`),
    ]);
    const read = readBuild(gh.run, "o/r", "v0.9.0", SHA, dir);
    expect(Array.isArray(read)).toBe(true);
    if (!Array.isArray(read)) return;
    expect(builtDigest(read)).toEqual({ digest: D, run: "https://github.com/o/r/actions/runs/8" });
    expect(gh.calls.filter((call) => call.startsWith("gh run download"))).toHaveLength(1);
  });

  test("a docker job that failed, a view that fails, and a run with no artifact give none", () => {
    const failed = scripted([list([row(7)]), view(7, "failure")]);
    const first = readBuild(failed.run, "o/r", "v0.9.0", SHA, dir);
    expect(first).toEqual([
      { url: URL7, createdAt: "2026-11-13T10:00:07Z", docker: "failure", artifact: null },
    ]);
    expect(Array.isArray(first) && builtDigest(first)).toEqual({
      digest: null,
      reason: "no run of release.yml built the image",
    });
    expect(failed.calls.some((call) => call.startsWith("gh run download"))).toBe(false);

    for (const answer of [
      { code: 1, stderr: "HTTP 502" },
      { stdout: "<html>" },
      { stdout: '{"jobs":[{"name":"build","conclusion":"success"}]}' },
    ]) {
      const unseen = scripted([list([row(7)]), [/^gh run view 7 /, answer]]);
      const second = readBuild(unseen.run, "o/r", "v0.9.0", SHA, dir);
      expect(Array.isArray(second) && second[0]?.docker).toBeNull();
      expect(unseen.calls.some((call) => call.startsWith("gh run download"))).toBe(false);
    }

    const bare = scripted([
      list([row(7)]),
      view(7, "success"),
      [/^gh run download 7 /, { code: 1, stderr: "no artifact" }],
    ]);
    const third = readBuild(bare.run, "o/r", "v0.9.0", SHA, dir);
    expect(Array.isArray(third) && builtDigest(third)).toEqual({
      digest: null,
      reason: `the release run ${URL7} recorded no image digest`,
    });
    // A download that says it worked and left no file is no artifact either.
    const empty = scripted([list([row(7)]), view(7, "success"), [/^gh run download 7 /, {}]]);
    const fourth = readBuild(empty.run, "o/r", "v0.9.0", SHA, dir);
    expect(Array.isArray(fourth) && fourth[0]?.artifact).toBeNull();
  });

  test("a list that fails or is not a list is unreadable, with its reason", () => {
    const down = scripted([
      [/^gh run list /, { code: 1, stderr: "warning\nHTTP 502\u001b[0m\n\n" }],
    ]);
    expect(readBuild(down.run, "o/r", "v0.9.0", SHA, dir)).toEqual({
      unreadable: "the runs of release.yml could not be listed: HTTP 502?[0m",
    });
    for (const stdout of ["{}", "<html>", ""]) {
      const odd = scripted([[/^gh run list /, { stdout }]]);
      expect(readBuild(odd.run, "o/r", "v0.9.0", SHA, dir)).toEqual({
        unreadable: "the runs of release.yml could not be listed: an answer that is not a list",
      });
    }
    expect(readBuild(scripted([list([])]).run, "o/r", "v0.9.0", SHA, dir)).toEqual([]);
  });
});

describe("an environment, as plan reads it", () => {
  const policy = {
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  };
  const branches: [RegExp, Answer] = [
    /deployment-branch-policies$/,
    { stdout: JSON.stringify({ branch_policies: [{ id: 1, name: "main", type: "branch" }] }) },
  ];
  const environment = (more: object): [RegExp, Answer] => [
    /^gh api repos\/o\/r\/environments\/release-sign$/,
    { stdout: JSON.stringify({ ...policy, ...more }) },
  ];

  test("the environment's reviewer and the administrators' bypass are read", () => {
    const reviewed = scripted([
      branches,
      environment({
        can_admins_bypass: false,
        protection_rules: [
          { id: 1, type: "wait_timer", wait_timer: 5 },
          {
            id: 2,
            type: "required_reviewers",
            reviewers: [{ type: "User", reviewer: { login: "someone" } }],
          },
        ],
      }),
    ]);
    expect(readEnvironment(reviewed.run, "o/r", "release-sign")).toEqual({
      exists: true,
      policy: policy.deployment_branch_policy,
      branches: [{ name: "main", type: "branch" }],
      reviewers: 1,
      adminsBypass: false,
    });
    const none = scripted([
      branches,
      environment({ can_admins_bypass: false, protection_rules: [] }),
    ]);
    expect(readEnvironment(none.run, "o/r", "release-sign").reviewers).toBe(0);
    const unnamed = scripted([
      branches,
      environment({ protection_rules: [{ id: 2, type: "required_reviewers", reviewers: [] }] }),
    ]);
    expect(readEnvironment(unnamed.run, "o/r", "release-sign").reviewers).toBe(0);
    const bypass = scripted([branches, environment({ can_admins_bypass: true })]);
    expect(readEnvironment(bypass.run, "o/r", "release-sign")).toMatchObject({
      reviewers: 0,
      adminsBypass: true,
    });
    const missing = scripted([
      [/environments\/release-sign$/, { code: 1, stderr: "gh: Not Found (HTTP 404)" }],
    ]);
    expect(readEnvironment(missing.run, "o/r", "release-sign")).toEqual({
      exists: false,
      policy: null,
      branches: [],
      reviewers: 0,
      adminsBypass: false,
    });
    const refused = scripted([
      [/environments\/release-sign$/, { code: 1, stderr: "gh: Forbidden (HTTP 403)\n" }],
    ]);
    expect(() => readEnvironment(refused.run, "o/r", "release-sign")).toThrow(
      "could not read the environment release-sign: gh: Forbidden (HTTP 403)",
    );
  });
});
