// The sync's boundaries (ADR 0027): what the hooks may reach of it, what it may import, and
// where each sharing table is named in SQL. Every rule is read from the sources, so a new
// importer or a new statement in the wrong module fails here before it ships.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../../src");

/** Every `.ts` file under a folder of the sources, as `src/...` paths, sorted. */
function filesUnder(folder: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts")) found.push(`src/${relative(SRC, full).split("\\").join("/")}`);
    }
  };
  walk(join(SRC, folder.replace(/^src\/?/, "")));
  return found.sort();
}

const sourceOf = (file: string): string => readFileSync(join(SRC, file.slice(4)), "utf8");

/** The import specifiers of a module, as written: static, dynamic and `require`. */
function importsOf(source: string): string[] {
  return [
    ...source.matchAll(/from\s+"([^"]+)"/g),
    ...source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g),
    ...source.matchAll(/\brequire\(\s*"([^"]+)"\s*\)/g),
  ].map((match) => match[1] as string);
}

/** The `src/...` path a relative specifier resolves to; null for a package or a non-`.ts` file. */
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".") || !spec.endsWith(".ts")) return null;
  const target = resolve(SRC, dirname(from.slice(4)), spec);
  return `src/${relative(SRC, target).split("\\").join("/")}`;
}

/** The files a module imports directly. */
function directImports(file: string): string[] {
  return importsOf(sourceOf(file))
    .map((spec) => resolveSpec(file, spec))
    .filter((target): target is string => target !== null);
}

/** Every file reachable from one through its imports, itself excluded. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const target of directImports(file)) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  seen.delete(entry);
  return seen;
}

const under =
  (folder: string) =>
  (file: string): boolean =>
    file.startsWith(`${folder}/`);

/** `file: target` for every import of a file of `folder` into `where`, kept when `allowed` says no. */
function importsInto(
  folder: string,
  where: (target: string) => boolean,
  allowed: (file: string, target: string) => boolean = () => false,
): string[] {
  const found: string[] = [];
  for (const file of filesUnder(folder)) {
    for (const target of directImports(file)) {
      if (where(target) && !allowed(file, target)) found.push(`${file}: ${target}`);
    }
  }
  return found;
}

describe("the hooks", () => {
  test("hook.ts reaches spawn.ts and nothing else of src/sync; handle.ts reaches nothing of it", () => {
    const fromHook = [...reachable("src/cli/commands/hook.ts")].filter(under("src/sync")).sort();
    expect(fromHook).toEqual(["src/sync/spawn.ts"]);
    expect([...reachable("src/hooks/handle.ts")].filter(under("src/sync"))).toEqual([]);
  });

  test("spawn.ts imports no other module of src/sync", () => {
    expect(directImports("src/sync/spawn.ts").filter(under("src/sync"))).toEqual([]);
  });
});

describe("the modules", () => {
  test("src/sync imports nothing of src/team but contract.ts, and src/team nothing of src/sync", () => {
    expect(
      importsInto(
        "src/sync",
        under("src/team"),
        (_file, target) => target === "src/team/contract.ts",
      ),
    ).toEqual([]);
    expect(importsInto("src/team", under("src/sync"))).toEqual([]);
  });

  test("the knowledge module and retrieval import nothing of src/sync or src/sharing", () => {
    const forbidden = (target: string) => under("src/sync")(target) || under("src/sharing")(target);
    expect(importsInto("src/modules/knowledge", forbidden)).toEqual([]);
    expect(importsInto("src/retrieve", forbidden)).toEqual([]);
  });

  test("src/sync and src/backup never import each other", () => {
    expect(importsInto("src/sync", under("src/backup"))).toEqual([]);
    expect(importsInto("src/backup", under("src/sync"))).toEqual([]);
  });
});

describe("the sharing tables", () => {
  const LEDGER = [
    "sharing_ledger",
    "sharing_sent_hashes",
    "sharing_refusals",
    "sharing_conflicts",
    "sharing_pending_rows",
    "sharing_unbound",
    "sharing_received_memories",
  ];
  /** The readers that reach the tables by SQL of their own, importing nothing of the sync. */
  const READERS = [
    "src/modules/knowledge/index-store.ts",
    "src/modules/knowledge/contribute.ts",
    "src/retrieve/received.ts",
  ];
  const BACKUP = "src/backup/backup.ts";
  const sharing = under("src/sharing");
  const ledgerAllowed = (file: string) =>
    file === "src/sync/ledger.ts" ||
    sharing(file) ||
    file === BACKUP ||
    file === "src/store/memories.ts" ||
    READERS.includes(file);
  const serversAllowed = (file: string) =>
    ledgerAllowed(file) ||
    ["src/sync/servers.ts", "src/sync/state.ts", "src/sync/spawn.ts"].includes(file);
  const levelsAllowed = (file: string) =>
    sharing(file) ||
    file === BACKUP ||
    file === "src/modules/knowledge/index-store.ts" ||
    file === "src/retrieve/received.ts";
  const changesAllowed = (file: string) => sharing(file) || file === BACKUP;
  const RULES: [string, (file: string) => boolean][] = [
    ...LEDGER.map((table): [string, (file: string) => boolean] => [table, ledgerAllowed]),
    ["sharing_servers", serversAllowed],
    ["sharing_muted_members", serversAllowed],
    ["sharing_levels", levelsAllowed],
    ["sharing_changes", changesAllowed],
  ];
  const names = (source: string, table: string) => new RegExp(`\\b${table}\\b`).test(source);

  test("each table is named only where the design puts it", () => {
    const offenders: string[] = [];
    for (const file of filesUnder("src")) {
      const source = sourceOf(file);
      for (const [table, allowed] of RULES) {
        if (names(source, table) && !allowed(file)) offenders.push(`${file}: ${table}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("status, doctor, the viewer, join and the knowledge tools name no sharing table", () => {
    const quiet = [
      "src/status/report.ts",
      "src/doctor/checks.ts",
      "src/ui/server.ts",
      "src/ui/api.ts",
      "src/sync/join.ts",
      "src/sync/binding.ts",
      "src/modules/knowledge/tools.ts",
    ];
    for (const file of quiet) {
      const source = sourceOf(file);
      const named = RULES.map(([table]) => table).filter((table) => names(source, table));
      expect({ file, named }).toEqual({ file, named: [] });
    }
  });

  test("the ledger module and the server module exist and import nothing of the hooks' side", () => {
    for (const file of ["src/sync/ledger.ts", "src/sync/servers.ts", "src/sync/state.ts"]) {
      expect(filesUnder("src/sync")).toContain(file);
      expect(directImports(file).filter(under("src/cli"))).toEqual([]);
      expect(directImports(file).filter(under("src/hooks"))).toEqual([]);
    }
  });
});
