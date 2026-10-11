// Prompts as people read them. The agents' own notifications and hand-backs arrive as
// XML-ish envelopes, Codex wraps a delegated prompt, and paths run long: each is named or
// tidied for what it is. Pure, with no imports, so the tests load it without a page.

/** What a prompt was, for a one-line title: the full text stays in the trace. */
export interface PromptLine {
  title: string;
  sub: string;
  kind: "prompt" | "task" | "subagent";
}
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
/** A one-line title from Markdown: no emphasis markers, list bullets or heading hashes. */
const plainLine = (text: string) =>
  squash(text.replace(/^\s*(?:[-*+]|#{1,6}|\d+\.)\s+/gm, "").replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/\*\*|__/g, ""));
/** A subagent's report without the harness's envelope and preamble: Markdown as it was written. */
export function subagentReport(prompt: string): string {
  const body = prompt.trim().replace(/^<agent-message[^>]*>/, "").replace(/<\/agent-message>\s*$/, "");
  return (/\n\s*\n([\s\S]*)/.exec(body)?.[1] ?? body).replace(/^ {2,4}/gm, "").trim();
}

export function describePrompt(prompt: string): PromptLine {
  const text = prompt.trim();
  if (text.startsWith("<task-notification>")) {
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1];
    const status = /<status>([\s\S]*?)<\/status>/.exec(text)?.[1];
    return { title: summary ? squash(summary) : "Background task", sub: summary ? `Background task${status ? ` · ${squash(status)}` : ""}` : status ? squash(status) : "", kind: "task" };
  }
  if (text.startsWith("<agent-message")) {
    // The harness's preamble is one paragraph; the report starts after the first blank line.
    const body = text.replace(/^<agent-message[^>]*>/, "").replace(/<\/agent-message>\s*$/, "");
    const report = /\n\s*\n([\s\S]*)/.exec(body)?.[1] ?? "";
    const title = plainLine(report).slice(0, 160).replace(/\s+\S*$/, (tail) => (report.length > 160 ? "…" : tail));
    return { title: title || "Subagent report", sub: title ? "Subagent report" : "", kind: "subagent" };
  }
  const images = (text.match(/\[Image #\d+\]/g) ?? []).length;
  const plain = squash(text.replace(/\[Image #\d+\]/g, ""));
  return { title: plain || "(no prompt)", sub: images ? `${images} image${images > 1 ? "s" : ""}` : "", kind: "prompt" };
}

/** Codex wraps a prompt it was delegated: what was asked is its `<input>`. */
export function unwrapPrompt(prompt: string): string {
  const text = prompt.trim();
  if (!text.startsWith("<realtime_delegation>")) return prompt;
  const input = /<input>([\s\S]*?)<\/input>/.exec(text)?.[1]?.trim();
  return input || prompt;
}

// An absolute path: starts at a slash that does not follow a word, a dot, a colon or a slash
// (so a URL's path stays), and runs over at least two segments.
const PATH = /(?<![\w.~:/-])\/(?:[\w.@+-]+\/)+[\w.@+-]+/g;
const HOME = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;

/** Long absolute paths, shortened: the home folder as ~, the middle as …, the last three segments kept. */
export function tidyPaths(text: string): string {
  return text.replace(PATH, (path) => {
    const home = HOME.exec(path)?.[0];
    const rest = (home ? path.slice(home.length) : path).split("/").filter(Boolean);
    if (home) return rest.length > 3 ? `~/…/${rest.slice(-3).join("/")}` : `~/${rest.join("/")}`;
    return rest.length > 4 ? `…/${rest.slice(-3).join("/")}` : path;
  });
}

/**
 * The first line of Markdown worth reading, as plain text: code blocks and tables skipped,
 * markers, emphasis and code ticks dropped, paths tidied. Empty when there is none.
 */
export function firstLine(markdown: string): string {
  const prose = markdown.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "");
  const line = prose.split("\n").find((l) => l.trim() !== "" && !/^\s*\|/.test(l) && !/^\s*(?:```|~~~)/.test(l)) ?? "";
  return tidyPaths(plainLine(line).replace(/`([^`]*)`/g, "$1"));
}

/** A past conversation's prompt as a row's one line. */
export function pastLine(prompt: string): PromptLine {
  const text = unwrapPrompt(prompt);
  const line = describePrompt(text);
  // A report reads by its first line (its heading), not every line run together.
  const title = line.kind === "subagent" ? firstLine(subagentReport(text)) || line.title : line.title;
  return { ...line, title: tidyPaths(title) };
}

/** A past conversation's prompt as Markdown to read: envelopes opened, paths tidied. */
export function pastBody(prompt: string): string {
  const text = unwrapPrompt(prompt).trim();
  if (text.startsWith("<agent-message")) return tidyPaths(subagentReport(text));
  if (text.startsWith("<task-notification>")) {
    const tag = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() || undefined;
    const summary = tag("summary");
    const status = tag("status");
    const result = tag("result");
    const output = tag("output-file");
    const after = text.replace(/^[\s\S]*<\/task-notification>/, "").trim();
    const parts = [
      summary ? `**${summary}**` : "**Background task**",
      status ? `Status: ${status}` : "",
      result ?? "",
      output && !after.includes(output) ? `Output: \`${output}\`` : "",
      after,
    ];
    return tidyPaths(parts.filter(Boolean).join("\n\n"));
  }
  return tidyPaths(text);
}
