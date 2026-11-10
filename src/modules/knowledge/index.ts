import type { EngineModule } from "../../engine/module.ts";
import { contribute } from "./contribute.ts";
import { KNOWLEDGE_SHARE } from "./policy.ts";

// Knowledge as a module: what the team wrote on purpose, beside memory's notes, within a
// fifth of each moment's budget. Memory gets back whatever knowledge does not write (F5′).

/** What the model is told with no project folder: the global tools read no project's repository. */
const GLOBAL_INSTRUCTIONS =
  "Team knowledge is in knowledge_search and knowledge_get; outside a project they read the workspace and the shared repositories only.";

export const knowledge: EngineModule = {
  id: "knowledge",
  name: "Knowledge",
  share: KNOWLEDGE_SHARE,
  contribute,
  // Loaded only when a server or the bridge asks: the hooks never pay for zod or the tools.
  tools: async (mode) => (await import("./tools.ts")).knowledgeTools(mode),
  globalInstructions: GLOBAL_INSTRUCTIONS,
  views: [],
};
