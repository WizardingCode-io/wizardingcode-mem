import { homedir } from "node:os";
import { isAbsolute, join, win32 } from "node:path";
import { ENV_FILE, readEnvFile } from "../settings/env-file.ts";

const set = (value: string | undefined): value is string => value !== undefined && value !== "";

/**
 * Where all of wizardingcode-mem's state lives: `~/.wizardingcode/mem`, the memory product's corner
 * of the brand's home. Never inside a host agent's plugin directory, which is deleted
 * on uninstall. `WIZARDINGCODE_HOME` moves the brand's home; `WIZARDINGCODE_MEM_DATA_DIR` moves
 * only this product.
 */
export function defaultDataDir(env: Record<string, string | undefined> = process.env): string {
  if (set(env.WIZARDINGCODE_MEM_DATA_DIR)) return env.WIZARDINGCODE_MEM_DATA_DIR;
  return join(brandHome(env), "mem");
}

/** The brand's home, `~/.wizardingcode` (or `WIZARDINGCODE_HOME`): what every module shares, such as the app's state. */
export function brandHome(env: Record<string, string | undefined> = process.env): string {
  return set(env.WIZARDINGCODE_HOME) ? env.WIZARDINGCODE_HOME : join(homedir(), ".wizardingcode");
}

const absolute = (value: string) => isAbsolute(value) || win32.isAbsolute(value);

/**
 * Where the database lives. The data directory, unless the store was moved (an external
 * disk, a NAS): then `WIZARDINGCODE_MEM_STORE_DIR`, from the environment or the settings file.
 * The binary, the settings and the logs stay in the data directory either way.
 */
export function storeDirOf(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.WIZARDINGCODE_MEM_STORE_DIR;
  if (set(fromEnv) && absolute(fromEnv)) return fromEnv;
  const fromFile = readEnvFile(join(dataDir, ENV_FILE)).WIZARDINGCODE_MEM_STORE_DIR;
  if (fromFile !== undefined && absolute(fromFile)) return fromFile;
  return dataDir;
}

export function resolvePaths(env: Record<string, string | undefined> = process.env): {
  dataDir: string;
  storeDir: string;
} {
  const dataDir = defaultDataDir(env);
  return { dataDir, storeDir: storeDirOf(dataDir, env) };
}
