import type { SkipReason } from "./pipeline.ts";

/** Skipped turns counted by why they were skipped (`SkipReason`). */
export interface SkippedBy {
  saved: number;
  empty: number;
  notWorth: number;
  noTitle: number;
}

/** Each reason's key in `SkippedBy` and its stored value (`skip:<reason>`, see `skipMark`). */
export const SKIPPED_KEY: Record<SkipReason, keyof SkippedBy> = {
  saved: "saved",
  empty: "empty",
  "not-worth": "notWorth",
  "no-title": "noTitle",
};

export const noneSkipped = (): SkippedBy => ({ saved: 0, empty: 0, notWorth: 0, noTitle: 0 });

/**
 * "3 skipped (empty 1, no-title 2)": the reasons that occurred, in a fixed order; `unknown`
 * counts skipped turns with no reason stored (skipped before reasons were kept).
 */
export function skippedText(skipped: number, by: SkippedBy & { unknown?: number }): string {
  const parts: [string, number][] = (
    Object.entries(SKIPPED_KEY) as [SkipReason, keyof SkippedBy][]
  ).map(([reason, key]) => [reason, by[key]]);
  if (by.unknown !== undefined) parts.push(["unknown", by.unknown]);
  const named = parts.filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`);
  return named.length === 0 ? `${skipped} skipped` : `${skipped} skipped (${named.join(", ")})`;
}
