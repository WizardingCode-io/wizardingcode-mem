const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/** True for `<major>.<minor>.<patch>` with an optional pre-release, the shape a binary prints. */
export function isVersion(text: string): boolean {
  return VERSION.test(text);
}

/**
 * `<major>.<minor>.<patch>` and nothing else, each number of at most five digits. Narrower
 * than `isVersion` on purpose: for text that comes from the network or from a file a person
 * can write, and may end up on a terminal.
 */
const PLAIN_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
export function isPlainVersion(text: string): boolean {
  return PLAIN_VERSION.test(text);
}

/** The highest of some versions by that order, or undefined for none. */
export function highestVersion(versions: readonly string[]): string | undefined {
  return [...versions].sort((a, b) => Bun.semver.order(b, a))[0];
}

/**
 * True when `have` is missing, not a version, or older than `wanted` by semantic versioning's
 * order. The same rule as the JavaScript and shell `older()` the plugins and the installers
 * carry; tests/fixtures/version-order.ts holds the three equal.
 */
export function olderThan(have: string | null, wanted: string): boolean {
  if (have === null || !isVersion(have)) return true;
  return Bun.semver.order(have, wanted) < 0;
}
