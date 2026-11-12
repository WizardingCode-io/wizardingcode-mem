// The question a command asks before it lets more leave, and the lines `share status` prints.
import { describe, expect, test } from "bun:test";
import { confirmWidening, formatShareStatus } from "../../src/cli/commands/share.ts";
import { askYesNo } from "../../src/cli/prompt.ts";
import { policyWith } from "../../src/sharing/levels.ts";
import type { Report } from "../../src/sharing/report.ts";
import type { ChangeRow } from "../../src/sharing/store.ts";

/** A terminal that answers with one line, and counts how often it was read. */
function answering(line: string | null, isTTY = true) {
  let reads = 0;
  return {
    io: {
      isTTY,
      read: () => {
        reads++;
        return line;
      },
    },
    reads: () => reads,
  };
}

/** What a call printed on standard output, and what it returned. */
function captured<T>(fn: () => T): { result: T; printed: string } {
  const write = process.stdout.write;
  let printed = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    printed += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = fn();
    return { result, printed };
  } finally {
    process.stdout.write = write;
  }
}

const ask = (line: string | null, defaultYes: boolean) =>
  captured(() => askYesNo("Q", defaultYes, answering(line).io)).result;

describe("askYesNo", () => {
  test("without a terminal the answer is no, and nobody is asked", () => {
    for (const defaultYes of [false, true]) {
      const terminal = answering("y", false);
      const { result, printed } = captured(() => askYesNo("Q", defaultYes, terminal.io));
      expect(result).toBe(false);
      expect(terminal.reads()).toBe(0);
      expect(printed).toBe("");
    }
  });

  test("yes is y, yes, s or sim, whatever the case and the space around it", () => {
    for (const line of ["y", "Y", "yes ", "s", "sim", " YES\n", "Sim\n"]) {
      expect(ask(line, false)).toBe(true);
      expect(ask(line, true)).toBe(true);
    }
  });

  test("anything else is no", () => {
    for (const line of ["n", "maybe", "no\n", "yess"]) {
      expect(ask(line, false)).toBe(false);
      expect(ask(line, true)).toBe(false);
    }
  });

  test("an empty line is the default", () => {
    for (const line of ["", "\n", "  \n"]) {
      expect(ask(line, false)).toBe(false);
      expect(ask(line, true)).toBe(true);
    }
  });

  test("the end of input is no, whatever the default", () => {
    expect(ask(null, false)).toBe(false);
    expect(ask(null, true)).toBe(false);
  });

  test("the question shows which answer Enter gives", () => {
    const no = answering("y");
    expect(captured(() => askYesNo("Q", false, no.io)).printed).toBe("Q [y/N] ");
    expect(no.reads()).toBe(1);
    expect(captured(() => askYesNo("Q", true, answering("n").io)).printed).toBe("Q [Y/n] ");
  });
});

describe("confirmWidening", () => {
  test("--yes answers, and nobody is asked", () => {
    for (const isTTY of [true, false]) {
      const terminal = answering("n", isTTY);
      const { result, printed } = captured(() => confirmWidening("Q", ["--yes"], terminal.io));
      expect(result).toBe(true);
      expect(terminal.reads()).toBe(0);
      expect(printed).toBe("");
    }
  });

  test("without --yes and without a terminal it is no, and nobody is asked", () => {
    const terminal = answering("y", false);
    expect(captured(() => confirmWidening("Q", [], terminal.io)).result).toBe(false);
    expect(captured(() => confirmWidening("Q", ["all"], terminal.io)).result).toBe(false);
    expect(terminal.reads()).toBe(0);
  });

  test("on a terminal the person is asked, and Enter alone is no", () => {
    const yes = captured(() => confirmWidening("Q", [], answering("y").io));
    expect(yes).toEqual({ result: true, printed: "Q [y/N] " });
    expect(captured(() => confirmWidening("Q", [], answering("\n").io)).result).toBe(false);
    expect(captured(() => confirmWidening("Q", [], answering(null).io)).result).toBe(false);
  });
});

describe("formatShareStatus", () => {
  const counts = (entries: number, memories: number): Report => ({
    counts: { entries, memories },
    perRoot: {
      workspace: { entries, areaTotals: {} },
      shared: { entries: 0, areaTotals: {} },
    },
    perProject: [
      { id: 1, level: "knowledge", entries: 0, memories: 0, imported: 0 },
      { id: 2, level: "all", entries: 0, memories: 0, imported: 0 },
      { id: 3, level: "local", entries: 0, memories: 0, imported: 0 },
      { id: 4, level: "local", entries: 0, memories: 0, imported: 0 },
    ],
  });
  const change: ChangeRow = {
    id: 7,
    at: Date.UTC(2026, 10, 9, 8, 0, 0),
    source: "cli",
    what: "roots",
    old: "none",
    new: "shared,workspace",
  };

  test("says the epoch and the last change, the lists, the projects, this one, and what leaves", () => {
    const policy = policyWith({
      epoch: 2097361,
      roots: new Set(["shared", "workspace"]),
      areas: new Set(["workspace:sales"]),
      inert: ["workspace:nope", "shared:gone"],
      problems: [
        "areas not in the taxonomy, ignored: workspace:nope, shared:gone",
        "memory is off for gears; its level is Nothing until you turn memory on and set it again",
      ],
    });
    const project = {
      name: "widgets",
      level: "knowledge" as const,
      boundAlias: "remote:github.com/acme/widgets",
    };
    expect(formatShareStatus(policy, counts(12, 1), project, change)).toEqual([
      "sharing   epoch 2097361 · last change: roots none → shared,workspace, 2026-11-09T08:00:00.000Z, from the cli",
      "roots     shared,workspace",
      "areas     workspace:sales (workspace:nope, shared:gone not in the taxonomy; ignored)",
      "problem   memory is off for gears; its level is Nothing until you turn memory on and set it again",
      "projects  1 knowledge · 1 knowledge and memories · 2 nothing",
      "this      widgets: Knowledge (bound to remote:github.com/acme/widgets)",
      "leaves    12 entries · 1 memory",
    ]);
  });

  test("with nothing chosen, nothing changed and no project here", () => {
    const report: Report = { ...counts(0, 0), perProject: [] };
    expect(formatShareStatus(policyWith({}), report, null, null)).toEqual([
      "sharing   epoch 0 · no change yet",
      "roots     none",
      "areas     none",
      "projects  0 knowledge · 0 knowledge and memories · 0 nothing",
      "this      not a known project",
      "leaves    0 entries · 0 memories",
    ]);
  });

  test("a project that shares nothing is bound to no remote", () => {
    const project = { name: "widgets", level: "local" as const, boundAlias: "" };
    const lines = formatShareStatus(policyWith({}), counts(1, 0), project, null);
    expect(lines).toContain("this      widgets: Nothing");
    expect(lines).toContain("leaves    1 entry · 0 memories");
  });

  test("a list names the entries and the memories, and how many more there are", () => {
    const report: Report = {
      ...counts(503, 501),
      items: {
        entries: [
          {
            scope: "workspace",
            projectId: 0,
            slug: "sales-one",
            title: "Sales one",
            area: "sales",
          },
          { scope: "project", projectId: 1, slug: "deploys", title: "How we deploy", area: "code" },
        ],
        memories: [{ id: 12, projectId: 1, title: "Deploys need the staging flag" }],
        more: { entries: 3, memories: 1 },
      },
    };
    const lines = formatShareStatus(policyWith({}), report, null, null);
    expect(lines.slice(5)).toEqual([
      "leaves    503 entries · 501 memories",
      "entry   workspace/sales-one  sales  Sales one",
      "entry   project/deploys  code  How we deploy",
      "+3 more",
      "memory  12  Deploys need the staging flag",
      "+1 more",
    ]);
    const exact: Report = {
      ...report,
      items: { entries: [], memories: [], more: { entries: 0, memories: 0 } },
    };
    expect(formatShareStatus(policyWith({}), exact, null, null)).toHaveLength(6);
  });
});
