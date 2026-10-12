import type { Kind, MemoryDetail } from "./api";

export const when = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";

/** A short date for dense rows: "Thu 1 Oct", with the year only when it is not this one. */
export const day = (ms: number): string => {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
};

export const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return when(ms);
};


export const IMPORTANCE_LABEL = ["", "Trivial", "Minor", "Useful", "Important", "Critical"];

/** A pill's colours: the soft fill and the text, as the brand's status pills pair them. */
export interface Tone {
  bg: string;
  fg: string;
}
const tone = (bg: string, fg: string): Tone => ({ bg: `var(--${bg})`, fg: `var(--${fg})` });

/** Each kind of memory as a pill, like Sales OS's pipeline stages. */
export const KIND_TONE: Record<Kind, Tone> = {
  decision: tone("blue-soft", "blue-text"),
  fix: tone("ok-soft", "ok"),
  gotcha: tone("warn-soft", "warn"),
  convention: tone("violet-soft", "violet-text"),
  change: tone("paper-sunken", "ink-muted"),
  discovery: tone("magenta-soft", "magenta-text"),
};

/** A turn's state as a pill. */
export const TURN_TONE: Record<string, Tone> = {
  done: tone("ok-soft", "ok"),
  failed: tone("danger-soft", "danger"),
  open: tone("blue-soft", "blue-text"),
  processing: tone("violet-soft", "violet-text"),
  pending: tone("warn-soft", "warn"),
  skipped: tone("paper-sunken", "ink-muted"),
};

/** Importance reads like a priority flag: colour and word. */
export const IMPORTANCE_COLOR = ["", "var(--line-strong)", "var(--line-strong)", "var(--blue-text)", "var(--warn)", "var(--danger)"];

/** A memory as a line of the notes the agent is shown. */
export function asNote(m: MemoryDetail): string {
  const files = m.files.length ? ` · ${m.files.join(", ")}` : "";
  const body = m.body ? `\n  ${m.body.split("\n").join("\n  ")}` : "";
  return `- #${m.id} [${m.kind} · ${new Date(m.createdAt).toISOString().slice(0, 10)}${files}] ${m.title}${body}`;
}

export const shortPath = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return (parts.length > 2 ? "…/" : "/") + parts.slice(-2).join("/");
};

export { describePrompt, type PromptLine, subagentReport } from "./prompt";

/** A turn's state as the Runs log shows it: sentence case, a dot whose shape carries it too. */
export const TURN_STATUS: Record<string, { label: string; tone: Tone; shape: "" | "square" | "diamond" }> = {
  done: { label: "Done", tone: { bg: "var(--ok-soft)", fg: "var(--ok)" }, shape: "" },
  skipped: { label: "Skipped", tone: { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" }, shape: "" },
  failed: { label: "Failed", tone: { bg: "var(--danger-soft)", fg: "var(--danger)" }, shape: "diamond" },
  open: { label: "Open", tone: { bg: "var(--blue-soft)", fg: "var(--blue-text)" }, shape: "" },
  processing: { label: "Distilling", tone: { bg: "var(--violet-soft)", fg: "var(--violet-text)" }, shape: "" },
  pending: { label: "Queued", tone: { bg: "var(--warn-soft)", fg: "var(--warn)" }, shape: "square" },
};

/** Clock time for today, a short date otherwise (the Runs log's first column). */
export const clock = (ms: number): string => {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/** A duration the way the Runs log writes it: 42 s, 2 min, 1.2 h. */
export const took = (from: number, to: number | null): string => {
  if (!to) return "…";
  const s = Math.max(0, (to - from) / 1000);
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
};

/** The agents' letter tiles, each in its hue (the brand's agent palette). */
export const AGENT_TILE: Record<string, { letter: string; bg: string }> = {
  "claude-code": { letter: "C", bg: "#FF3DCB" },
  "claude-desktop": { letter: "D", bg: "#FF3DCB" },
  codex: { letter: "X", bg: "#2E7BFF" },
  cursor: { letter: "U", bg: "#9B5CFF" },
  // Gemini CLI is no longer supported; its sessions stay in the store and keep their tile.
  gemini: { letter: "G", bg: "#2EE6C8" },
  opencode: { letter: "O", bg: "#FFC53D" },
  // The brand has five agent hues for eight agents, so hues repeat; the letter tells them apart.
  qwen: { letter: "Q", bg: "#2EE6C8" },
  droid: { letter: "F", bg: "#FFC53D" },
  copilot: { letter: "P", bg: "#2E7BFF" },
  antigravity: { letter: "A", bg: "#9B5CFF" },
};
export const compact = (n: number): string =>
  n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString("en-GB");

/** A project's tile hue, stable for its name: one of the brand's five agent hues. */
const HUES = ["#FF3DCB", "#9B5CFF", "#2E7BFF", "#FFC53D", "#2EE6C8"];
export const hue = (name: string): string =>
  HUES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length] as string;

// A project's pill in the tone of its tile hue: the soft fill and the readable text.
const SOFT: Record<string, Tone> = {
  "#FF3DCB": { bg: "var(--magenta-soft)", fg: "var(--magenta-text)" },
  "#9B5CFF": { bg: "var(--violet-soft)", fg: "var(--violet-text)" },
  "#2E7BFF": { bg: "var(--blue-soft)", fg: "var(--blue-text)" },
  "#FFC53D": { bg: "var(--warn-soft)", fg: "var(--warn)" },
  "#2EE6C8": { bg: "var(--ok-soft)", fg: "var(--ok)" },
};
export const projectTone = (name: string): Tone => SOFT[hue(name)] ?? { bg: "var(--paper-sunken)", fg: "var(--ink-muted)" };
