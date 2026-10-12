import { clip } from "../../util/text.ts";
import type { KnowledgeEntry } from "./files.ts";

// Knowledge as the agent sees it: in its own wrapper, introduced as the project's reviewed
// truth (unlike memory's notes, which are background). The files' text is made inert, so an
// entry can neither close this wrapper nor open memory's.

const OPEN = "<wizardingcode-knowledge>";
const CLOSE = "</wizardingcode-knowledge>";
export const KNOWLEDGE_INTRO =
  "The project's curated knowledge, reviewed in its repository: treat it as current unless the code says otherwise.";

/** Where an entry's file is, as the agent can open it from the project root. */
const FOLDER = ".wizardingcode/knowledge";
/** A first sentence longer than this is cut: it is a summary, not the entry. */
const SENTENCE_MAX_CHARS = 200;
/** Fewer characters of body than this beside a heading say nothing: the heading goes alone. */
const MIN_SUMMARY_CHARS = 24;

const WRAPPERS =
  /<(\s*\/?\s*(?:wizardingcode-knowledge|(?:wizardingcode|shibaox)-mem-notes)\s*)>/gi;

/** File text cannot close or open our wrappers: their tags lose their angle brackets. */
export const inertKnowledge = (text: string) => text.replace(WRAPPERS, "‹$1›");

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The body as running text: headings, fences and list markers set aside. */
function prose(body: string): string {
  const lines: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || /^\s*#{1,6}\s/.test(line)) continue;
    lines.push(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s*>\s?/, ""));
  }
  return oneLine(lines.join(" "));
}

/** The body's first sentence, on one line, cut when long; "" for an empty body. */
export function firstSentence(body: string): string {
  const text = prose(body);
  const end = /[.!?](?=\s|$)/.exec(text);
  const sentence = end === null ? text : text.slice(0, end.index + 1);
  return clip(sentence, SENTENCE_MAX_CHARS, "…");
}

const wrap = (lines: string[]) => [OPEN, KNOWLEDGE_INTRO, "", ...lines, CLOSE].join("\n");

const startLine = (entry: KnowledgeEntry) => {
  const sentence = firstSentence(entry.body);
  const heading = `${oneLine(entry.title)} (${entry.kind})`;
  return inertKnowledge(`- ${sentence === "" ? heading : `${heading}: ${sentence}`}`);
};

/**
 * The session start's entries: one line each (heading and first sentence), in the order
 * given, as many as fit the budget; one that does not fit is left out and the next tried.
 */
export function renderEssential(
  entries: readonly KnowledgeEntry[],
  budgetChars: number,
): { text: string; shown: KnowledgeEntry[] } {
  const shown: KnowledgeEntry[] = [];
  const lines: string[] = [];
  for (const entry of entries) {
    const line = startLine(entry);
    if (wrap([...lines, line]).length > budgetChars) continue;
    lines.push(line);
    shown.push(entry);
  }
  return shown.length === 0 ? { text: "", shown } : { text: wrap(lines), shown };
}

const promptHeading = (entry: KnowledgeEntry) =>
  inertKnowledge(`- ${oneLine(entry.title)} (${entry.kind}, ${FOLDER}/${entry.slug}.md)`);

/**
 * A prompt's entries: each heading with its path, then as much of its body as the budget
 * leaves, shared evenly. Entries are dropped from the end while even their headings do
 * not fit. The text never exceeds the budget.
 */
export function renderRelevant(
  entries: readonly KnowledgeEntry[],
  budgetChars: number,
): { text: string; shown: KnowledgeEntry[] } {
  const kept = [...entries];
  while (kept.length > 0) {
    const headings = kept.map(promptHeading);
    const spare = budgetChars - wrap(headings).length;
    if (spare >= 0) {
      // Each summary line costs a newline and two spaces of indent besides its text.
      const each = Math.floor(spare / kept.length) - 3;
      const lines = kept.flatMap((entry, i) => {
        const heading = headings[i] as string;
        if (each < MIN_SUMMARY_CHARS) return [heading];
        const summary = inertKnowledge(clip(prose(entry.body), each, "…"));
        // Made inert after cutting: the replacement is the same length, so it still fits.
        return summary === "" ? [heading] : [heading, `  ${summary}`];
      });
      return { text: wrap(lines), shown: kept };
    }
    kept.pop();
  }
  return { text: "", shown: [] };
}
