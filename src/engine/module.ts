import type { ZodType } from "zod";
import type { Db } from "../store/db.ts";

// What a module is to the engine: something that may add context at each injection
// moment, the tools it offers the agent and the views it adds to the viewer. The hooks ask
// every module through the composer, the MCP server and the `tool` bridge list the enabled
// modules' tools, and the viewer draws their views; none of them is named directly.

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

/**
 * Inside a project, or with no project folder (`mcp --global`, Claude Desktop's chat):
 * the tools offered in each are listed separately.
 */
export type ToolMode = "project" | "global";

/** Where one call was made: the project's folder, or null in global mode. */
export interface ToolCall {
  projectDir: string | null;
}

export interface ModuleTool {
  name: string;
  /** Sent to the model in every session: one sentence. */
  description: string;
  /** The arguments' schema; the caller validates against it before `run`. */
  inputSchema: ZodType;
  /** How the tool is shown to people. */
  title?: string;
  /** Whether it only reads: hosts that ask before a tool runs can tell a lookup from a write. */
  annotations?: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  /** Runs one validated call and answers in text; throws on failure. */
  run(args: unknown, call: ToolCall): Promise<string> | string;
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
  /**
   * The tools offered in this mode, in order; none when absent. Called once per server or
   * bridge run, never on the hook path; a module loads what its tools need here.
   */
  tools?(mode: ToolMode): Promise<ModuleTool[]> | ModuleTool[];
  /** The viewer's rail buttons for this module, in order. */
  views?: ModuleView[];
}
