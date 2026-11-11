// The one function that renders a member's or a server's name for an agent: a name is
// a teammate's own text, so it is never put into a prompt or a commit message as it came.
import { clip } from "../util/text.ts";

/** The control characters a name or a path never carries into a line of text. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is matched.
export const CONTROL = /[\x00-\x1f\x7f]/g;

export const AGENT_NAME_MAX = 80;

/** The name with its control characters removed, trimmed and clipped at 80 characters. */
export function agentName(name: string): string {
  return clip(name.replace(CONTROL, "").trim(), AGENT_NAME_MAX);
}
