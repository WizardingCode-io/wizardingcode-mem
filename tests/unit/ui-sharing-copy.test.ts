// The Sharing page and the project dock's Sharing section say what the design says, word
// for word. The Vue sources are read as text, and so is the built page when there is one:
// what is pinned here is that the sentences are there, not what a browser draws.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const at = (path: string) => join(ROOT, path);
/** A source file's text; empty when the file is not there, so each case fails on its own. */
const source = (path: string) => (existsSync(at(path)) ? readFileSync(at(path), "utf8") : "");

const SHARING = "ui/src/components/settings/Sharing.vue";
const TEAM = "ui/src/components/settings/Team.vue";
const BUILT = "src/ui/dist/index.html";

const sharing = source(SHARING);
const settingsPage = source("ui/src/components/Settings.vue");
const projects = source("ui/src/components/ProjectsView.vue");
const client = source("ui/src/api.ts");
const settingsState = source("ui/src/settings.ts");

describe("the Settings page", () => {
  test("has the Sharing page where the Collaboration card was", () => {
    expect(existsSync(at(TEAM))).toBe(false);
    expect(existsSync(at(SHARING))).toBe(true);
    expect(settingsPage).toContain('id: "sharing", label: "Sharing", icon: "i-lucide-share-2"');
    expect(settingsPage).toContain('import Sharing from "./settings/Sharing.vue"');
    expect(settingsPage).toContain("<Sharing v-else-if=\"page === 'sharing'\" />");
    expect(settingsPage).not.toContain('"team"');
    expect(settingsPage).not.toContain("Team.vue");
    expect(settingsPage).not.toContain("Collaboration");
    expect(settingsPage).not.toContain('meta: "soon"');
  });

  test("says what the environment does to the sharing settings", () => {
    expect(settingsPage).toContain(
      "The environment wins over the file; for sharing it can only narrow.",
    );
    expect(settingsPage).not.toContain("always wins");
  });
});

describe("the Sharing page", () => {
  test("is the card with the design's description", () => {
    expect(sharing).toContain('id="sharing"');
    expect(sharing).toContain('title="Sharing"');
    expect(sharing).toContain(
      "What may leave this machine for your team's server. Nothing leaves until you choose it here, and nothing is sent until a team server is configured.",
    );
    expect(sharing).not.toContain("soon");
  });

  test("names the two roots, with what each one is", () => {
    expect(sharing).toContain("Workspace knowledge");
    expect(sharing).toContain(
      "Your cross-project entries. Its areas below also govern every project's knowledge.",
    );
    expect(sharing).toContain("Shared repository knowledge");
    expect(sharing).toContain("The repository written for the team.");
  });

  test("says each state in the design's words", () => {
    for (const text of [
      "Loading…",
      "not in the taxonomy; ignored",
      "No taxonomy yet: write a knowledge entry first.",
      "Set by the environment.",
      "Sharing saved",
      "Sharing not saved",
    ]) {
      expect(sharing).toContain(text);
    }
  });

  test("carries the statements, whole", () => {
    for (const text of [
      "Memories have no area",
      "New areas start private",
      "Lowering a level recalls nothing already sent",
      "governs the team server only",
    ]) {
      expect(sharing).toContain(text);
    }
    expect(sharing).toContain(
      "Knowledge leaves only when its root or project is allowed to leave and its area is allowed. Memories have no area: a project set to Knowledge and memories sends every active memory of its own that is not stale, branch-bound, imported or one of your rules. New areas start private. Lowering a level recalls nothing already sent; the next sync withdraws it. This page governs the team server only; TypeSafe judgements are governed by your key, under Judge.",
    );
  });

  test("asks before sharing more, with what would leave", () => {
    expect(sharing).toContain('action="Share"');
    expect(sharing).toContain('title="Share more knowledge?"');
    expect(sharing).toContain('tone="warn"');
    expect(sharing).toContain('icon="i-lucide-share-2"');
    expect(sharing).toContain(
      "would leave for your team's server once one is configured. Nothing is sent now.",
    );
    expect(sharing).toContain("saveSettings(patch, { confirm: true })");
  });

  test("says how many projects share, and the last change", () => {
    expect(sharing).toContain("projects share knowledge");
    expect(sharing).toContain("share knowledge and memories.");
    expect(sharing).toContain('openCross("projects", null)');
    expect(sharing).toContain("Last change:");
    expect(sharing).toContain("from the");
  });

  test("saves what its switches make through the shared rules, after one preview", () => {
    expect(sharing).toContain("buildSharingPatch(");
    expect(sharing).toContain("sharingPreview(");
    expect(sharing.match(/sharingPreview\(/g)).toHaveLength(1);
  });

  test("names no part of the plan it was built under", () => {
    expect(sharing).not.toMatch(/part \d/i);
  });
});

describe("what the Sharing page and the dock say when something fails", () => {
  /** The dock's sharing code: from its comment to the next part of the script. */
  const dockScript = (() => {
    const start = projects.indexOf("// What the project shares");
    const end = projects.indexOf("const RELATION_TONE", start);
    return start === -1 || end === -1 ? "" : projects.slice(start, end);
  })();
  /** The dock's Sharing section, as the template has it. */
  const dockSection = (() => {
    const start = projects.indexOf('<section aria-label="Sharing"');
    const end = projects.indexOf("</section>", start);
    return start === -1 || end === -1 ? "" : projects.slice(start, end);
  })();

  test("a plain sentence, never the error's message or a path", () => {
    expect(sharing).toContain('title: "Sharing not saved"');
    expect(sharing).toContain("The settings file could not be written.");
    expect(sharing).toContain("Sharing could not be loaded.");
    expect(sharing).not.toContain("error.message");
    expect(sharing).not.toContain("console.");
    expect(dockScript).toContain('title: "Not changed"');
    expect(dockScript).toContain("The level could not be saved.");
    expect(dockScript).not.toContain("error.message");
    expect(dockScript).not.toContain("console.");
  });

  test("the dock's level control shows its three labels whole", () => {
    expect(dockSection).toContain("LEVEL_LABELS");
    expect(dockSection).not.toContain("truncate");
  });

  test("Save is disabled while nothing changed", () => {
    expect(sharing).toMatch(/label="Save"[^>]*:disabled="[^"]*!changed/);
  });
});

describe("Across projects", () => {
  test("a row that shares says so in a pill", () => {
    expect(projects).toMatch(/p\.sharing !== ["']local["']/);
    expect(projects).toContain("LEVEL_LABELS[p.sharing]");
  });

  test("the dock has the Sharing section, in the design's words", () => {
    expect(projects).toContain("Knowledge and memories");
    expect(projects).toContain(
      "Memories have no area: Knowledge and memories sends every active memory of this project that is not stale, branch-bound, imported or one of your rules.",
    );
    expect(projects).toContain(
      "This project has no git remote. A team can only match projects by their remote.",
    );
    expect(projects).toContain("Memory is off for this project.");
    expect(projects).toContain("LEVELS");
  });

  test("a wider level is previewed and confirmed, and the change is said", () => {
    expect(projects).toContain("Share more of");
    expect(projects).toContain('action="Share"');
    expect(projects).toContain(
      "would leave for your team's server once one is configured. Nothing is sent now.",
    );
    expect(projects).toContain("sharingPreview({ level: {");
    expect(projects).toContain("setProjectSharing(");
    expect(projects).toContain("Sharing changed");
  });
});

describe("the viewer's client", () => {
  test("knows the two sharing keys, and the four it lacked", () => {
    const union = /export type SettingKey =([\s\S]*?);/.exec(client)?.[1] ?? "";
    for (const key of [
      "WIZARDINGCODE_MEM_SHARE_ROOTS",
      "WIZARDINGCODE_MEM_SHARE_AREAS",
      "WIZARDINGCODE_MEM_SEMANTIC",
      "WIZARDINGCODE_MEM_HISTORY_DAYS",
      "WIZARDINGCODE_MODULES",
      "WIZARDINGCODE_MEM_AUTHOR",
    ]) {
      expect(union).toContain(`| "${key}"`);
    }
  });

  test("sends the confirmation with a save when it is asked to", () => {
    expect(client).toMatch(
      /saveSettings: \(patch: SettingsPatch, options\?: \{ confirm\?: boolean \}/,
    );
    expect(client).toContain("confirm: true");
    expect(settingsState).toMatch(
      /saveSettings\(\s*patch: SettingsPatch,\s*options\?: \{ confirm\?: boolean \}/,
    );
    expect(settingsState).toContain("api.saveSettings(patch, options)");
  });

  test("takes the levels' labels and the patch's rules from the sharing sources", () => {
    expect(client).toMatch(
      /\{[^}]*\bLEVEL_LABELS\b[^}]*\}\s*from "\.\.\/\.\.\/src\/sharing\/types\.ts"/,
    );
    expect(client).toMatch(
      /\{[^}]*\bbuildSharingPatch\b[^}]*\}\s*from "\.\.\/\.\.\/src\/sharing\/patch\.ts"/,
    );
    for (const call of ["sharing:", "sharingPreview:", "setProjectSharing:"]) {
      expect(client).toContain(call);
    }
  });
});

describe("the built page", () => {
  const built = existsSync(at(BUILT));
  const why = built ? "" : " (built page absent; run bun run ui:build)";

  test.skipIf(!built)(`holds the Sharing page and the dock's section${why}`, () => {
    const page = readFileSync(at(BUILT), "utf8");
    // Compared as a pair, so a failure names the sentence and does not print the page.
    const holds = (text: string) => [text, page.includes(text)];
    for (const text of [
      "Workspace knowledge",
      "Memories have no area",
      "for sharing it can only narrow",
      "This project has no git remote",
    ]) {
      expect(holds(text)).toEqual([text, true]);
    }
    expect(holds("Collaborative mode")).toEqual(["Collaborative mode", false]);
  });
});
