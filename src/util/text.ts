/** Cuts `text` to at most `max` UTF-16 units without splitting a surrogate pair. */
export function clip(text: string, max: number, ellipsis = ""): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - ellipsis.length);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return text.slice(0, end) + ellipsis;
}

/** A count with its noun: `1 change`, `2 changes`; `1 entry`, `2 entries` with the plural given. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
