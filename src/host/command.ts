// `wizardingcode-mem serve host <verb>` (ADR 0033): the host's side of a team server. It is
// run through deploy/upgrade.sh, which finds the folder, takes the lock and keeps this binary
// in step with the image that runs. Three flags and no more: nothing on the command line or in
// the environment can replace the repository, the registry or the verifier.
import type { Deps } from "./deps.ts";
import { follow, upgrade } from "./follow.ts";
import { EXIT, EXIT_MEANING } from "./rule.ts";
import { status } from "./status.ts";

const USAGE = `Usage: wizardingcode-mem serve host status | follow [--dry-run] | upgrade --dir <folder>
       (run it through deploy/upgrade.sh, beside compose.yml)

  status              what runs, the last change, what waits, and one next command
  follow              the timer's verb: applies a signed release that does not migrate
  follow --dry-run    what follow would do; may download the candidate, changes nothing that runs
  upgrade             the operator's verb: applies a signed release across a migration too

Exit codes:
${Object.entries(EXIT_MEANING)
  .map(([code, meaning]) => `  ${code.padStart(2)}  ${meaning}`)
  .join("\n")}
`;

export async function hostCommand(argv: string[], deps: Deps): Promise<number> {
  const usage = (): number => {
    deps.err(USAGE.trimEnd());
    return EXIT.usage;
  };
  const [verb, ...rest] = argv;
  if (verb !== "status" && verb !== "follow" && verb !== "upgrade") return usage();
  let dir: string | undefined;
  let dryRun = false;
  let lock: "held" | "free" | undefined;
  for (let at = 0; at < rest.length; at++) {
    const word = rest[at];
    const value = rest[at + 1];
    if (word === "--dir" && value !== undefined && !value.startsWith("--")) {
      dir = value;
      at += 1;
    } else if (word === "--dry-run" && verb === "follow") {
      dryRun = true;
    } else if (word === "--lock" && verb === "status" && (value === "held" || value === "free")) {
      lock = value;
      at += 1;
    } else return usage();
  }
  if (dir === undefined || dir === "") return usage();
  if (verb === "status") return status(deps, dir, lock);
  return verb === "follow" ? follow(deps, dir, { dryRun }) : upgrade(deps, dir);
}
