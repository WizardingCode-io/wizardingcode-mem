import { describe, expect, test } from "bun:test";
import { agentName, dayGroups, type PastTurn } from "../../ui/src/history.ts";
import {
  describePrompt,
  firstLine,
  pastBody,
  pastLine,
  tidyPaths,
  unwrapPrompt,
} from "../../ui/src/prompt.ts";

const NOW = new Date(2026, 9, 11, 15, 0).getTime();
const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).getTime();
const hit = (id: number, endedAt: number): PastTurn => ({
  id,
  project: "shop",
  agent: "claude-code",
  sessionId: "s",
  cwd: "/w",
  startedAt: endedAt - 1000,
  endedAt,
  prompt: `p${id}`,
  answer: null,
});

describe("past conversations grouped by day", () => {
  test("today, yesterday, then dates, newest day first and newest first within a day", () => {
    const groups = dayGroups(
      [hit(1, at(9, 10)), hit(2, at(11, 9)), hit(3, at(10, 20)), hit(4, at(11, 14))],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Today · Sun 11 Oct",
      "Yesterday · Sat 10 Oct",
      "Fri 9 Oct",
    ]);
    expect(groups[0]?.hits.map((h) => h.id)).toEqual([4, 2]);
  });

  test("another year shows the year", () => {
    const [group] = dayGroups([hit(1, new Date(2025, 11, 30, 9).getTime())], NOW);
    expect(group?.label).toBe("Tue 30 Dec 2025");
  });

  test("agents by name", () => {
    expect(agentName("claude-code")).toBe("Claude Code");
    expect(agentName("codex")).toBe("Codex");
    expect(agentName("gemini")).toBe("Gemini");
    expect(agentName("something-new")).toBe("something-new");
  });
});

describe("prompts tidied for display", () => {
  test("Codex's realtime delegation is the input inside it", () => {
    const raw =
      "<realtime_delegation>\n<context>long context</context>\n<input>  Fix the cart total  </input>\n</realtime_delegation>";
    expect(unwrapPrompt(raw)).toBe("Fix the cart total");
    expect(pastLine(raw).title).toBe("Fix the cart total");
    expect(unwrapPrompt("plain words")).toBe("plain words");
  });

  test("long paths are shortened; home becomes ~; URLs stay", () => {
    expect(tidyPaths("see /Users/ana/AIProjects/ai-mem/src/ui/server.ts now")).toBe(
      "see ~/…/src/ui/server.ts now",
    );
    expect(tidyPaths("in /Users/ana/code/app")).toBe("in ~/code/app");
    expect(tidyPaths("tmp /private/tmp/claude-501/x/tasks/b1.output")).toBe(
      "tmp …/x/tasks/b1.output",
    );
    expect(tidyPaths("short /etc/hosts")).toBe("short /etc/hosts");
    expect(tidyPaths("https://example.com/a/b/c/d/e/f")).toBe("https://example.com/a/b/c/d/e/f");
  });

  test("a task notification reads as its summary, its result and its output file", () => {
    const raw = [
      "<task-notification>",
      "<task-id>b1x</task-id>",
      "<output-file>/private/tmp/claude-501/sess/tasks/b1x.output</output-file>",
      "<status>completed</status>",
      '<summary>Background command "Run the tests" completed (exit code 0)</summary>',
      "<result>42 pass, 0 fail</result>",
      "</task-notification>",
      "Read the output file to retrieve the result: /private/tmp/claude-501/sess/tasks/b1x.output",
    ].join("\n");
    expect(pastLine(raw)).toMatchObject({
      title: 'Background command "Run the tests" completed (exit code 0)',
      kind: "task",
    });
    const body = pastBody(raw);
    expect(body).toContain('Background command "Run the tests" completed (exit code 0)');
    expect(body).toContain("42 pass, 0 fail");
    expect(body).toContain("…/sess/tasks/b1x.output");
    expect(body).not.toContain("<task-id>");
    expect(body).not.toContain("/private/tmp/claude-501/sess");
  });

  test("a subagent report is the report, without the envelope", () => {
    const raw =
      '<agent-message from="worker">\nThe harness preamble.\n\n## Done\nAll **green**.\n</agent-message>';
    expect(pastBody(raw)).toBe("## Done\nAll **green**.");
    expect(pastLine(raw).kind).toBe("subagent");
  });

  test("a typed prompt is itself, paths tidied; the title is one line", () => {
    const raw = "Why does\n/Users/ana/AIProjects/shop/src/cart/total.ts drift?";
    expect(pastBody(raw)).toBe("Why does\n~/…/src/cart/total.ts drift?");
    expect(pastLine(raw).title).toBe("Why does ~/…/src/cart/total.ts drift?");
  });

  test("a subagent report's row title is its first line", () => {
    const raw =
      '<agent-message from="r">\nPreamble.\n\n## Review: cart rounding\n\n- **Correct**: moved\n</agent-message>';
    expect(pastLine(raw).title).toBe("Review: cart rounding");
  });

  test("an answer's first line is plain text: no tables, fences, markers or code ticks", () => {
    expect(firstLine("| Year | n |\n|---|---|\n| 2021 | 3 |\n\nAll of them are **EUR**.")).toBe(
      "All of them are EUR.",
    );
    expect(
      firstLine(
        "```ts\nconst x = 1;\n```\nAdded `total.ts` and /Users/ana/AIProjects/shop/src/cart/total.ts",
      ),
    ).toBe("Added total.ts and ~/…/src/cart/total.ts");
    expect(firstLine("## Done\n- one")).toBe("Done");
    expect(firstLine("| only | a table |")).toBe("");
  });

  test("describePrompt still names notifications as before", () => {
    expect(
      describePrompt("<task-notification><status>killed</status></task-notification>"),
    ).toMatchObject({ title: "Background task", kind: "task" });
  });
});
