import type { EngineModule } from "../../engine/module.ts";
import { contribute } from "./contribute.ts";
import { KNOWLEDGE_SHARE } from "./policy.ts";

// Knowledge as a module: what the team wrote on purpose, beside memory's notes, within a
// fifth of each moment's budget. Memory gets back whatever knowledge does not write (F5′).

export const knowledge: EngineModule = {
  id: "knowledge",
  name: "Knowledge",
  share: KNOWLEDGE_SHARE,
  contribute,
  views: [],
};
