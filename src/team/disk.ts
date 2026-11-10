// Free space at a path, for the storage floor and the health probe.
import { statfsSync } from "node:fs";

/** The bytes a non-root process may still write at `path`; null when the filesystem cannot say. */
export function freeBytes(path: string): number | null {
  try {
    const stats = statfsSync(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}
