// The observed check of the sharing policy's preservation criterion: the four test files
// pass, and every snapshot the two snapshot files held at the item's base commit is byte for
// byte the same (snapshots another item adds beside them are allowed and counted). Exits 1 on
// a failing run or a changed snapshot.
//   ./node_modules/.bin/bun .crew/work/<item>/probes/check-preserve.ts <repository root>
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? process.cwd();
const item = "2026-11-09-002-sharing-policy-per-project-local-only-kn";
const work = JSON.parse(readFileSync(join(root, ".crew/work", item, "work.json"), "utf8")) as {
  baseCommit?: string;
};
const base = work.baseCommit;
if (!base) {
  console.log("the item records no base commit");
  process.exit(1);
}
const files = [
  "tests/unit/hook-snapshots.test.ts",
  "tests/unit/mcp-tools-list.test.ts",
  "tests/perf/budgets.test.ts",
  "tests/unit/module-migrations.test.ts",
];
const run = Bun.spawnSync([join(root, "node_modules/.bin/bun"), "test", ...files], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
  env: { ...process.env, WIZARDINGCODE_MEM_DISTILL: "off", WIZARDINGCODE_MEM_UI_AUTO_OPEN: "off" },
});
const output = `${run.stdout.toString()}${run.stderr.toString()}`;
console.log(output.split("\n").filter((l) => /^\s*\d+ (pass|fail)|snapshots/.test(l)).join("\n"));
if (run.exitCode !== 0) {
  console.log(`the four files did not pass (exit ${run.exitCode})`);
  process.exit(1);
}

/** Bun's snapshot file: one `exports[\`name\`] = \`value\`;` per snapshot. */
const entriesOf = (text: string) => {
  const map = new Map<string, string>();
  for (const m of text.matchAll(/^exports\[`([^`]+)`\] = `([\s\S]*?)`;$/gm)) map.set(m[1] as string, m[2] as string);
  return map;
};
const snapshots = [
  "tests/unit/__snapshots__/hook-snapshots.test.ts.snap",
  "tests/unit/__snapshots__/mcp-tools-list.test.ts.snap",
];
let failed = false;
for (const file of snapshots) {
  const shown = Bun.spawnSync(["git", "show", `${base}:${file}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (shown.exitCode !== 0) {
    console.log(`${file}: not readable at the base ${base.slice(0, 7)}: ${shown.stderr.toString().trim()}`);
    failed = true;
    continue;
  }
  const before = entriesOf(shown.stdout.toString());
  const after = entriesOf(readFileSync(join(root, file), "utf8"));
  const changed = [...before].filter(([name, value]) => after.get(name) !== value).map(([name]) => name);
  const added = [...after.keys()].filter((name) => !before.has(name));
  if (changed.length > 0) {
    console.log(`${file}: ${changed.length} snapshot(s) of the base changed or gone: ${changed.join("; ")}`);
    failed = true;
  } else {
    console.log(`${file}: the ${before.size} snapshots of the base ${base.slice(0, 7)} unchanged, ${added.length} added`);
  }
}
if (failed) process.exit(1);
