import type { ModuleView } from "../../engine/module.ts";

// Memory's buttons in the viewer's rail. A leaf, with no runtime imports: the viewer's build
// reads it to bundle these icons (nothing is fetched from the network at run time).

export const MEMORY_VIEWS: readonly ModuleView[] = [
  { tab: "memories", label: "Memories", icon: "i-lucide-sticky-note", key: "1" },
  { tab: "turns", label: "Turns", icon: "i-lucide-history", key: "2" },
  { tab: "overview", label: "Overview", icon: "i-lucide-chart-column", key: "3" },
  { tab: "history", label: "History", icon: "i-lucide-messages-square", key: "4" },
  { tab: "projects", label: "Across projects", icon: "i-lucide-link-2", key: "6" },
];
