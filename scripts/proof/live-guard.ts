import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/** The real path of a file that may not exist yet: its directory's real path plus its name. */
function real(path: string): string {
  const full = resolve(path);
  return existsSync(full) ? realpathSync(full) : join(realpathSync(dirname(full)), basename(full));
}

/**
 * Refuses a copy that is, or sits inside, the live data or store directory, or that is the
 * same file as the live database (same device and inode, so a link or a case-insensitive
 * spelling does not get past it). Compares real paths, not the spellings given.
 */
export function assertNotLive(copy: string, liveDirs: string[], liveDbFile: string): void {
  const target = real(copy);
  for (const dir of liveDirs) {
    const live = existsSync(dir) ? realpathSync(dir) : resolve(dir);
    const inside =
      target.toLowerCase() === live.toLowerCase() ||
      target.toLowerCase().startsWith(live.toLowerCase() + sep);
    if (inside) throw new Error("refusing to replay into the live database; take a copy first");
  }
  if (existsSync(target) && existsSync(liveDbFile)) {
    const a = statSync(target);
    const b = statSync(liveDbFile);
    if (a.dev === b.dev && a.ino === b.ino) {
      throw new Error("refusing to replay into the live database; take a copy first");
    }
  }
}
