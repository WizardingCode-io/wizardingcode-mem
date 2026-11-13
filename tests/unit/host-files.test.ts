// How the host's tool replaces a file (ADR 0033): a temporary file beside it, synced, renamed,
// the directory synced; and how it reads and rewrites the one line of .env it owns.
import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  isLink,
  modeOf,
  readEnvLine,
  realWriter,
  replaceFile,
  withEnvLine,
} from "../../src/host/files.ts";

const DIGEST = `sha256:${"d".repeat(64)}`;
const folder = () => mkdtempSync(join(tmpdir(), "wcm-host-files-"));

describe("replaceFile", () => {
  test("writes a temporary file in the same directory, syncs it, renames it, syncs the directory", () => {
    const dir = folder();
    const target = join(dir, "state.json");
    const steps: string[] = [];
    let temporary = "";
    replaceFile(
      {
        write: (path, text, mode) => {
          temporary = path;
          steps.push(`write ${text} ${mode.toString(8)}`);
        },
        sync: (path) => steps.push(`sync ${path === temporary}`),
        rename: (from, to) => steps.push(`rename ${from === temporary} ${to === target}`),
        syncDir: (path) => steps.push(`syncDir ${path === dir}`),
      },
      target,
      "{}",
      0o600,
    );
    expect(steps).toEqual(["write {} 600", "sync true", "rename true true", "syncDir true"]);
    expect(dirname(temporary)).toBe(dir);
    expect(temporary).not.toBe(target);
  });

  test("with the real writer the file has the text and the mode, and no temporary file is left", () => {
    const dir = folder();
    const target = join(dir, ".env");
    writeFileSync(target, "old\n", { mode: 0o640 });
    replaceFile(realWriter, target, "new\n", modeOf(target));
    expect(readFileSync(target, "utf8")).toBe("new\n");
    expect(statSync(target).mode & 0o777).toBe(0o640);
    replaceFile(realWriter, join(dir, "state.json"), "{}", 0o600);
    expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).sort()).toEqual([".env", "state.json"]);
  });

  test("a symbolic link is seen as one", () => {
    const dir = folder();
    writeFileSync(join(dir, "real"), "x");
    symlinkSync(join(dir, "real"), join(dir, "link"));
    expect(isLink(join(dir, "link"))).toBe(true);
    expect(isLink(join(dir, "real"))).toBe(false);
    expect(isLink(join(dir, "absent"))).toBe(false);
  });
});

describe("the one line of .env", () => {
  test("a version, or a version with a digest, quoted or not, with either line ending", () => {
    expect(readEnvLine("SERVER_DOMAIN=a.example\nWIZARDINGCODE_MEM_VERSION=0.9.1\n")).toEqual({
      value: "0.9.1",
      version: "0.9.1",
      digest: null,
    });
    expect(readEnvLine(`WIZARDINGCODE_MEM_VERSION="0.9.2@${DIGEST}"\r\n`)).toEqual({
      value: `0.9.2@${DIGEST}`,
      version: "0.9.2",
      digest: DIGEST,
    });
    expect(readEnvLine("WIZARDINGCODE_MEM_VERSION='0.10.0'")).toMatchObject({ version: "0.10.0" });
  });

  test("anything else is refused", () => {
    for (const text of [
      "",
      "SERVER_DOMAIN=a.example\n",
      "WIZARDINGCODE_MEM_VERSION=latest\n",
      "WIZARDINGCODE_MEM_VERSION=0.9\n",
      "WIZARDINGCODE_MEM_VERSION=0.9.1-rc.1\n",
      "WIZARDINGCODE_MEM_VERSION=0.9.1@sha256:abc\n",
      "WIZARDINGCODE_MEM_VERSION=0.9.1; rm -rf /\n",
      "WIZARDINGCODE_MEM_VERSION=0.9.1\nWIZARDINGCODE_MEM_VERSION=0.9.2\n",
      "# WIZARDINGCODE_MEM_VERSION=0.9.1\n",
    ])
      expect({ text, got: readEnvLine(text) }).toEqual({ text, got: null });
  });

  test("the line is rewritten and every other byte is kept", () => {
    const before =
      '# the team server\r\nSERVER_DOMAIN=a.example\r\nWIZARDINGCODE_MEM_VERSION="0.9.1"\r\nOTHER=1';
    expect(withEnvLine(before, `0.9.2@${DIGEST}`)).toBe(
      `# the team server\r\nSERVER_DOMAIN=a.example\r\nWIZARDINGCODE_MEM_VERSION=0.9.2@${DIGEST}\r\nOTHER=1`,
    );
    const plain = "WIZARDINGCODE_MEM_VERSION=0.9.1\nSERVER_DOMAIN=a.example\n";
    expect(withEnvLine(plain, "0.9.2")).toBe(
      "WIZARDINGCODE_MEM_VERSION=0.9.2\nSERVER_DOMAIN=a.example\n",
    );
    expect(withEnvLine(withEnvLine(plain, "0.9.2"), "0.9.1")).toBe(plain);
  });
});
