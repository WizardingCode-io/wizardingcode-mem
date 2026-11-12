const START = "# True when version $1 is missing or older than $2";

/**
 * The shell `older()` of a script, with its comment: from the line that starts with the
 * comment's first words through the first following line that is exactly `}`.
 */
export function shellOlderBlock(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(START));
  if (start === -1) throw new Error("no older() comment in this script");
  const end = lines.findIndex((line, index) => index > start && line === "}");
  if (end === -1) throw new Error("older() is not closed in this script");
  return lines.slice(start, end + 1).join("\n");
}
