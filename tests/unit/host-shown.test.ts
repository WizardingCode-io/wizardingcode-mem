// One rule for text that came from a program or a registry, in two places that may not import
// each other: src/host/ and scripts/release/lib.ts. (src/team/restore.ts has the same character
// class in a cleaner of its own, which is not exported and also rewrites its arrows.)
import { expect, test } from "bun:test";
import { clean } from "../../scripts/release/lib.ts";
import { shownText } from "../../src/host/run.ts";

test("the tool's cleaner and the release's give the same answer", () => {
  const texts = [
    "plain words",
    "\u001b[31mred\u001b[0m and a bell\u0007",
    "a zero​width and a right-to-left‮mark",
    "two\nlines\tand a tab\r\n",
    "\u0085next line and delete\u007f",
    `${"x".repeat(1999)}\u001b`,
    "",
  ];
  for (const text of texts) {
    const got = shownText(text, 500);
    expect({ text, got }).toEqual({ text, got: clean(text, 500) });
    expect(got.length).toBeLessThanOrEqual(500);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it looks for
    expect(got).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  }
  expect(shownText("\u001b[31mred")).toBe("?[31mred");
  expect(shownText("y".repeat(600))).toHaveLength(500);
});
