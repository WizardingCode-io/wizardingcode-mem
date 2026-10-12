import { describe, expect, test } from "bun:test";
import { type ModuleInfo, railViews, viewKeys } from "../../ui/src/modules.ts";

// The rail draws the enabled modules' views, in module order, and their keys switch to them.

const memory: ModuleInfo = {
  id: "memory",
  name: "Memory",
  views: [
    { tab: "memories", label: "Memories", icon: "i-lucide-sticky-note", key: "1" },
    { tab: "turns", label: "Turns", icon: "i-lucide-history", key: "2" },
    { tab: "projects", label: "Across projects", icon: "i-lucide-link-2", key: "6" },
  ],
};
const echo: ModuleInfo = {
  id: "echo",
  name: "Echo",
  views: [{ tab: "echo", label: "Echo", icon: "i-lucide-radio", key: "7" }],
};

describe("the rail's views", () => {
  test("every enabled module's views, in module order", () => {
    expect(railViews([memory, echo]).map((v) => v.tab)).toEqual([
      "memories",
      "turns",
      "projects",
      "echo",
    ]);
  });

  test("no modules, no views; the fixture's view only when it is listed", () => {
    expect(railViews([])).toEqual([]);
    expect(railViews([memory]).map((v) => v.tab)).not.toContain("echo");
  });

  test("a tab or a key already taken by an earlier view is not drawn twice; 5 stays Settings", () => {
    const clash: ModuleInfo = {
      id: "clash",
      name: "Clash",
      views: [
        { tab: "turns", label: "Again", icon: "i-lucide-radio", key: "8" },
        { tab: "other", label: "Other", icon: "i-lucide-radio", key: "1" },
        { tab: "fifth", label: "Fifth", icon: "i-lucide-radio", key: "5" },
      ],
    };
    expect(railViews([memory, clash])).toEqual([
      ...memory.views,
      { tab: "other", label: "Other", icon: "i-lucide-radio", key: "" },
      { tab: "fifth", label: "Fifth", icon: "i-lucide-radio", key: "" },
    ]);
  });

  test("the keys: each view's, and 5 for Settings", () => {
    expect(viewKeys(railViews([memory, echo]))).toEqual({
      "1": "memories",
      "2": "turns",
      "6": "projects",
      "7": "echo",
      "5": "settings",
    });
  });
});
