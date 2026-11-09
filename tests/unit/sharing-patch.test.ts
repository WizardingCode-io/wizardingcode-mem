// What the Sharing page saves: its switches as the settings patch. The module is pure, so
// each rule is proven here without a browser.
import { describe, expect, test } from "bun:test";
import { buildSharingPatch } from "../../src/sharing/patch.ts";

const ROOTS_KEY = "WIZARDINGCODE_MEM_SHARE_ROOTS";
const AREAS_KEY = "WIZARDINGCODE_MEM_SHARE_AREAS";

type Toggles = Parameters<typeof buildSharingPatch>[0];

/** The workspace's taxonomy holds sales and marketing; the shared repository's holds ops. */
const TAXONOMIES: Toggles["taxonomies"] = {
  workspace: [
    { id: "sales", label: "Sales" },
    { id: "marketing", label: "Marketing" },
  ],
  shared: [{ id: "ops", label: "Operations" }],
};
const FROM_FILE: Toggles["sources"] = { [ROOTS_KEY]: "file", [AREAS_KEY]: "file" };

/** The page with every switch off and both keys the file's own, but for `parts`. */
const toggles = (parts: Partial<Toggles> = {}): Toggles => ({
  roots: { workspace: false, shared: false },
  areas: {},
  taxonomies: TAXONOMIES,
  inert: [],
  sources: FROM_FILE,
  ...parts,
});

describe("buildSharingPatch", () => {
  test("the roots and the areas that are on, and never an area no taxonomy holds", () => {
    const patch = buildSharingPatch(
      toggles({
        roots: { workspace: true, shared: false },
        areas: { "workspace:sales": true, "workspace:legal": true, "shared:ops": false },
        inert: ["workspace:legal"],
      }),
    );
    expect(patch).toEqual({ [ROOTS_KEY]: "workspace", [AREAS_KEY]: "workspace:sales" });
  });

  test("with every switch off both lists are none", () => {
    expect(buildSharingPatch(toggles())).toEqual({ [ROOTS_KEY]: "none", [AREAS_KEY]: "none" });
    const off = toggles({ areas: { "workspace:sales": false, "shared:ops": false } });
    expect(buildSharingPatch(off)).toEqual({ [ROOTS_KEY]: "none", [AREAS_KEY]: "none" });
  });

  test("two areas on are a sorted comma list, and so are two roots", () => {
    const patch = buildSharingPatch(
      toggles({
        roots: { workspace: true, shared: true },
        areas: { "workspace:sales": true, "shared:ops": true, "workspace:marketing": false },
      }),
    );
    expect(patch).toEqual({
      [ROOTS_KEY]: "shared,workspace",
      [AREAS_KEY]: "shared:ops,workspace:sales",
    });
  });

  test("a key the environment sets is left out, so the file's value is not overwritten", () => {
    const on = {
      roots: { workspace: true, shared: false },
      areas: { "workspace:sales": true },
    };
    const rootsLocked = toggles({ ...on, sources: { [ROOTS_KEY]: "env", [AREAS_KEY]: "file" } });
    expect(buildSharingPatch(rootsLocked)).toEqual({ [AREAS_KEY]: "workspace:sales" });
    const areasLocked = toggles({ ...on, sources: { [ROOTS_KEY]: "default", [AREAS_KEY]: "env" } });
    expect(buildSharingPatch(areasLocked)).toEqual({ [ROOTS_KEY]: "workspace" });
  });

  test("with both keys set by the environment the patch is empty", () => {
    const patch = buildSharingPatch(
      toggles({
        roots: { workspace: true, shared: true },
        areas: { "workspace:sales": true },
        sources: { [ROOTS_KEY]: "env", [AREAS_KEY]: "env" },
      }),
    );
    expect(patch).toEqual({});
  });

  test("an area of a root with no taxonomy is dropped", () => {
    const patch = buildSharingPatch(
      toggles({
        areas: { "workspace:sales": true, "shared:ops": true },
        taxonomies: { workspace: null, shared: TAXONOMIES.shared },
      }),
    );
    expect(patch[AREAS_KEY]).toBe("shared:ops");
  });

  test("an id the page lists as inert is dropped whatever the taxonomies say", () => {
    const patch = buildSharingPatch(
      toggles({
        areas: { "workspace:sales": true, "workspace:marketing": true },
        inert: ["workspace:marketing"],
      }),
    );
    expect(patch[AREAS_KEY]).toBe("workspace:sales");
  });
});
