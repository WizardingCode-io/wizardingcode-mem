// The host's rule (ADR 0033): seventeen rows, the first that applies wins, and a later fact is
// asked for only when every earlier row let the run pass.
import { describe, expect, test } from "bun:test";
import { decide, EXIT, type Facts, type Outcome } from "../../src/host/rule.ts";

const FLOOR = 500 * 1024 * 1024;
const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

type Running = Exclude<Facts["running"], "unreadable" | undefined>;
type Candidate = NonNullable<Facts["candidate"]>;
const running = (over: Partial<Running> = {}): Running => ({
  version: "0.9.1",
  schema: 2,
  accepts: [1, 2],
  freeBytes: FLOOR * 4,
  dbBytes: 1000,
  digest: A,
  ...over,
});
const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  version: "0.9.2",
  teamSchema: 2,
  contract: 2,
  accepts: [1, 2],
  ...over,
});
/** Facts that pass every row and reach `apply`. */
const full = (over: Partial<Facts> = {}): Facts => ({
  attended: false,
  rejected: [],
  floorBytes: FLOOR,
  docker: "ok",
  container: "healthy",
  envMatches: true,
  running: running(),
  candidateDigest: B,
  verification: "verified",
  candidate: candidate(),
  ...over,
});

/** One record per row: what makes that row the first to apply. */
const ROWS: Array<{ row: number; outcome: Outcome; exit: number; over: Partial<Facts> }> = [
  { row: 1, outcome: "cannot-check", exit: 13, over: { docker: "silent" } },
  { row: 2, outcome: "starting", exit: 0, over: { container: "starting" } },
  { row: 3, outcome: "down", exit: 10, over: { container: "other" } },
  { row: 4, outcome: "env-differs", exit: 14, over: { envMatches: false } },
  { row: 5, outcome: "cannot-check", exit: 13, over: { running: "unreadable" } },
  { row: 6, outcome: "cannot-check", exit: 13, over: { candidateDigest: null } },
  { row: 7, outcome: "current", exit: 0, over: { candidateDigest: A } },
  { row: 8, outcome: "rejected", exit: 11, over: { rejected: [B] } },
  { row: 9, outcome: "cannot-check", exit: 13, over: { verification: "could-not" } },
  { row: 10, outcome: "not-verified", exit: 12, over: { verification: "not-verified" } },
  { row: 11, outcome: "low-disk", exit: 15, over: { running: running({ freeBytes: FLOOR - 1 }) } },
  { row: 12, outcome: "cannot-check", exit: 13, over: { candidate: null } },
  { row: 13, outcome: "not-higher", exit: 0, over: { candidate: candidate({ version: "0.9.1" }) } },
  {
    row: 14,
    outcome: "waits-migration",
    exit: 14,
    over: { candidate: candidate({ teamSchema: 3 }) },
  },
  {
    row: 15,
    outcome: "waits-contract",
    exit: 14,
    over: { candidate: candidate({ contract: 3, accepts: [2, 3] }) },
  },
  {
    row: 16,
    outcome: "low-disk",
    exit: 15,
    over: {
      attended: true,
      candidate: candidate({ teamSchema: 3 }),
      running: running({ freeBytes: FLOOR + 10, dbBytes: 1000 }),
    },
  },
  { row: 17, outcome: "apply", exit: 0, over: {} },
];

describe("decide", () => {
  test("each of the seventeen rows gives its outcome and exit", () => {
    expect(ROWS.map((r) => r.row)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    for (const { row, outcome, exit, over } of ROWS)
      expect({ row, got: decide(full(over)) }).toEqual({ row, got: { outcome, exit, row } });
  });

  test("the exit codes are the table's", () => {
    expect(EXIT).toEqual({
      ok: 0,
      down: 10,
      rejected: 11,
      notVerified: 12,
      cannotCheck: 13,
      waits: 14,
      lowDisk: 15,
      usage: 64,
      unavailable: 69,
      locked: 75,
    });
  });

  // Rows 2 and 3 read one fact (the container) with values that exclude each other, and so do
  // 9 and 10 (the verification): no facts satisfy both, so those two pairs have no case.
  test("of two adjacent rows that both apply, the first wins", () => {
    const pairs: Array<[first: number, over: Partial<Facts>]> = [
      [1, { docker: "silent", container: "starting" }],
      [3, { container: "other", envMatches: false }],
      [4, { envMatches: false, running: "unreadable" }],
      [5, { running: "unreadable", candidateDigest: null }],
      [7, { candidateDigest: A, rejected: [A] }],
      [8, { rejected: [B], verification: "could-not" }],
      [10, { verification: "not-verified", running: running({ freeBytes: null }) }],
      [11, { running: running({ freeBytes: 1 }), candidate: null }],
      [13, { candidate: candidate({ version: "0.9.0", teamSchema: 3 }) }],
      [14, { candidate: candidate({ teamSchema: 3, accepts: [2] }) }],
      [
        15,
        {
          candidate: candidate({ accepts: [2], teamSchema: 2 }),
          running: running({ dbBytes: null }),
        },
      ],
      [
        16,
        {
          attended: true,
          candidate: candidate({ teamSchema: 3 }),
          running: running({ dbBytes: null }),
        },
      ],
    ];
    for (const [first, over] of pairs)
      expect({ first, row: (decide(full(over)) as { row: number }).row }).toEqual({
        first,
        row: first,
      });
    // 6 before 7: no digest from the registry while the running image has none either.
    expect(decide(full({ candidateDigest: null, running: running({ digest: null }) }))).toEqual({
      outcome: "cannot-check",
      exit: 13,
      row: 6,
    });
    // 12 before 13: a candidate that could not be read has no version to compare.
    expect(decide(full({ candidate: null }))).toMatchObject({ row: 12 });
  });

  test("a fact not yet read is asked for, in the rule's order, and nothing later is", () => {
    const order = [
      "docker",
      "container",
      "envMatches",
      "running",
      "candidateDigest",
      "verification",
      "candidate",
    ] as const;
    const facts: Facts = { attended: false, rejected: [], floorBytes: FLOOR };
    const source = full();
    for (const name of order) {
      expect(decide(facts)).toEqual({ need: name });
      Object.assign(facts, { [name]: source[name] });
    }
    expect(decide(facts)).toEqual({ outcome: "apply", exit: 0, row: 17 });
    // A row that decides early never asks for what comes after it.
    expect(decide({ attended: false, rejected: [], floorBytes: FLOOR, docker: "silent" })).toEqual({
      outcome: "cannot-check",
      exit: 13,
      row: 1,
    });
    expect(
      decide({
        attended: false,
        rejected: [B],
        floorBytes: FLOOR,
        docker: "ok",
        container: "healthy",
        envMatches: true,
        running: running(),
        candidateDigest: B,
      }),
    ).toEqual({ outcome: "rejected", exit: 11, row: 8 });
  });

  test("the attended verb passes the rejected list, the migration and the contract", () => {
    expect(decide(full({ attended: true, rejected: [B] }))).toMatchObject({ outcome: "apply" });
    expect(
      decide(
        full({
          attended: true,
          candidate: candidate({ teamSchema: 3 }),
          running: running({ freeBytes: FLOOR + 1000, dbBytes: 1000 }),
        }),
      ),
    ).toMatchObject({ outcome: "apply" });
    expect(
      decide(full({ attended: true, candidate: candidate({ contract: 3, accepts: [3] }) })),
    ).toMatchObject({ outcome: "apply" });
  });

  test("nothing is applied that did not verify, could not be read, is not higher or lacks disk, attended or not", () => {
    const verifications = ["verified", "could-not", "not-verified"] as const;
    const candidates = [
      null,
      candidate(),
      candidate({ version: "0.9.1" }),
      candidate({ version: "0.8.0" }),
      candidate({ teamSchema: 3 }),
      candidate({ accepts: [2] }),
      candidate({ accepts: [] }),
    ];
    const frees = [null, 0, FLOOR - 1, FLOOR, FLOOR * 4];
    let applied = 0;
    for (const attended of [false, true])
      for (const verification of verifications)
        for (const cand of candidates)
          for (const freeBytes of frees) {
            const got = decide(
              full({ attended, verification, candidate: cand, running: running({ freeBytes }) }),
            );
            if (!("outcome" in got) || got.outcome !== "apply") continue;
            applied += 1;
            expect(verification).toBe("verified");
            expect(cand).not.toBeNull();
            const c = cand as Candidate;
            expect(["0.9.2"]).toContain(c.version);
            expect(freeBytes).not.toBeNull();
            expect(freeBytes as number).toBeGreaterThanOrEqual(FLOOR);
            if (!attended) {
              expect(c.teamSchema).toBe(2);
              expect([1, 2].every((n) => c.accepts.includes(n))).toBe(true);
            }
          }
    expect(applied).toBeGreaterThan(0);
  });
});
