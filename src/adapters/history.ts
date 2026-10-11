import type { AgentId } from "../core/types.ts";
import type { TurnDetail } from "./types.ts";

/** One finished turn read back from an agent's transcript. Nothing here is redacted. */
export interface HistoryTurn {
  agent: AgentId;
  sessionId: string;
  turnId: string;
  cwd: string;
  branch: string | null;
  prompt: string;
  finalText: string | null;
  /** Milliseconds since the epoch. */
  startedAt: number;
  endedAt: number;
  transcriptPath: string;
  detail: TurnDetail;
}
