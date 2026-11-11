// A file written whole or not at all: a 0600 temporary file beside it, then a rename.
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function writeFileAtomic(path: string, content: string | Uint8Array): void {
  const temp = join(dirname(path), `.${path.slice(dirname(path).length + 1)}.tmp`);
  rmSync(temp, { force: true });
  try {
    writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}
