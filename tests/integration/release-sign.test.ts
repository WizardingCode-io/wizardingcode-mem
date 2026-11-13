import { describe, expect, test } from "bun:test";
import { IMAGE, summaryLine, verifyArgs, verifyCommand } from "../../scripts/release/lib.ts";
import { signImage } from "../../scripts/release/sign.ts";
import { type Answer, scripted } from "../helpers/scripted-runner.ts";

// The job that signs, with docker's and cosign's answers scripted: no program starts, nothing
// is signed. A real signature needs the workflow's own OIDC token on main (ADR 0032).

const D = `sha256:${"1".repeat(64)}`;
const OTHER = `sha256:${"2".repeat(64)}`;
const INSPECT = (tag: string) =>
  `docker buildx imagetools inspect ${IMAGE}:${tag} --format {{json .Manifest.Digest}}`;
const VERIFY = ["cosign", ...verifyArgs(`${IMAGE}@${D}`)].join(" ");
const SIGN = `cosign sign --yes ${IMAGE}@${D}`;
const RETAG = `docker buildx imagetools create -t ${IMAGE}:latest ${IMAGE}@${D}`;

const names = (tag: string, digest: string): Scripted => [
  new RegExp(`imagetools inspect \\S+:${tag.replaceAll(".", "\\.")} `),
  { stdout: `${JSON.stringify(digest)}\n` },
];
type Scripted = Parameters<typeof scripted>[0][number];
/** cosign verify answering each code in turn, then the last one again. */
function verifies(...codes: number[]): Scripted {
  let call = 0;
  return [/^cosign verify /, () => ({ code: codes[Math.min(call++, codes.length - 1)] ?? 1 })];
}
const world = (...answers: Scripted[]) => scripted(answers);
const ok: Answer = {};
const sign = (run: ReturnType<typeof scripted>["run"], more: object = {}) =>
  signImage({ run, version: "0.9.0", built: D, dryRun: false, ...more });

describe("the job that signs the image and moves latest", () => {
  test("sign: the digest is signed, verified, latest moved by digest and read back", () => {
    const gh = world(
      names("0.9.0", D),
      names("latest", D),
      verifies(1, 0),
      [/^cosign sign /, ok],
      [/imagetools create /, ok],
    );
    expect(sign(gh.run)).toEqual({ kind: "signed", digest: D });
    expect(gh.calls).toEqual([INSPECT("0.9.0"), VERIFY, SIGN, VERIFY, RETAG, INSPECT("latest")]);
    // The version tag is read once and never written, signed or retagged by name.
    const named = gh.calls.filter((call) => call.split(" ").includes(`${IMAGE}:0.9.0`));
    expect(named).toEqual([INSPECT("0.9.0")]);
  });

  test("already signed: nothing is signed, latest is moved", () => {
    const gh = world(names("0.9.0", D), names("latest", D), verifies(0), [
      /imagetools create /,
      ok,
    ]);
    expect(sign(gh.run)).toEqual({ kind: "already-signed", digest: D });
    expect(gh.calls).toEqual([INSPECT("0.9.0"), VERIFY, RETAG, INSPECT("latest")]);
  });

  test("no digest, an unreadable registry and a moved tag sign nothing and move nothing", () => {
    const untouched = (calls: string[]) => {
      expect(calls.some((call) => call.startsWith("cosign sign"))).toBe(false);
      expect(calls.some((call) => call.includes("imagetools create"))).toBe(false);
    };
    const none = world();
    expect(sign(none.run, { built: "" })).toEqual({ kind: "no-digest" });
    expect(none.calls).toEqual([]);

    const down = world([
      /imagetools inspect /,
      { code: 1, stderr: "ERROR: one\nERROR: unauthorized\u0007\n" },
    ]);
    expect(sign(down.run)).toEqual({
      kind: "unreadable",
      version: "0.9.0",
      said: "ERROR: unauthorized?",
    });
    untouched(down.calls);
    expect(down.calls).toEqual([INSPECT("0.9.0")]);

    for (const stdout of ["", "null\n", '"latest"\n', "<html>", `${D}\n`]) {
      const odd = world([/imagetools inspect /, { stdout }]);
      expect(sign(odd.run)).toEqual({
        kind: "unreadable",
        version: "0.9.0",
        said: "an answer that is not a digest",
      });
      untouched(odd.calls);
    }

    const moved = world(names("0.9.0", OTHER), verifies(0));
    expect(sign(moved.run)).toEqual({ kind: "tag-moved", version: "0.9.0", built: D });
    // Not even a verification: the image the tag names now is not the one the release built.
    expect(moved.calls).toEqual([INSPECT("0.9.0")]);
  });

  test("a dry run signs nothing and moves nothing", () => {
    for (const code of [0, 1]) {
      const gh = world(names("0.9.0", D), verifies(code));
      expect(sign(gh.run, { dryRun: true })).toEqual({ kind: "would-sign", digest: D });
      expect(gh.calls).toEqual([INSPECT("0.9.0"), VERIFY]);
    }
  });

  test("a signature that does not verify does not move latest", () => {
    const gh = world(
      names("0.9.0", D),
      [/^cosign sign /, ok],
      [/^cosign verify /, { code: 1, stderr: "Error: no matching signatures\nmain.go: exit\n" }],
    );
    expect(sign(gh.run)).toEqual({ kind: "unverified", digest: D, said: "main.go: exit" });
    expect(gh.calls).toEqual([INSPECT("0.9.0"), VERIFY, SIGN, VERIFY]);
  });

  test("a signing that fails, a retag that fails, and a latest that names another digest are failures", () => {
    const unsigned = world(names("0.9.0", D), verifies(1), [
      /^cosign sign /,
      { code: 1, stderr: "Error: getting token\u001b[0m\n" },
    ]);
    expect(sign(unsigned.run)).toEqual({
      kind: "failed",
      sentence: "the image's signing did not succeed: Error: getting token?[0m",
    });
    expect(unsigned.calls.some((call) => call.includes("imagetools create"))).toBe(false);

    const stuck = world(names("0.9.0", D), verifies(0), [/imagetools create /, { code: 1 }]);
    expect(sign(stuck.run)).toEqual({
      kind: "failed",
      sentence: "the image's retag did not succeed",
    });

    const elsewhere = world(names("0.9.0", D), names("latest", OTHER), verifies(0), [
      /imagetools create /,
      ok,
    ]);
    expect(sign(elsewhere.run)).toEqual({
      kind: "failed",
      sentence: `latest names ${OTHER} after the retag, not ${D}`,
    });
    const blind = world(
      names("0.9.0", D),
      [/imagetools inspect \S+:latest /, { code: 1, stderr: "ERROR: timeout" }],
      verifies(0),
      [/imagetools create /, ok],
    );
    expect(sign(blind.run)).toEqual({
      kind: "failed",
      sentence: `latest names nothing readable after the retag, not ${D}`,
    });
  });

  test("each outcome's line", () => {
    for (const kind of ["signed", "already-signed", "would-sign"] as const) {
      const line = summaryLine("latest", { kind, digest: D });
      expect(line).toStartWith("latest: ");
      expect(line).toContain(D);
      expect(line).toContain(verifyCommand(`${IMAGE}@${D}`));
    }
  });
});
