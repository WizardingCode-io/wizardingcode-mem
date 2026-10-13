import { type Check, runChecks } from "../../doctor/checks.ts";
import { doctorContext } from "../../doctor/context.ts";
import { defaultDataDir } from "../../util/paths.ts";

const LABEL: Record<Check["status"], string> = {
  ok: "ok  ",
  warn: "warn",
  fail: "FAIL",
  skip: "skip",
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** `wizardingcode-mem doctor`: checks the installation and says what to do about anything wrong. */
export function run(): number {
  const checks = runChecks(doctorContext(defaultDataDir()));
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  const summary =
    failures + warnings === 0
      ? "All checks passed."
      : [
          failures > 0 ? plural(failures, "failure") : "",
          warnings > 0 ? plural(warnings, "warning") : "",
        ]
          .filter((part) => part !== "")
          .join(", ")
          .concat(".");
  process.stdout.write(
    `${checks.map((check) => `${LABEL[check.status]}  ${check.name}: ${check.detail}`).join("\n")}\n\n${summary}\n`,
  );
  return failures > 0 ? 1 : 0;
}
