import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_MANIFEST_BYTES = 256 * 1024;
const GENERIC = new Set([
  "api",
  "web",
  "app",
  "ui",
  "frontend",
  "backend",
  "server",
  "client",
  "core",
  "service",
  "lib",
  "mobile",
  // Words every agency repo carries; one owner's unrelated client repos must never match on them.
  ...[
    "admin",
    "site",
    "website",
    "theme",
    "docs",
    "doc",
    "infra",
    "config",
    "gateway",
    "cms",
    "dashboard",
    "portal",
    "landing",
    "plugin",
    "sdk",
    "cli",
    "tools",
    "test",
    "tests",
    "e2e",
    "deploy",
    "ops",
    "data",
    "assets",
    "static",
    "www",
    "wp",
    "wordpress",
    "laravel",
    "react",
    "vue",
    "next",
    "nuxt",
    "node",
  ],
]);

/** Splits a normalised `host/owner/name` remote (SSH and HTTPS alike) or null when it is not one. */
export function parseRemote(remote: string): { host: string; owner: string; name: string } | null {
  const text = remote.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const scp = text.match(/^(?:[^@/\s]+@)?([^:/\s]{2,}):(.+)$/);
  const normal = scp && !text.startsWith("/") ? `${scp[1]}/${scp[2]}` : text;
  const parts = normal
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase()
    .split("/");
  const [host, owner, name] = parts;
  if (parts.length !== 3 || !host || !owner || !name || !host.includes(".")) return null;
  return { host, owner, name };
}

export function nameStems(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[-_.]/)
    .filter((part) => part.length >= 3 && !GENERIC.has(part));
}

/** The first stem both names have that is not in `exclude` (the owner's own name, for one). */
export function sharedStem(a: string, b: string, exclude?: ReadonlySet<string>): string | null {
  const other = new Set(nameStems(b));
  return nameStems(a).find((stem) => other.has(stem) && !exclude?.has(stem)) ?? null;
}

/** A usable workspace glob: not an exclusion, not a bare wildcard that would cover everything. */
export function workspacePattern(pattern: string): string | null {
  const clean = pattern.trim().replace(/^\.\//, "").replace(/\/+$/, "");
  if (!clean || clean.startsWith("!") || /^[*/]+$/.test(clean)) return null;
  return clean;
}

export interface Manifest {
  packageName: string | null;
  deps: string[];
  localPaths: string[];
  gitUrls: string[];
  workspaces: string[];
}

function empty(): Manifest {
  return { packageName: null, deps: [], localPaths: [], gitUrls: [], workspaces: [] };
}

function read(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function addDep(m: Manifest, name: string, spec: unknown): void {
  m.deps.push(name);
  if (typeof spec !== "string") return;
  const local = spec.match(/^(?:file|link|portal):(.+)$/);
  if (local?.[1]) m.localPaths.push(local[1]);
  else if (/^(git\+|git:\/\/|ssh:\/\/)/.test(spec) || /^https?:\/\/.+\.git(#.*)?$/.test(spec)) {
    m.gitUrls.push(spec);
  }
}

function fromPackageJson(m: Manifest, text: string): void {
  const json = JSON.parse(text) as Record<string, unknown>;
  if (typeof json.name === "string") m.packageName ??= json.name;
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const group = json[key];
    if (group && typeof group === "object") {
      for (const [name, spec] of Object.entries(group)) addDep(m, name, spec);
    }
  }
  const ws = json.workspaces;
  const list = Array.isArray(ws) ? ws : (ws as { packages?: unknown } | undefined)?.packages;
  if (Array.isArray(list))
    for (const w of list) {
      const ok = typeof w === "string" ? workspacePattern(w) : null;
      if (ok) m.workspaces.push(ok);
    }
}

function fromComposer(m: Manifest, text: string): void {
  const json = JSON.parse(text) as Record<string, unknown>;
  if (typeof json.name === "string") m.packageName ??= json.name;
  for (const key of ["require", "require-dev"]) {
    const group = json[key];
    if (group && typeof group === "object")
      for (const name of Object.keys(group)) m.deps.push(name);
  }
  const repos = json.repositories;
  if (Array.isArray(repos)) {
    for (const repo of repos as Array<{ type?: string; url?: string }>) {
      if (repo?.type === "path" && typeof repo.url === "string") m.localPaths.push(repo.url);
      else if (repo?.type === "vcs" && typeof repo.url === "string") m.gitUrls.push(repo.url);
    }
  }
}

function fromGoMod(m: Manifest, text: string): void {
  let block = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const mod = line.match(/^module\s+(\S+)/);
    if (mod?.[1]) m.packageName ??= mod[1];
    else if (/^(require|replace)\s*\($/.test(line)) block = true;
    else if (line === ")") block = false;
    else {
      const rep = line.match(/^(?:replace\s+)?\S+(?:\s+\S+)?\s*=>\s*(\.{1,2}\/\S*)/);
      if (rep?.[1]) m.localPaths.push(rep[1]);
      const req = line.match(/^(?:require\s+)?([^\s=]+\.[^\s=]+\/\S+)\s+v\S+/);
      if (req?.[1] && (block || line.startsWith("require"))) m.deps.push(req[1]);
    }
  }
}

function fromCargo(m: Manifest, text: string): void {
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const head = line.match(/^\[([^\]]+)\]$/);
    if (head?.[1]) {
      section = head[1];
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!kv?.[1]) continue;
    if (section === "package" && kv[1] === "name") {
      const n = kv[2]?.match(/^"([^"]+)"/);
      if (n?.[1]) m.packageName ??= n[1];
    } else if (/(^|\.)(dev-|build-)?dependencies$/.test(section)) {
      m.deps.push(kv[1]);
      const path = kv[2]?.match(/path\s*=\s*"([^"]+)"/);
      if (path?.[1]) m.localPaths.push(path[1]);
      const git = kv[2]?.match(/git\s*=\s*"([^"]+)"/);
      if (git?.[1]) m.gitUrls.push(git[1]);
    }
  }
}

function fromPnpm(m: Manifest, text: string): void {
  let inPackages = false;
  for (const raw of text.split("\n")) {
    if (/^packages\s*:/.test(raw)) inPackages = true;
    else if (/^\S/.test(raw)) inPackages = false;
    else if (inPackages) {
      const item = raw.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?/);
      const ok = item?.[1] ? workspacePattern(item[1]) : null;
      if (ok) m.workspaces.push(ok);
    }
  }
}

const READERS: Array<[string, (m: Manifest, text: string) => void]> = [
  ["package.json", fromPackageJson],
  ["composer.json", fromComposer],
  ["go.mod", fromGoMod],
  ["Cargo.toml", fromCargo],
  ["pnpm-workspace.yaml", fromPnpm],
];

/** The manifest file that names the project, for the signal text. */
export function primaryManifest(root: string): string | null {
  for (const [file] of READERS) if (existsSync(join(root, file))) return file;
  return null;
}

/** What the project's manifests say about other projects. Each file is capped; any error leaves its fields empty. */
export function readManifests(root: string): Manifest {
  const m = empty();
  for (const [file, parse] of READERS) {
    const text = read(join(root, file));
    if (text === null) continue;
    const part = empty();
    try {
      parse(part, text);
    } catch {
      continue;
    }
    m.packageName ??= part.packageName;
    m.deps.push(...part.deps);
    m.localPaths.push(...part.localPaths);
    m.gitUrls.push(...part.gitUrls);
    m.workspaces.push(...part.workspaces);
  }
  return m;
}
