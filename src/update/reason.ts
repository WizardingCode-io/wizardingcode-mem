/** An error as one line a person can read: its code when it has one, else its first line. */
export function reason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code !== "") return code;
  return (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
}

/** The first line of an error's message, whatever its code. */
export function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
}
