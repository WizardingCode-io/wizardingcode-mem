// A project's identities (ADR 0028): the kinds an alias in `project_aliases` can be, which of
// them a team may know a project by, and the two slug grammars. A leaf with no import: the
// sharing policy, the team server's contract, the sync's naming and the knowledge store's
// entry module all read one rule from here, and the SQL prefilters take their fragment from
// here, so a third identity later is one entry in `ALIAS_KINDS` (with its own grammar check
// in `isTeamAlias` when it needs one), not a pass over twenty files.

export type AliasKind = "remote" | "name" | "gitdir" | "path" | "imported";

/** Each kind, with whether a team may know a project by an alias of it (a remote only when host-led). */
export const ALIAS_KINDS: Readonly<Record<AliasKind, { team: boolean }>> = {
  remote: { team: true },
  name: { team: true },
  gitdir: { team: false },
  path: { team: false },
  imported: { team: false },
};

export const REMOTE_PREFIX = "remote:";
export const NAME_PREFIX = "name:";

/** Each kind's prefix is its name and a colon; the table is the one list. */
const KINDS = Object.keys(ALIAS_KINDS) as AliasKind[];
const PREFIXES: readonly [AliasKind, string][] = KINDS.map((kind) => [kind, `${kind}:`]);
/** The kinds a team may know a project by. */
const TEAM_KINDS = KINDS.filter((kind) => ALIAS_KINDS[kind].team);

/** The kind of an alias by its prefix; null for an alias of no kind. */
export function aliasKind(alias: string): AliasKind | null {
  for (const [kind, prefix] of PREFIXES) if (alias.startsWith(prefix)) return kind;
  return null;
}

// --- The slug grammars ------------------------------------------------------------------

/** A knowledge slug: lower-case letters, digits and hyphens, starting with a letter or a digit. */
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const SLUG_MAX = 80;
/** File names Windows refuses, whatever the extension. */
export const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
/** A shared name's slug: a knowledge slug with no leading, trailing or double hyphen. */
export const SHARED_SLUG = /^[a-z0-9](?:-?[a-z0-9])*$/;

/** Whether a value is a shared name's slug: `SHARED_SLUG`, at most `SLUG_MAX`, not reserved. */
export function isSharedSlug(slug: string): boolean {
  return SHARED_SLUG.test(slug) && slug.length <= SLUG_MAX && !RESERVED.test(slug);
}

/** Whether a letter or a digit survives the marks and the case: what a slug can be made of. */
export function hasLetterOrDigit(text: string): boolean {
  return /[a-z0-9]/.test(
    text
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase(),
  );
}

// --- The predicates -------------------------------------------------------------------

/** A host name of dotted labels (letters, digits, hyphens), with a port or without. */
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i;

/**
 * Whether an alias names a project for a team by its git remote: a `remote:` alias whose
 * normalized remote begins with a host name, as `remote:github.com/acme/site` does. A remote
 * that is a local path or a `file://` origin (`normalizeRemote` leaves those as the path) names
 * a folder on this machine, never a project a team shares, so a level is never bound to it.
 */
export function isHostLedAlias(alias: string): boolean {
  if (!alias.startsWith(REMOTE_PREFIX)) return false;
  const remote = alias.slice(REMOTE_PREFIX.length);
  const slash = remote.indexOf("/");
  return HOST.test(slash === -1 ? remote : remote.slice(0, slash));
}

/** Whether an alias is a shared name: `name:` followed by a shared slug. */
export function isSharedName(alias: string): boolean {
  return alias.startsWith(NAME_PREFIX) && isSharedSlug(alias.slice(NAME_PREFIX.length));
}

/**
 * Whether a team may know a project by an alias: a kind the table marks `team`, held to its
 * grammar (a remote only when host-led, a name only when its slug is a shared slug).
 */
export function isTeamAlias(alias: string): boolean {
  const kind = aliasKind(alias);
  if (kind === null || !ALIAS_KINDS[kind].team) return false;
  if (kind === "remote") return isHostLedAlias(alias);
  if (kind === "name") return isSharedName(alias);
  return true;
}

/** The alias without its team prefix, for a folder's slug; any other alias as it is. */
export function stripTeamPrefix(alias: string): string {
  const kind = aliasKind(alias);
  return kind !== null && ALIAS_KINDS[kind].team ? alias.slice(kind.length + 1) : alias;
}

/**
 * The SQL prefilter a reader of `project_aliases` applies before judging each row with
 * `isTeamAlias` in code, built from the table: `substr`, not `LIKE`, so no case folding lets
 * `Remote:` through.
 */
export const TEAM_ALIAS_SQL = `(${TEAM_KINDS.map(
  (kind) => `substr(alias, 1, ${kind.length + 1}) = '${kind}:'`,
).join(" OR ")})`;
