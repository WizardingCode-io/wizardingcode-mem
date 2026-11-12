import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hashOf } from "../../src/modules/knowledge/repo.ts";
import {
  checkEntryPayload,
  checkMemoryPayload,
  entryBytes,
  parseEntryUid,
} from "../../src/team/validate.ts";
import {
  ALIAS_A,
  entryPayload,
  memoryPayload,
  newUuid,
  rehashed,
  rehashedMemory,
} from "../helpers/team.ts";

const refused = (result: unknown) => result as { result: string; reason: string; rule?: string };

describe("parseEntryUid", () => {
  test("reads the three shapes and refuses the rest", () => {
    const uuid = newUuid();
    expect(parseEntryUid(`workspace:${uuid}`)).toEqual({
      scope: "workspace",
      remoteAlias: null,
      uuid,
    });
    expect(parseEntryUid(`shared:${uuid}`)).toEqual({ scope: "shared", remoteAlias: null, uuid });
    expect(parseEntryUid(`project:${ALIAS_A}:${uuid}`)).toEqual({
      scope: "project",
      remoteAlias: ALIAS_A,
      uuid,
    });
    expect(parseEntryUid(`shared:${uuid.toUpperCase()}`)).toBeNull();
    expect(parseEntryUid(`shared:${uuid.slice(1)}`)).toBeNull();
    expect(parseEntryUid(`project:remote:/Users/me/site:${uuid}`)).toBeNull();
    // A shared name is the other identity a team knows a project by (ADR 0028).
    expect(parseEntryUid(`project:name:x:${uuid}`)).toEqual({
      scope: "project",
      remoteAlias: "name:x",
      uuid,
    });
    expect(parseEntryUid(`project:name:Bad:${uuid}`)).toBeNull();
    expect(parseEntryUid(`project:path:/x:${uuid}`)).toBeNull();
    expect(parseEntryUid(`project:${uuid}`)).toBeNull();
    expect(parseEntryUid(`project::${uuid}`)).toBeNull();
    expect(parseEntryUid(`other:${uuid}`)).toBeNull();
    expect(parseEntryUid("")).toBeNull();
  });
});

describe("checkEntryPayload, in the spec's order", () => {
  const good = () => entryPayload({ scope: "shared", slug: "a-rule" });

  test("entryBytes is the UTF-8 of frontmatter and body and hashes as the rendered file", () => {
    const payload = good();
    const bytes = entryBytes(payload);
    expect(Buffer.from(bytes).toString("utf8")).toBe(payload.frontmatter + payload.body);
    expect(hashOf(bytes)).toBe(payload.hash);
  });

  test("a good payload returns the parsed entry, the hash and the uid's parts", () => {
    const payload = good();
    const checked = checkEntryPayload({ uid: payload.uid, payload });
    expect("entry" in checked).toBe(true);
    if (!("entry" in checked)) return;
    expect(checked.entry.id).toBe(payload.uid.slice(-36));
    expect(checked.entry.problem).toBeNull();
    expect(checked.hash).toBe(payload.hash);
    expect(checked.scope).toBe("shared");
    expect(checked.remoteAlias).toBeNull();
    expect(checked.uuid).toBe(payload.uid.slice(-36));
  });

  test("the shape: an extra or missing key, a wrong type, another uid, a bad uid, a disagreeing scope or alias", () => {
    const payload = good();
    const cases: [string, unknown][] = [
      ["extra key", { ...payload, extra: 1 }],
      ["missing key", (({ slug: _slug, ...rest }) => rest)(payload)],
      ["frontmatter a number", { ...payload, frontmatter: 1 }],
      ["version a string", { ...payload, version: "1" }],
      ["remoteAlias a number", { ...payload, remoteAlias: 7 }],
      ["kind wrong", { ...payload, kind: "memory" }],
      ["not an object", "text"],
      ["null", null],
      ["an array", [payload]],
      ["uid mismatch", { ...payload, uid: `shared:${newUuid()}` }],
      ["bad uuid", { ...payload, uid: "shared:not-a-uuid" }],
      ["scope disagrees", { ...payload, scope: "workspace" }],
      ["alias disagrees", { ...payload, remoteAlias: ALIAS_A }],
    ];
    for (const [name, candidate] of cases) {
      const uid = (candidate as { uid?: string } | null)?.uid ?? payload.uid;
      expect({ name, ...refused(checkEntryPayload({ uid, payload: candidate })) }).toEqual({
        name,
        result: "refused",
        reason: "shape",
      });
    }
    const project = entryPayload({ scope: "project", slug: "x", remoteAlias: ALIAS_A });
    expect(
      refused(checkEntryPayload({ uid: project.uid, payload: { ...project, remoteAlias: null } }))
        .reason,
    ).toBe("shape");
    const badAlias = {
      ...project,
      uid: `project:remote:/Users/me/site:${project.uid.slice(-36)}`,
      remoteAlias: "remote:/Users/me/site",
    };
    expect(refused(checkEntryPayload({ uid: badAlias.uid, payload: badAlias })).reason).toBe(
      "shape",
    );
  });

  test("the slug, the size, the hash", () => {
    const payload = good();
    expect(
      refused(checkEntryPayload({ uid: payload.uid, payload: { ...payload, slug: "../x" } }))
        .reason,
    ).toBe("slug");
    expect(
      refused(checkEntryPayload({ uid: payload.uid, payload: { ...payload, slug: "Upper" } }))
        .reason,
    ).toBe("slug");
    const big = rehashed({ ...payload, body: "x".repeat(257 * 1024) });
    expect(refused(checkEntryPayload({ uid: big.uid, payload: big })).reason).toBe("size");
    expect(
      refused(
        checkEntryPayload({ uid: payload.uid, payload: { ...payload, hash: "0".repeat(16) } }),
      ).reason,
    ).toBe("hash");
    // Two faults: the earlier reason answers.
    expect(
      refused(checkEntryPayload({ uid: big.uid, payload: { ...big, hash: "0".repeat(16) } }))
        .reason,
    ).toBe("size");
  });

  test("the entry: a problem, an id other than the uid's, an area that fails the id rule or the length", () => {
    const payload = good();
    const noTitle = rehashed({
      ...payload,
      frontmatter: payload.frontmatter.replace(/^title: .*\n/m, ""),
    });
    expect(refused(checkEntryPayload({ uid: noTitle.uid, payload: noTitle })).reason).toBe("shape");
    const otherId = entryPayload({ scope: "shared", slug: "a-rule", id: newUuid() });
    expect(refused(checkEntryPayload({ uid: otherId.uid, payload: otherId })).reason).toBe("shape");
    const badArea = entryPayload({ scope: "shared", slug: "a-rule", area: "Bad_Area" });
    expect(refused(checkEntryPayload({ uid: badArea.uid, payload: badArea })).reason).toBe("shape");
    const longArea = entryPayload({ scope: "shared", slug: "a-rule", area: "a".repeat(41) });
    expect(refused(checkEntryPayload({ uid: longArea.uid, payload: longArea })).reason).toBe(
      "shape",
    );
    const okArea = entryPayload({ scope: "shared", slug: "a-rule", area: "a".repeat(40) });
    expect("entry" in checkEntryPayload({ uid: okArea.uid, payload: okArea })).toBe(true);
  });

  test("a secret in the bytes is refused with its rule, after the hash check", () => {
    const secret = entryPayload({
      scope: "shared",
      slug: "a-rule",
      body: `key: sk-ant-api03-${"a".repeat(40)}`,
    });
    expect(refused(checkEntryPayload({ uid: secret.uid, payload: secret }))).toEqual({
      result: "refused",
      reason: "secret",
      rule: "anthropic-key",
    });
    expect(
      refused(checkEntryPayload({ uid: secret.uid, payload: { ...secret, hash: "0".repeat(16) } }))
        .reason,
    ).toBe("hash");
  });
});

describe("checkMemoryPayload, in the spec's order", () => {
  test("a good payload returns the hash and the size", () => {
    const payload = memoryPayload();
    const checked = checkMemoryPayload({ uid: payload.uid, payload });
    expect("size" in checked).toBe(true);
    if (!("size" in checked)) return;
    expect(checked.hash).toBe(payload.hash);
    expect(checked.size).toBe(Buffer.byteLength(JSON.stringify(payload)));
  });

  test("the shape: keys, types, the uid, the kind word, the alias", () => {
    const payload = memoryPayload();
    const cases: [string, unknown][] = [
      ["extra key", { ...payload, extra: 1 }],
      ["importance a string", { ...payload, importance: "3" }],
      ["updatedAt not finite", { ...payload, updatedAt: Number.NaN }],
      ["bad memoryKind", rehashedMemory({ ...payload, memoryKind: "Bad Kind" })],
      ["bad status", rehashedMemory({ ...payload, status: "9" })],
      ["kind wrong", { ...payload, kind: "entry" }],
      ["uid mismatch", { ...payload, uid: "other:1" }],
      ["uid outside the grammar", { ...memoryPayload({ uid: "a1b2c3d4:x" }) }],
      ["uid with an @", { ...memoryPayload({ uid: "a1b2c3d4:1@2" }) }],
      ["generation not hex", { ...memoryPayload({ uid: "g1b2c3d4:1" }) }],
      ["path alias", { ...payload, remoteAlias: "remote:/Users/me/site" }],
      ["not an object", 7],
    ];
    for (const [name, candidate] of cases) {
      const uid = (candidate as { uid?: string } | null)?.uid ?? payload.uid;
      expect({
        name,
        ...refused(checkMemoryPayload({ uid, payload: candidate })),
      }).toEqual({
        name,
        result: "refused",
        reason: "shape",
      });
    }
    const rowId = memoryPayload({ uid: "0123abcd:987654321" });
    expect("size" in checkMemoryPayload({ uid: rowId.uid, payload: rowId })).toBe(true);
    // A memory under a shared name passes the pure check; the registry is the push's to ask.
    const named = memoryPayload({ remoteAlias: "name:x" });
    expect("size" in checkMemoryPayload({ uid: named.uid, payload: named })).toBe(true);
    const badName = memoryPayload({ remoteAlias: "name:Bad" });
    expect(refused(checkMemoryPayload({ uid: badName.uid, payload: badName })).reason).toBe(
      "shape",
    );
  });

  test("validate.ts stays pure: no statement runs against a database", () => {
    const source = readFileSync(new URL("../../src/team/validate.ts", import.meta.url), "utf8");
    expect(source.includes(".query(")).toBe(false);
    expect(source.includes(".run(")).toBe(false);
  });

  test("the size, the hash, the secret", () => {
    const payload = memoryPayload();
    const big = rehashedMemory({ ...payload, body: "x".repeat(257 * 1024) });
    expect(refused(checkMemoryPayload({ uid: big.uid, payload: big })).reason).toBe("size");
    expect(
      refused(
        checkMemoryPayload({ uid: payload.uid, payload: { ...payload, hash: "0".repeat(16) } }),
      ).reason,
    ).toBe("hash");
    const secret = memoryPayload({ body: `token ghp_${"A".repeat(36)}` });
    expect(refused(checkMemoryPayload({ uid: secret.uid, payload: secret }))).toEqual({
      result: "refused",
      reason: "secret",
      rule: "github-token",
    });
    const secretTitle = memoryPayload({ title: `AKIA${"A".repeat(16)}` });
    expect(refused(checkMemoryPayload({ uid: secretTitle.uid, payload: secretTitle })).rule).toBe(
      "aws-access-key",
    );
  });
});
