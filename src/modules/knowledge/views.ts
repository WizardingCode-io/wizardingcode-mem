import type { ModuleView } from "../../engine/module.ts";

// Knowledge's button in the viewer's rail. A leaf, with no runtime imports: the viewer's build
// reads it to bundle the icon (nothing is fetched from the network at run time).

export const KNOWLEDGE_VIEWS: readonly ModuleView[] = [
  { tab: "knowledge", label: "Knowledge", icon: "i-lucide-book-open", key: "7" },
];
