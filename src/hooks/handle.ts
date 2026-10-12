import { posix } from "node:path";
import type { AgentAdapter, HookInput } from "../adapters/types.ts";
import { relativeTo, rootsOf } from "../core/paths.ts";
import { resolveProject } from "../core/project.ts";
import { type Redacted, redact } from "../core/redact.ts";
import { compose } from "../engine/compose.ts";
import type { EngineModule } from "../engine/module.ts";
import { memory } from "../modules/memory/index.ts";
import { failureQuery } from "../retrieve/failure.ts";
import { type Db, withWrite } from "../store/db.ts";
import { drainActive } from "../store/meta.ts";
import { advanceEpoch, endSession, touchSession } from "../store/sessions.ts";
import {
  abandonStaleTurns,
  completeTurn,
  hasOpenTurn,
  hasQueuedTurns,
  interruptOpenTurns,
  openTurn,
  type TurnContext,
} from "../store/turns.ts";
import { clip } from "../util/text.ts";

export interface HookDeps {
  db: Db;
  now: () => number;
  /** Starts background distillation and returns at once. */
  spawnDistill: () => void;
  /** Shows the viewer, or starts it, in the background; absent where no one would see it. */
  spawnViewer?: () => void;
  /** Whether a scheduled backup should happen now. */
  backupDue?: () => boolean;
  /** Starts one in the background and returns at once. */
  spawnBackup?: () => void;
  /** Indexes one finished session's transcript in the background; absent when there is no history index. */
  spawnHistoryIndex?: (transcriptPath: string, agent: string) => void;
  /** Told about failures that were contained here rather than thrown. */
  onError?: (error: unknown) => void;
}

/** No turn runs this long: one still open after it belongs to a session that died. */
const ABANDONED_AFTER_MS = 12 * 3_600_000;
/** The modules asked at each moment, in this order. */
const MODULES: readonly EngineModule[] = [memory];
export const PROMPT_MAX_CHARS = 8 * 1024;
export const FINAL_TEXT_MAX_CHARS = 16 * 1024;

/** Redacts first, then cuts: cutting first could leave half a secret unrecognised. */
export function stored(text: string, max: number): Redacted {
  return clip(redact(text), max, "…") as Redacted;
}

/**
 * Handles one hook event and returns exactly what to print to the host.
 * Throwing is allowed here; the command that calls this turns any failure into silence.
 */
export function handleHook(deps: HookDeps, adapter: AgentAdapter, input: HookInput): string {
  const { db } = deps;
  const now = deps.now();

  const project = resolveProject(db, input.cwd, now);
  if (project.disabled) return "";

  const session = touchSession(db, {
    agent: input.agent,
    agentSessionId: input.sessionId,
    projectId: project.id,
    cwd: input.cwd,
    branch: project.branch,
    now,
  });
  const turn: TurnContext = {
    sessionId: session.id,
    projectId: project.id,
    agentTurnId: input.turnId,
    transcriptPath: input.transcriptPath,
    branch: project.branch,
    commit: project.commit,
    now,
  };

  // Looking things up comes after capturing, and its failure is contained: a turn
  // must not be lost because retrieval broke.
  const lookUp = (find: () => string | null): string | null => {
    try {
      return find();
    } catch (error) {
      deps.onError?.(error);
      return null;
    }
  };
  let context: string | null = null;

  // What every module may add, for this session and project; each moment fills in the rest.
  const moment = {
    db,
    projectId: project.id,
    branch: project.branch,
    root: input.cwd,
    sessionId: session.id,
    epoch: session.contextEpoch,
    prompt: null,
    path: null,
    error: null,
    now,
  };
  const onModuleError = (_module: string, error: unknown) => deps.onError?.(error);

  switch (input.event) {
    case "session-start": {
      withWrite(db, () => abandonStaleTurns(db, now, ABANDONED_AFTER_MS));
      // A resumed session still has its context; a cleared or compacted one has lost it.
      if (input.source === "resume" || !adapter.capabilities.sessionInjection) break;
      context = lookUp(() => {
        const wiped = input.source === "clear" || input.source === "compact";
        const epoch = wiped ? advanceEpoch(db, session.id) : session.contextEpoch;
        return compose(MODULES, { ...moment, moment: "session-start", epoch }, onModuleError);
      });
      break;
    }
    case "prompt": {
      const prompt = input.prompt;
      if (prompt === null) break;
      withWrite(db, () => {
        interruptOpenTurns(db, session.id, now, input.turnId);
        openTurn(db, turn, stored(prompt, PROMPT_MAX_CHARS));
      });
      if (!adapter.capabilities.promptInjection) break;
      context = lookUp(() =>
        compose(MODULES, { ...moment, moment: "prompt", prompt }, onModuleError),
      );
      break;
    }
    case "file-read": {
      // Like the prompt: this output is injected context, and a host that cannot inject gets nothing.
      const file = input.toolFile;
      if (file === null || !adapter.capabilities.promptInjection) break;
      context = lookUp(() => {
        // Resolved first, so that a path with `..` is judged by where it points.
        const normalised = posix.normalize(file.replaceAll("\\", "/"));
        const [path] = relativeTo(rootsOf(input.cwd), [normalised]);
        if (path === undefined) return null;
        return compose(MODULES, { ...moment, moment: "file-read", path }, onModuleError);
      });
      break;
    }
    case "tool-failed": {
      // Gated like file-read: the notes are injected context.
      const error = input.toolError;
      if (error === null || !adapter.capabilities.promptInjection) break;
      if (failureQuery(error) === "") break;
      context = lookUp(() =>
        compose(MODULES, { ...moment, moment: "tool-failed", error }, onModuleError),
      );
      break;
    }
    case "turn-end":
      withWrite(db, () => {
        // An ending that brings nothing (no final message, no turn named, no transcript to
        // read) and finds no turn open would only queue an empty turn to distil.
        const empty =
          input.finalText === null && input.turnId === null && !adapter.capabilities.transcript;
        if (empty && !hasOpenTurn(db, session.id)) return;
        completeTurn(
          db,
          turn,
          input.finalText === null ? null : stored(input.finalText, FINAL_TEXT_MAX_CHARS),
        );
      });
      break;
    case "session-end":
      // When the user interrupts, no turn-end arrives; this event still does.
      withWrite(db, () => {
        interruptOpenTurns(db, session.id, now);
        endSession(db, session.id, now);
      });
      break;
  }

  // Starting background work must never cost the agent its context, or the hook its exit.
  try {
    // Tool-call events fire per call and start no background work of their own.
    const quiet = input.event === "file-read" || input.event === "tool-failed";
    if (!quiet && hasQueuedTurns(db, now) && !drainActive(db, now)) deps.spawnDistill();
  } catch (error) {
    deps.onError?.(error);
  }
  // A new session is when the viewer should be there; a resumed one already has it.
  if (input.event === "session-start" && input.source !== "resume") {
    try {
      deps.spawnViewer?.();
    } catch (error) {
      deps.onError?.(error);
    }
  }
  // Backups wait for the end of a turn or a session: the events with time to spare.
  if (input.event === "turn-end" || input.event === "session-end") {
    try {
      if (deps.backupDue?.()) deps.spawnBackup?.();
    } catch (error) {
      deps.onError?.(error);
    }
  }
  if (
    input.event === "session-end" &&
    input.transcriptPath !== null &&
    (input.agent === "claude-code" || input.agent === "codex")
  ) {
    try {
      deps.spawnHistoryIndex?.(input.transcriptPath, input.agent);
    } catch (error) {
      deps.onError?.(error);
    }
  }
  return adapter.render(input.event, context, input);
}
