// The observed check of the sharing policy's document criterion (AC-18): the ADR's twenty
// rulings, its sections and the sentences the first judgement round added; the README's
// Sharing subsection; the CLAUDE.md bullet and the settings line's exception. Exits 1 when a
// part is missing, so the record is not a count of one file.
//   ./node_modules/.bin/bun .crew/work/<item>/probes/check-docs.ts <repository root> [--at <commit>]
// With --at, the three files are read from that commit through git (a red run on the item's
// base, where the ADR does not exist); without it, from the working tree.
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
const adr = text("docs/adr/0025-sharing-policy.md");
const readme = text("README.md");
const claude = text("CLAUDE.md");

const rulings = (adr.match(/^\| D-\d+ \|/gm) ?? []).length;
if (rulings !== 20) problems.push(`ADR 0025 has ${rulings} ruling rows, not 20`);
for (const heading of [
  "## Storage: the `sharing` namespace",
  "## The two settings",
  "## The predicate's contract",
  "## The meaning of `all`",
  "## What leaves with an item, and what never does",
  "## Identity of a project",
  "## Restore and moving the store",
  "## Changes, confirmation and the hand edit",
  "## The boundary",
  "## What parts 5 and 6 must do",
]) {
  if (!adr.includes(heading)) problems.push(`ADR 0025 lacks the section ${heading}`);
}
for (const [what, phrase] of [
  ["the bound alias lost with the row", "loses its bound alias"],
  ["part 6's duty on withdrawals", "from the ledger's uids"],
  ["the ledger record's pinned keys", "`LEDGER_RECORD_KEYS`"],
  ["the decision's pinned keys", "`DECISION_KEYS`"],
]) {
  if (!adr.includes(phrase as string)) problems.push(`ADR 0025 lacks ${what} (${phrase})`);
}
const privacy = readme.indexOf("## Privacy and your data");
const sharing = readme.indexOf("### Sharing", privacy);
if (privacy === -1 || sharing === -1) problems.push("README has no Sharing subsection under Privacy and your data");
for (const word of [
  "wizardingcode-mem share project <local|knowledge|all>",
  "wizardingcode-mem share status",
  "WIZARDINGCODE_MEM_SHARE_ROOTS",
  "WIZARDINGCODE_MEM_SHARE_AREAS",
  "nothing is sent",
  "recalls nothing",
]) {
  if (!readme.includes(word)) problems.push(`README's Sharing text lacks ${word}`);
}
for (const word of [
  "`src/sharing/`",
  "wizardingcode-mem share project | roots | areas | status | explain",
  "`sharing` namespace",
]) {
  if (!claude.includes(word)) problems.push(`CLAUDE.md's bullet lacks ${word}`);
}
const settingsLine = claude.split("\n").find((l) => l.startsWith("- Settings live in"));
if (!settingsLine) problems.push("CLAUDE.md has no settings line");
else if (!settingsLine.includes("WIZARDINGCODE_MEM_SHARE_ROOTS") || !settingsLine.includes("narrow"))
  problems.push("CLAUDE.md's settings line does not name the two sharing keys as the exception that can only narrow");
if (problems.length > 0) {
  for (const problem of problems) console.log(problem);
  process.exit(1);
}
console.log(
  "ADR 0025: 20 rulings, 10 sections, the binding limit, part 6's duty and the six pinned types; README: the Sharing subsection; CLAUDE.md: the bullet and the settings line's exception",
);
