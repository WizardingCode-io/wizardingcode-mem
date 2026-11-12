// What the setting and the environment allow of the release check. A leaf: the viewer and
// the commands that only read the notice load this rule without the file that asks.

export type Mode = "check" | "off" | "off-unknown" | "ci";

/** What the key's value and the environment allow; in doubt, no request. */
export function mode(value: string | null, env: Record<string, string | undefined>): Mode {
  if (value === "off") return "off";
  if (value !== null && value !== "check") return "off-unknown";
  return env.CI ? "ci" : "check";
}
