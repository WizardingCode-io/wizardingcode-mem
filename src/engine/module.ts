import type { ToolContext } from "../mcp/tools.ts";
import type { Db } from "../store/db.ts";

// What a module is to the engine: something that may add context at each injection
// moment, and later its own tools and views. The hooks ask every module through the
// composer; none of them is called directly.

/** The hook events that may put context in front of the agent. */
export type Moment = "session-start" | "prompt" | "file-read" | "tool-failed";

export interface MomentInput {
  db: Db;
  moment: Moment;
  projectId: number;
  branch: string | null;
  /** The directory the agent works in (the hook's cwd). */
  root: string;
  sessionId: number;
  /** The session's context epoch, already advanced when the context was cleared or compacted. */
  epoch: number;
  /** Only on "prompt". */
  prompt: string | null;
  /** Only on "file-read": the file read, relative to the project, with forward slashes. */
  path: string | null;
  /** Only on "tool-failed": what the host says went wrong. */
  error: string | null;
  now: number;
  /** This module's share of the moment's budget, in characters. */
  budgetChars: number;
}

/** Text already rendered in the module's own wrapper; null or "" contributes nothing. */
export type Contribution = string | null;

export interface ModuleTool {
  name: string;
  description: string;
  inputSchema: unknown;
  run(args: unknown): Promise<string> | string;
}

export interface ModuleView {
  tab: string;
  label: string;
  icon: string;
  key: string;
}

export interface EngineModule {
  id: string;
  name: string;
  /**
   * The part of each moment's budget the module asks for, 0..1, capped by the composer; or
   * "remainder": whatever the other modules leave (memory's, so that alone it keeps the
   * whole budget). A module without `contribute` takes nothing.
   */
  share: number | "remainder";
  /**
   * Must fit `budgetChars`, measuring before it records anything as shown; may throw, and
   * the composer contains it. A contribution longer than the budget is dropped as a safety net.
   */
  contribute?(input: MomentInput): Contribution;
  tools?(context: ToolContext, mode: "project" | "global"): ModuleTool[];
  views?: ModuleView[];
}
