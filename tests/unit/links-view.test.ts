import { describe, expect, test } from "bun:test";
import {
  type LinkView,
  linksOfferLine,
  projectGroups,
  projectLinks,
  projectPlace,
  relationOf,
  ruleWhy,
  signalParts,
  visibleFrom,
} from "../../ui/src/links.ts";

const link = (over: Partial<LinkView> & Pick<LinkView, "id" | "from" | "to">): LinkView => ({
  fromName: `p${over.from}`,
  toName: `p${over.to}`,
  kind: "product",
  status: "confirmed",
  origin: "manual",
  signals: [],
  createdAt: 0,
  decidedAt: null,
  ...over,
});

describe("a link as one project sees it", () => {
  test("same product either way; uses one way, named from each end", () => {
    const product = link({ id: 1, from: 1, to: 2 });
    expect(relationOf(product, 2)).toEqual({ otherId: 1, otherName: "p1", label: "Same product" });
    const uses = link({ id: 2, from: 1, to: 3, kind: "uses" });
    expect(relationOf(uses, 1)).toEqual({ otherId: 3, otherName: "p3", label: "Uses" });
    expect(relationOf(uses, 3)).toEqual({ otherId: 1, otherName: "p1", label: "Used by" });
  });

  test("a project's confirmed links and pending suggestions, by the other's name; rejected ones left out", () => {
    const links = [
      link({ id: 1, from: 1, to: 4, toName: "zeta" }),
      link({ id: 2, from: 1, to: 3, toName: "alpha", kind: "uses" }),
      link({ id: 3, from: 2, to: 1, fromName: "beta", status: "suggested" }),
      link({ id: 4, from: 1, to: 5, status: "rejected" }),
      link({ id: 5, from: 6, to: 7 }),
    ];
    const mine = projectLinks(links, 1);
    expect(mine.confirmed.map((r) => [r.link.id, r.otherName])).toEqual([
      [2, "alpha"],
      [1, "zeta"],
    ]);
    expect(mine.suggested.map((r) => r.link.id)).toEqual([3]);
  });

  test("what a project reads besides itself: confirmed product either way, uses from it only, no chains", () => {
    const links = [
      link({ id: 1, from: 2, to: 1, fromName: "b" }),
      link({ id: 2, from: 1, to: 3, toName: "a", kind: "uses" }),
      link({ id: 3, from: 4, to: 1, kind: "uses" }),
      link({ id: 4, from: 2, to: 5 }),
      link({ id: 5, from: 1, to: 6, status: "suggested" }),
    ];
    expect(visibleFrom(links, 1)).toEqual([
      { id: 3, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(visibleFrom(links, 3)).toEqual([]);
  });
});

describe("the projects list", () => {
  const project = (id: number, name: string) => ({ id, name });
  test("to review first, then linked, then the rest; empty groups left out", () => {
    const projects = [
      project(1, "shop"),
      project(2, "api"),
      project(3, "lib"),
      project(4, "notes"),
    ];
    const links = [
      link({ id: 1, from: 1, to: 3, kind: "uses" }),
      link({ id: 2, from: 1, to: 2, status: "suggested" }),
    ];
    expect(projectGroups(projects, links).map((g) => [g.key, g.items.map((p) => p.name)])).toEqual([
      ["review", ["api", "shop"]],
      ["linked", ["lib"]],
      ["alone", ["notes"]],
    ]);
    expect(projectGroups([project(4, "notes")], []).map((g) => g.key)).toEqual(["alone"]);
  });

  test("where a project lives, shaped for a row", () => {
    expect(projectPlace("remote:github.com/acme/shop")).toBe("github.com/acme/shop");
    expect(projectPlace("path:/Users/ana/Code/clients/acme/platform/web")).toBe(
      "~/…/acme/platform/web",
    );
    expect(projectPlace("path:/Users/ana/shop")).toBe("~/shop");
    expect(projectPlace("imported:shop")).toBe("Imported, no folder yet");
    expect(projectPlace("gitdir:/srv/repos/a/b/c/d/e")).toBe("…/c/d/e");
  });
});

describe("why a link was suggested", () => {
  test("each signal as a label and a value, long ones shortened", () => {
    expect(signalParts("same owner github.com/acme")).toEqual({
      label: "Same owner",
      value: "github.com/acme",
    });
    expect(signalParts("shared name shop")).toEqual({ label: "Shared name", value: "shop" });
    expect(signalParts("package.json depends on @acme/lib")).toEqual({
      label: "package.json depends on",
      value: "@acme/lib",
    });
    expect(signalParts("package.json depends on git+https://github.com/acme/lib.git")).toEqual({
      label: "package.json depends on",
      value: "github.com/acme/lib",
    });
    expect(signalParts("Cargo.toml depends on ../../lib")).toEqual({
      label: "Cargo.toml depends on",
      value: "../../lib",
    });
    expect(signalParts("one workspace /Users/ana/Code/clients/acme/platform")).toEqual({
      label: "One workspace",
      value: "~/…/clients/acme/platform",
    });
    expect(signalParts("something else")).toEqual({ label: "", value: "something else" });
  });
});

describe("the rules and the banner", () => {
  test("why a rule was proposed", () => {
    expect(ruleWhy({ reason: "repeated", projects: ["a", "b", "c"] })).toBe(
      "Repeated in 3 projects",
    );
    expect(ruleWhy({ reason: "said-always", projects: ["a"] })).toBe(
      "You said it holds everywhere",
    );
    expect(ruleWhy({ reason: null, projects: [] })).toBe("Made yours");
  });

  test("the banner's line counts what is new", () => {
    expect(linksOfferLine({ show: true, suggestions: 2, proposals: 1 })).toBe(
      "2 links suggested between your projects, and 1 rule you repeat that could be yours.",
    );
    expect(linksOfferLine({ show: true, suggestions: 1, proposals: 0 })).toBe(
      "1 link suggested between your projects.",
    );
    expect(linksOfferLine({ show: true, suggestions: 0, proposals: 3 })).toBe(
      "3 rules you repeat that could be yours.",
    );
  });
});
