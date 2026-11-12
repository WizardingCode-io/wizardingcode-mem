// What the viewer says of a release (ADR 0030): the banner's line, the About card's status
// with its tone, and the mark on the Settings list. Pure, so the tests drive it without a
// browser. No import from api.ts: it reads the page's location, and the tests load this
// file without one.

/** `GET /api/update`, as src/ui/update.ts answers it; api.ts re-exports the type. */
export interface ViewerUpdate {
  running: string;
  staged: string | null;
  latest: string | null;
  checkedAt: number | null;
  failedAt: number | null;
  reason: string | null;
  mode: "check" | "off" | "off-unknown" | "ci";
  out: boolean;
  /** What `wizardingcode-mem status` says of the release, without its label. */
  line: string;
  /** What the agents run, when it is another copy than this viewer's. */
  agents: string | null;
  commands: { channel: string; command: string; shell: boolean }[];
  fromEnvironment: boolean;
  banner: boolean;
}

/** How loud a status is: a warning, a plain fact, or something that is simply not on. */
export type Tone = "warn" | "quiet" | "muted";

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The banner: the release, and who runs what. One line; the page truncates it. */
export function bannerLine(update: ViewerUpdate): string {
  const who =
    update.staged !== null ? `The agents run ${update.staged}.` : `This copy is ${update.running}.`;
  return `wizardingcode-mem ${update.latest} is out. ${who}`;
}

/** The banner where a phone's width leaves room for a few words: the release alone. */
export function bannerShort(update: ViewerUpdate): string {
  return `${update.latest} is out.`;
}

/** The server's prefix for a report it could not build (src/ui/update.ts). */
const NOT_BUILT = "not checked: ";

/**
 * The card's status: the server's own line, capitalised, with its tone. A release out, a
 * last check that failed and a report that could not be built are warnings; a check that is
 * off or has not run yet is muted; the rest is a plain fact.
 */
export function releaseStatus(update: ViewerUpdate): { text: string; tone: Tone } {
  const text = capitalised(update.line);
  if (update.out || update.line.startsWith(NOT_BUILT)) return { text, tone: "warn" };
  if (update.mode !== "check") return { text, tone: "muted" };
  const failed =
    update.failedAt !== null && (update.checkedAt === null || update.failedAt > update.checkedAt);
  if (failed) return { text, tone: "warn" };
  return { text, tone: update.latest === null ? "muted" : "quiet" };
}

/** The agents' line as a sentence of the card. */
export function agentsNote(update: ViewerUpdate): string | null {
  return update.agents === null ? null : capitalised(update.agents);
}

/** The Settings list's mark on About: there while a release is out, banner dismissed or not. */
export function aboutMark(update: ViewerUpdate | null): string | undefined {
  return update?.out === true ? "new" : undefined;
}
