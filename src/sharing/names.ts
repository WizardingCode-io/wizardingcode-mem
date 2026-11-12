// The name of a project (ADR 0028): the shared name a text makes, and the one a project
// carries. The slug is the knowledge store's, without its fallbacks: a text that makes no
// slug, or a reserved file name, is refused, never changed behind the person's back.
import {
  hasLetterOrDigit,
  isSharedName,
  isSharedSlug,
  NAME_PREFIX,
  RESERVED,
} from "../core/identity.ts";
import { slugCore } from "../modules/knowledge/entry.ts";

/** The alias a text makes, or why it makes none: `word` names the reserved file name it hit. */
export type SharedNameOutcome =
  | { ok: true; alias: string }
  | { ok: false; reason: "no-name"; word?: string };

/** `name:<slug>` for a text a shared slug can be made of; `no-name` otherwise. */
export function sharedNameOf(text: string): SharedNameOutcome {
  if (!hasLetterOrDigit(text)) return { ok: false, reason: "no-name" };
  const slug = slugCore(text);
  if (RESERVED.test(slug)) return { ok: false, reason: "no-name", word: slug };
  if (!isSharedSlug(slug)) return { ok: false, reason: "no-name" };
  return { ok: true, alias: `${NAME_PREFIX}${slug}` };
}

/** The one shared name among a project's aliases, or null. */
export function nameOf(aliases: readonly string[]): string | null {
  return aliases.find(isSharedName) ?? null;
}

/**
 * Why a text makes no shared name, as the person reads it: the reserved file name is named
 * when that is the reason. One sentence for the CLI and the viewer.
 */
export function noNameMessage(
  text: string,
  outcome: Extract<SharedNameOutcome, { ok: false }>,
): string {
  return outcome.word === undefined
    ? `no shared name can be made of \`${text}\`; use letters or digits`
    : `no shared name can be made of \`${text}\`: \`${outcome.word}\` is a reserved file name; pick another`;
}
