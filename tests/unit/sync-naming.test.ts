// The received tree's names (ADR 0027): the client's member folder by id alone, the project
// folder and the file name from the contract, and every component the server supplies checked.
import { describe, expect, test } from "bun:test";
import {
  checkComponent,
  memberFolder,
  receivedFolder,
  receivedRelativePath,
} from "../../src/sync/naming.ts";
import { fileNameFor, repoFolder } from "../../src/team/contract.ts";

const SERVER = "f39bae1956c669f9";
const UUID = "11111111-2222-4333-8444-555555555555";
const ALIAS = "remote:github.com/acme/site";

describe("the received tree's names", () => {
  test("a member's folder is by id alone, so a renamed or erased member moves no folder", () => {
    expect(memberFolder("r27ju6vmw3ly")).toBe("members/r27ju6vmw3ly");
    expect(() => memberFolder("../x")).toThrow(/member id/);
    expect(() => memberFolder("R27JU6VMW3LY")).toThrow(/member id/);
  });

  test("the project folder and the file name are the contract's", () => {
    expect(receivedFolder("project", ALIAS, null)).toBe(repoFolder("project", ALIAS, null));
    expect(receivedFolder("shared", null, null)).toBe("shared");
    expect(receivedFolder("workspace", null, { id: "r27ju6vmw3ly", name: "Ana" })).toBe(
      "members/r27ju6vmw3ly",
    );
    expect(receivedFolder("project", ALIAS, null)).toMatch(/^projects\/[a-z0-9-]+-[0-9a-f]{8}$/);
    expect(fileNameFor(UUID, "discovery-call")).toBe("entries/discovery-call--11111111.md");
    expect(receivedRelativePath(SERVER, "shared", null, null, UUID, "discovery-call")).toBe(
      `${SERVER}/shared/entries/discovery-call--11111111.md`,
    );
  });

  test("a bad component is refused before it is used: the server id, the member id, the slug, the alias folder", () => {
    expect(checkComponent("server", SERVER)).toBe(SERVER);
    expect(() => checkComponent("server", "../etc")).toThrow(/server id/);
    expect(() => checkComponent("server", "F39BAE1956C669F9")).toThrow(/server id/);
    expect(() => checkComponent("server", "")).toThrow(/server id/);
    expect(() => checkComponent("member", "a/b")).toThrow(/member id/);
    expect(checkComponent("slug", "discovery-call")).toBe("discovery-call");
    expect(() => checkComponent("slug", "Discovery Call")).toThrow(/slug/);
    expect(() => checkComponent("slug", "..")).toThrow(/slug/);
    expect(() => checkComponent("slug", "con")).toThrow(/slug/);
    expect(checkComponent("project-folder", "acme-site-1a2b3c4d")).toBe("acme-site-1a2b3c4d");
    expect(() => checkComponent("project-folder", "acme-site")).toThrow(/project folder/);
    expect(() => checkComponent("project-folder", "../x-1a2b3c4d")).toThrow(/project folder/);
    expect(() => receivedRelativePath("bad id", "shared", null, null, UUID, "x")).toThrow(
      /server id/,
    );
    expect(() => receivedRelativePath(SERVER, "project", "remote:", null, UUID, "x")).toThrow(
      /alias/,
    );
    expect(() =>
      receivedRelativePath(SERVER, "workspace", null, { id: "..", name: "x" }, UUID, "x"),
    ).toThrow(/member id/);
    expect(() => receivedRelativePath(SERVER, "shared", null, null, "not-a-uuid", "x")).toThrow(
      /uuid/,
    );
  });
});
