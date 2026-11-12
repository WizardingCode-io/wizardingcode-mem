// What the viewer says of a release (ADR 0030): the banner's line, the About card's status
// with its tone and sign, the agents' note, the channels' rows, the switch and the mark on
// the Settings list. Pure, so the tests drive it without a browser. No import from api.ts:
// it reads the page's location, and the tests load this file without one.
import type { ViewerUpdate } from "../../src/ui/update.ts";

/** `GET /api/update`: the server's own type, so the page and the route cannot drift apart. */
export type { ViewerUpdate };

/** How loud a status is: a warning, a plain fact, or something that is simply not on. */
export type Tone = "warn" | "quiet" | "muted";
/** What the status is about, for its icon: a release to get, something wrong, all well, nothing running. */
export type Sign = "out" | "problem" | "ok" | "idle";

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

/**
 * The card's status: the server's line, capitalised, with its tone and its sign. The one
 * line the page words itself is the setting that comes from the environment: the terminal
 * speaks of "this command", and here it is the viewer's own environment.
 */
export function releaseStatus(update: ViewerUpdate): { text: string; tone: Tone; sign: Sign } {
  const text =
    update.mode === "off" && update.fromEnvironment
      ? "Off (WIZARDINGCODE_MEM_UPDATE in the environment this viewer was started with)"
      : capitalised(update.line);
  if (update.out) return { text, tone: "warn", sign: "out" };
  if (!update.built) return { text, tone: "warn", sign: "problem" };
  if (update.mode !== "check") return { text, tone: "muted", sign: "idle" };
  if (update.failed) return { text, tone: "warn", sign: "problem" };
  return update.latest === null
    ? { text, tone: "muted", sign: "idle" }
    : { text, tone: "quiet", sign: "ok" };
}

/**
 * What the agents run, as a sentence of the card; null when the status line already says it
 * (a release is out and a staged copy exists), so the card does not say it twice.
 */
export function agentsNote(update: ViewerUpdate): string | null {
  if (update.agents === null) return null;
  return update.out && update.staged !== null ? null : capitalised(update.agents);
}

/** One row per channel: its name and an instruction start with a capital, a shell command is left as typed. */
export function channelRows(
  update: ViewerUpdate,
): { channel: string; text: string; shell: boolean }[] {
  return update.commands.map(({ channel, command, shell }) => ({
    channel: /^[a-z]+$/.test(channel) ? capitalised(channel) : channel,
    text: shell ? command : capitalised(command),
    shell,
  }));
}

/**
 * Whether the switch reads on: only while a check can run. An unknown value of the key turns
 * the check off, so the switch is off too. Before the report is read, the key's value decides.
 */
export function checksDaily(update: ViewerUpdate | null, value: string | null): boolean {
  if (update === null) return value !== "off";
  return update.mode === "check" || update.mode === "ci";
}

/** The Settings list's mark on About: there while a release is out, banner dismissed or not. */
export function aboutMark(update: ViewerUpdate | null): string | undefined {
  return update?.out === true ? "new" : undefined;
}
