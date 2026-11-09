// The observed check of the knowledge-for-the-agent item's document criterion (AC-26): ADR
// 0024's part 2 with the sections and sentences task 23 names, the dated note in ADR 0019,
// CLAUDE.md's and the README's sentences. Exits 1 when a part is missing.
//   ./node_modules/.bin/bun .crew/work/<item>/probes/check-docs.ts <repository root> [--at <commit>]
// With --at, the files are read from that commit through git (a red run on the item's base,
// where part 2 does not exist); without it, from the working tree.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const at = process.argv[3] === "--at" ? process.argv[4] : undefined;
const problems: string[] = [];
const text = (path: string): string => {
  if (at === undefined) {
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      problems.push(`${path} is not there`);
      return "";
    }
  }
  const shown = Bun.spawnSync(["git", "show", `${at}:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (shown.exitCode !== 0) {
    problems.push(`${path} is not there at ${at.slice(0, 7)}`);
    return "";
  }
  return shown.stdout.toString();
};
const expectAll = (file: string, body: string, phrases: Array<[string, string]>) => {
  for (const [what, phrase] of phrases) {
    if (!body.includes(phrase)) problems.push(`${file} lacks ${what} (${phrase})`);
  }
};

const adr = text("docs/adr/0024-knowledge-module.md");
expectAll("ADR 0024", adr, [
  ["part 2", "## Part 2: knowledge for the agent"],
  ["the reversal of ADR 0019's note", "### The reversal of ADR 0019's note of 2026-10-13"],
  ["F5′ as a ruling", "**F5′.**"],
  ["F5′ amending F5", "amending ADR 0019's F5"],
  ["the frontmatter keys", "### The frontmatter keys"],
  ["the tool contract's answer shapes", "**The answer shapes.**"],
  ["the agent id's boundary", "**The id is not authenticated.**"],
  ["the shared breaker", "**The breaker is shared with distillation**"],
  ["the tool-path judge", "makeJudge({ toolPath: true })"],
  ["who keeps the search table", "**Who keeps the search table.**"],
  ["knowledge_shown's growth", "### `knowledge_shown` and its growth"],
  ["the drain's comparison", "**The drain's comparison.**"],
  ["the two outcomes of a hand edit", "**A hand edit has two outcomes.**"],
  ["doctor's signal", "**`doctor`'s signal"],
  ["the rebuild's write lock", "**The write lock a rebuild holds.**"],
  ["the 50 ms target", "under 50 ms"],
  ["the development store that ran migration 6 alone", "ran migration 6 alone"],
  ["the probe's numbers", "12 of 12 relevant prompts bring their entry first; 1 of 28 unrelated prompts injects"],
  ["the probe's size", "**These numbers are measured on 18 entries.**"],
  ["MIN_SHARED to revisit", "`MIN_SHARED` is the constant to revisit"],
  ["the judge's lexical neighbours", "The judge compares a draft only with what a lexical search finds"],
  ["the inherited requirement", "is not shown by a hook until it has passed a review the sharing design names"],
  ["where it is enforced", "enforced in `visibleRepos`"],
  ["D-9 as one place", "One place, `forSessionStart`"],
  ["D-9 confirmed", "Confirmed by the person on 2026-11-09"],
]);
const rulings = (adr.match(/^\| D-(9|1[0-6]) \(part 2\) \|/gm) ?? []).length;
if (rulings !== 8) problems.push(`ADR 0024 has ${rulings} part-2 ruling rows (D-9 to D-16), not 8`);

const adr19 = text("docs/adr/0019-one-engine.md");
expectAll("ADR 0019", adr19, [["the dated note pointing to ADR 0024's part 2", "ADR 0024, part 2"]]);

const claude = text("CLAUDE.md");
expectAll("CLAUDE.md", claude, [
  ["the modules default", "default `memory,knowledge`"],
  ["how to turn knowledge off", "`WIZARDINGCODE_MODULES=memory` turns knowledge off"],
  ["the knowledge module's opening", "The knowledge module (ADR 0024"],
  ["the propose tool", "knowledge_propose"],
  ["module version 7", "is at 7"],
]);

const readme = text("README.md");
expectAll("README", readme, [
  ["on by default", "**On by default.**"],
  ["what the agent sees", "**What your agent sees.**"],
  ["the three tools", "**Three tools.**"],
  ["how to turn it off", "WIZARDINGCODE_MODULES=memory"],
]);
if (readme.includes("Agents are not shown knowledge yet")) {
  problems.push("README still says agents are not shown knowledge");
}

if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  process.exit(1);
}
console.log(
  "ADR 0024: part 2 with its 17 sections' marks and 8 rulings; ADR 0019: the dated note; CLAUDE.md: the modules default, the module's opening, the tools, version 7; README: on by default, what the agent sees, the three tools",
);
