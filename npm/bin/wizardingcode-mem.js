#!/usr/bin/env node
// wizardingcode-mem for npm: fetches the binary of this package's version when none is in place
// or the one in place is older (from the GitHub release, checksum verified), keeps it in
// ~/.wizardingcode/mem/bin, and runs it.
// Nothing runs at install time; `npx wizardingcode-mem install` is the whole setup.
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { version } = require("../package.json");

const REPO = "WizardingCode-io/wizardingcode-mem";
const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
const arch = { x64: "x64", arm64: "arm64" }[process.arch];
if (!platform || !arch || (platform === "windows" && arch !== "x64")) {
  console.error(`wizardingcode-mem: no binary for ${process.platform}/${process.arch}`);
  process.exit(1);
}
const file = `wizardingcode-mem-${platform}-${arch}${platform === "windows" ? ".exe" : ""}`;
const home = process.env.WIZARDINGCODE_HOME || path.join(os.homedir(), ".wizardingcode");
const data = process.env.WIZARDINGCODE_MEM_DATA_DIR || path.join(home, "mem");
const binDir = path.join(data, "bin");
const binary = path.join(
  binDir,
  platform === "windows" ? "wizardingcode-mem.exe" : "wizardingcode-mem",
);
const base =
  process.env.WIZARDINGCODE_MEM_RELEASE_BASE ||
  `https://github.com/${REPO}/releases/download/v${version}`;

function installedVersion() {
  try {
    const out = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10000 });
    return out.status === 0 ? out.stdout.trim() : null;
  } catch {
    return null;
  }
}

// True when `have` is missing, not a version, or older than `wanted` (scripts/plugins.ts, OLDER_JS).
function older(have, wanted) {
  const shape = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
  if (!have || !shape.test(have)) return true;
  const split = (version) => {
    const cut = version.indexOf("-");
    return cut === -1 ? [version, null] : [version.slice(0, cut), version.slice(cut + 1)];
  };
  const [coreA, preA] = split(have);
  const [coreB, preB] = split(wanted);
  const a = coreA.split(".").map(Number);
  const b = coreB.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  if (preA === null || preB === null) return preA !== null && preB === null;
  const x = preA.split(".");
  const y = preB.split(".");
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    const p = /^\d+$/.test(x[i]);
    const q = /^\d+$/.test(y[i]);
    if (p && q) return Number(x[i]) < Number(y[i]);
    if (p !== q) return p;
    return x[i] < y[i];
  }
  return x.length < y.length;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function download() {
  process.stderr.write(`wizardingcode-mem: downloading ${file} ${version}\n`);
  const res = await fetch(`${base}/${file}`);
  if (!res.ok) throw new Error(`${base}/${file}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const line = (await fetchText(`${base}/checksums.txt`))
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .find((parts) => parts[1] === file);
  if (!line) throw new Error(`${file} is not in the release's checksums`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== line[0]) throw new Error(`checksum mismatch for ${file}`);
  fs.mkdirSync(binDir, { recursive: true });
  const temp = path.join(binDir, `.wizardingcode-mem.${process.pid}`);
  fs.writeFileSync(temp, bytes, { mode: 0o755 });
  fs.renameSync(temp, binary);
}

async function main() {
  // The staged binary only moves forward: a newer one, put there by a plugin or a newer
  // package, is run as it is.
  const staged = installedVersion();
  if (older(staged, version)) {
    try {
      await download();
    } catch (error) {
      console.error(`wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  } else if (staged !== version) {
    process.stderr.write(
      `wizardingcode-mem: running ${staged} already in ${binary}; this package is ${version}\n`,
    );
  }
  const run = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
  if (run.error) {
    console.error(`wizardingcode-mem: ${run.error.message}`);
    process.exit(1);
  }
  process.exit(run.status === null ? 1 : run.status);
}

main();
