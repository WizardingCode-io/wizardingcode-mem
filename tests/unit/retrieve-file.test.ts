import { describe, expect, test } from "bun:test";
import { relativeTo, rootsOf } from "../../src/core/paths.ts";
import { renderNotes } from "../../src/retrieve/render.ts";

describe("paths", () => {
  test("backslashes are normalised on both sides", () => {
    const roots = rootsOf("C:\\work\\shop");
    expect(roots).toContain("C:/work/shop");
    expect(relativeTo(roots, ["C:\\work\\shop\\src\\store\\db.ts"])).toEqual(["src/store/db.ts"]);
  });
  test("a path outside the roots, or a relative one, is dropped", () => {
    expect(relativeTo(["/a/b"], ["/a/c/x.ts", "x.ts", "/a/bb/x.ts"])).toEqual([]);
  });
  test("roots are cached per directory", () => {
    expect(rootsOf("/nonexistent/dir")).toBe(rootsOf("/nonexistent/dir"));
  });
});

describe("renderNotes intro", () => {
  const note = {
    id: 1,
    kind: "gotcha" as const,
    title: "t",
    body: "b",
    createdAt: 0,
    files: [],
    stale: false,
  };
  test("a given intro replaces the default", () => {
    expect(renderNotes([note], "About x.ts.")).toContain("About x.ts.");
    expect(renderNotes([note])).toContain("earlier sessions in this project");
  });
});
