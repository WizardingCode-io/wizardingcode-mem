import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertNotLive } from "../../scripts/proof/live-guard.ts";

let base: string;
let live: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "wizardingcode-mem-guard-")));
  live = join(base, "live");
  mkdirSync(live);
  writeFileSync(join(live, "db.sqlite"), "x");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const refuses = (copy: string) =>
  expect(() => assertNotLive(copy, [live], join(live, "db.sqlite"))).toThrow(/refusing/);

test("refuses the live directory, a subdirectory and a symlink to it", () => {
  refuses(join(live, "db.sqlite"));
  mkdirSync(join(live, "sub"));
  refuses(join(live, "sub", "copy.db"));
  symlinkSync(live, join(base, "alias"));
  refuses(join(base, "alias", "copy.db"));
  refuses(join(base, "alias", "..", "live", "x.db"));
});

test("refuses a hard link to the live database, wherever it sits", () => {
  mkdirSync(join(base, "scratch"));
  linkSync(join(live, "db.sqlite"), join(base, "scratch", "db.sqlite"));
  refuses(join(base, "scratch", "db.sqlite"));
});

test("refuses another case of the live directory on a case-insensitive file system", () => {
  if (!existsSync(join(base, "LIVE"))) return; // a case-sensitive file system has no such alias
  refuses(join(base, "LIVE", "copy.db"));
});

test("accepts a copy elsewhere", () => {
  mkdirSync(join(base, "scratch"));
  expect(() =>
    assertNotLive(join(base, "scratch", "copy.db"), [live], join(live, "db.sqlite")),
  ).not.toThrow();
});
