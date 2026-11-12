// The change log's line for a person (ADR 0028). A leaf with no import: the CLI's
// `share status` and the viewer's Sharing page render one rule.

/** What the log holds in `what` for a project's shared name: `name:<project id>`. */
const NAME_CHANGE = /^name:(\d+)$/;
/**
 * What the log holds in `what` for a project's level: `project:<project id>`, with the server's
 * id after `@` once the level is bound to one (ADR 0027).
 */
const LEVEL_CHANGE = /^project:(\d+)(?:@[^@]*)?$/;

/** The project a level change is of, by id; null for any other row. */
export function projectOfChange(what: string): number | null {
  const match = LEVEL_CHANGE.exec(what);
  return match === null ? null : Number(match[1]);
}

/**
 * One change as a line: a shared name names its project (`shared name of <project>: <old or
 * none> → <new or none>`); every other change reads `<what> <old> → <new>`, as before.
 */
export function formatChange(
  row: { what: string; old: string; new: string },
  projectName: (id: number) => string | null,
): string {
  const name = NAME_CHANGE.exec(row.what);
  if (name === null) return `${row.what} ${row.old} → ${row.new}`;
  const id = Number(name[1]);
  const side = (value: string) => (value === "" ? "none" : value);
  return `shared name of ${projectName(id) ?? `project ${id}`}: ${side(row.old)} → ${side(row.new)}`;
}
