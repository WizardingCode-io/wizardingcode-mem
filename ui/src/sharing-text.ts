// The Sharing card's words for the sharing log (ADR 0027). A leaf with no imports, so the
// tests run it as the card does.

/**
 * What a `server:<id>` change row says: a mute logs `mute` (or `mute:<member>`) as its new
 * value and an unmute the same as its old one; an add logs the host as the new value and a
 * removal the host as the old one.
 */
export const serverChange = (name: string, old: string, next: string): string => {
  const mute = /^mute(?::(.+))?$/;
  const who = (mark: RegExpExecArray) => (mark[1] ? `member ${mark[1]} of ` : "");
  const muted = mute.exec(next);
  if (muted !== null) return `${who(muted)}server ${name} muted`;
  const unmuted = mute.exec(old);
  if (unmuted !== null) return `${who(unmuted)}server ${name} unmuted`;
  return `server ${name} ${next === "" ? "removed" : "added"}`;
};
