import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../../ui/src/markdown.ts";

describe("renderMarkdown", () => {
  test("formats what agents write: headings, emphasis, code, lists, tables", () => {
    const html = renderMarkdown(
      "## Done\n**3** files, `bun test` green\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    );
    expect(html).toContain("<h2>Done</h2>");
    expect(html).toContain("<strong>3</strong>");
    expect(html).toContain("<code>bun test</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<td>1</td>");
  });

  test("never lets stored text become markup or script", () => {
    const html = renderMarkdown('<script>alert(1)</script> <img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  test("refuses javascript: links and opens the others in a new tab without the referrer", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain('href="javascript:');
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("never loads an image: a Markdown image becomes its alt text", () => {
    const html = renderMarkdown(
      "![build passing](https://img.shields.io/badge/x.svg) and ![](http://x.test/a.png)",
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("shields.io");
    expect(html).toContain("build passing");
  });
});
