// The contract a sync is built against (ADR 0025): what the predicate reads, what leaves
// with an item, how a memory is hashed, the reasons, redaction at the edge, and the keys
// and uids. A field added to one of the six shapes fails here until the lists, and the
// ADR with them, change too.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { redactForSend } from "../../src/sharing/edge.ts";
import { memoryHash } from "../../src/sharing/hash.ts";
import { levelKey } from "../../src/sharing/levels.ts";
import {
  DECISION_KEYS,
  type Decision,
  ENTRY_ITEM_KEYS,
  type EntryItem,
  entryUid,
  LEDGER_RECORD_KEYS,
  type LedgerRecord,
  MEMORY_HASH_FIELDS,
  MEMORY_ITEM_KEYS,
  type MemoryItem,
  memoryUid,
  OUTGOING_ENTRY_KEYS,
  OUTGOING_MEMORY_KEYS,
  type OutgoingEntry,
  type OutgoingMemory,
  REASON_TEXT,
  REASONS,
} from "../../src/sharing/types.ts";

const keysOf = (sample: object) => Object.keys(sample).sort();

describe("what the predicate reads", () => {
  test("an entry is these nine fields and nothing else", () => {
    const sample: EntryItem = {
      kind: "entry",
      uid: "workspace:u",
      scope: "workspace",
      projectId: 0,
      area: "sales",
      status: "active",
      problem: null,
      version: 1,
      hash: "h",
    };
    expect(keysOf(sample)).toEqual([...ENTRY_ITEM_KEYS]);
    expect(ENTRY_ITEM_KEYS).toEqual([
      "area",
      "hash",
      "kind",
      "problem",
      "projectId",
      "scope",
      "status",
      "uid",
      "version",
    ]);
  });

  test("a memory is these ten fields and nothing else", () => {
    const sample: MemoryItem = {
      kind: "memory",
      uid: "ab12cd34:7",
      projectId: 1,
      status: "active",
      stale: false,
      scope: "project",
      origin: "distilled",
      isUserRule: false,
      version: 1,
      hash: null,
    };
    expect(keysOf(sample)).toEqual([...MEMORY_ITEM_KEYS]);
    expect(MEMORY_ITEM_KEYS).toEqual([
      "hash",
      "isUserRule",
      "kind",
      "origin",
      "projectId",
      "scope",
      "stale",
      "status",
      "uid",
      "version",
    ]);
  });
});

describe("what leaves with an item", () => {
  test("an entry leaves as these nine fields and nothing else", () => {
    const sample: OutgoingEntry = {
      kind: "entry",
      uid: "project:remote:github.com/x/y:u",
      scope: "project",
      slug: "pricing-rules",
      remoteAlias: "remote:github.com/x/y",
      frontmatter: "title: Pricing rules",
      body: "The rules.",
      version: 3,
      hash: "h",
    };
    expect(keysOf(sample)).toEqual([...OUTGOING_ENTRY_KEYS]);
    expect(OUTGOING_ENTRY_KEYS).toEqual([
      "body",
      "frontmatter",
      "hash",
      "kind",
      "remoteAlias",
      "scope",
      "slug",
      "uid",
      "version",
    ]);
  });

  test("a memory leaves as these twelve fields and nothing else", () => {
    const sample: OutgoingMemory = {
      kind: "memory",
      uid: "ab12cd34:7",
      remoteAlias: "remote:github.com/x/y",
      title: "A title",
      body: "A body.",
      memoryKind: "decision",
      importance: 3,
      status: "active",
      createdAt: 1,
      updatedAt: 2,
      version: 2,
      hash: "h",
    };
    expect(keysOf(sample)).toEqual([...OUTGOING_MEMORY_KEYS]);
    expect(OUTGOING_MEMORY_KEYS).toEqual([
      "body",
      "createdAt",
      "hash",
      "importance",
      "kind",
      "memoryKind",
      "remoteAlias",
      "status",
      "title",
      "uid",
      "updatedAt",
      "version",
    ]);
  });
});

describe("what the ledger records and what the predicate answers", () => {
  test("a ledger record is these five fields and nothing else", () => {
    const sample: LedgerRecord = {
      destination: "team",
      direction: "sent",
      version: 1,
      hash: "h",
      withdrawnAt: null,
      localHash: "l",
      instance: "i",
      reason: "allowed",
    };
    expect(keysOf(sample)).toEqual([...LEDGER_RECORD_KEYS]);
    expect(LEDGER_RECORD_KEYS).toEqual([
      "destination",
      "direction",
      "hash",
      "instance",
      "localHash",
      "reason",
      "version",
      "withdrawnAt",
    ]);
  });

  test("a decision is these three fields and nothing else", () => {
    const sample: Decision = { answer: "keep", reason: "level-local", epoch: 0 };
    expect(keysOf(sample)).toEqual([...DECISION_KEYS]);
    expect(DECISION_KEYS).toEqual(["answer", "epoch", "reason"]);
  });
});

describe("a memory's hash", () => {
  const fields = {
    memoryKind: "decision",
    importance: 3,
    status: "active",
    title: "A title",
    body: "A body.",
  };

  test("covers the kind, the importance, the status, the title and the body, in that order", () => {
    expect(MEMORY_HASH_FIELDS).toEqual(["memoryKind", "importance", "status", "title", "body"]);
  });

  test("is the first sixteen hex characters of the SHA-256 of the five values, one per line", () => {
    const expected = createHash("sha256")
      .update("decision\n3\nactive\nA title\nA body.")
      .digest("hex")
      .slice(0, 16);
    expect(memoryHash(fields)).toBe(expected);
    expect(memoryHash(fields)).toMatch(/^[0-9a-f]{16}$/);
    expect(memoryHash({ ...fields })).toBe(memoryHash(fields));
  });

  test("changes with each field it covers", () => {
    expect(memoryHash({ ...fields, importance: 4 })).not.toBe(memoryHash(fields));
    expect(memoryHash({ ...fields, memoryKind: "pattern" })).not.toBe(memoryHash(fields));
    expect(memoryHash({ ...fields, status: "archived" })).not.toBe(memoryHash(fields));
    expect(memoryHash({ ...fields, title: "Another title" })).not.toBe(memoryHash(fields));
    expect(memoryHash({ ...fields, body: "Another body." })).not.toBe(memoryHash(fields));
  });

  test("covers nothing else: a use count or a date beside the fields changes nothing", () => {
    const more = { ...fields, uses: 9, updatedAt: 5 };
    expect(memoryHash(more)).toBe(memoryHash(fields));
  });
});

describe("the reasons", () => {
  test("every reason has its sentence, and no sentence is without a reason", () => {
    expect<string[]>([...REASONS].sort()).toEqual(Object.keys(REASON_TEXT).sort());
    expect(new Set(REASONS).size).toBe(REASONS.length);
  });

  test("every sentence ends with a full stop", () => {
    for (const reason of REASONS) {
      expect(REASON_TEXT[reason].endsWith(".")).toBe(true);
    }
  });

  test("names the receive level's reason (ADR 0027): bound to a server, sending nothing", () => {
    expect(REASONS).toContain("level-receive");
    expect(REASON_TEXT["level-receive"]).toBe(
      "The project receives from this server and sends nothing.",
    );
  });
});

describe("redaction at the edge", () => {
  const sent = (text: string, env: Record<string, string | undefined> = {}): string =>
    redactForSend(text, env);

  test("a private block leaves as its marker", () => {
    expect(sent("<private>x</private>")).toBe("[PRIVATE]");
  });

  test("a key in the text is replaced", () => {
    const letters = "abcdefghijklmnopqrstuvwxyzabcdefghijklmn";
    expect(letters).toHaveLength(40);
    const text = sent(`key sk-ant-api03-${letters}`);
    expect(text).toContain("[REDACTED:");
    expect(text).not.toContain(letters);
  });

  test("a secret of the environment it is given is removed, and of no other", () => {
    const text = "it is hunter2-hunter2 today";
    expect(sent(text, { DEPLOY_TOKEN: "hunter2-hunter2" })).toBe(
      "it is [REDACTED:env-value] today",
    );
    expect(sent(text)).toBe(text);
  });
});

describe("keys and uids", () => {
  test("a level is keyed by its project and its destination", () => {
    expect(levelKey(3, "team")).toBe("3@team");
  });

  test("an entry's uid is its id scoped by its repository", () => {
    expect(entryUid("workspace", null, "u")).toBe("workspace:u");
    expect(entryUid("shared", null, "u")).toBe("shared:u");
    expect(entryUid("project", "remote:github.com/x/y", "u")).toBe(
      "project:remote:github.com/x/y:u",
    );
    expect(() => entryUid("project", null, "u")).toThrow();
  });

  test("a memory's uid is its row id scoped by the store's generation", () => {
    expect(memoryUid("ab12cd34", 7)).toBe("ab12cd34:7");
  });
});
