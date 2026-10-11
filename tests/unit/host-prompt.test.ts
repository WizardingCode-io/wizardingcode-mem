import { describe, expect, test } from "bun:test";
import { isFromTheHost } from "../../src/core/host-prompt.ts";

describe("isFromTheHost", () => {
  test("a background task's notification is the host's", () => {
    expect(isFromTheHost("<task-notification>\n<task-id>b1</task-id>\n</task-notification>")).toBe(
      true,
    );
  });

  test("a subagent's report is the host's, attributes and leading space included", () => {
    expect(isFromTheHost('  <agent-message from="a1">\nDone.\n</agent-message>')).toBe(true);
  });

  test("what the user typed is not, even when it mentions the tags", () => {
    expect(isFromTheHost("why does <task-notification> show up in my notes?")).toBe(false);
    expect(isFromTheHost("<task-notifications are noisy>")).toBe(false);
    expect(isFromTheHost("")).toBe(false);
  });
});
