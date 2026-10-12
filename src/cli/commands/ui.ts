import { startUi, UiClaimedError, type UiServer } from "../../ui/server.ts";
import { askToOpen, clearUiState, probeUi, readUiState } from "../../ui/state.ts";
import { brandHome, defaultDataDir } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const USAGE = "Usage: wizardingcode-mem ui [--port <n>] [--no-open] [--auto]\n";

/** Blocks until the host asks us to leave. */
async function serve(server: UiServer): Promise<void> {
  await new Promise<void>((resolve) => {
    const bye = () => void server.stop().then(resolve);
    process.once("SIGINT", bye);
    process.once("SIGTERM", bye);
  });
}

/**
 * `ui --auto`, started in the background when a session begins: shows the viewer that
 * is already running, or becomes it. Prints nothing; the session must not notice it.
 */
async function auto(dataDir: string): Promise<number> {
  const homeDir = brandHome();
  const recorded = readUiState(homeDir, dataDir);
  if (recorded !== null) {
    if (await probeUi(recorded)) {
      await askToOpen(recorded);
      return 0;
    }
    clearUiState(homeDir);
  }
  let server: UiServer;
  try {
    server = await startUi({
      dataDir,
      homeDir,
      open: true,
      exclusive: true,
      onIdle: () => process.exit(0),
    });
  } catch (error) {
    if (!(error instanceof UiClaimedError)) throw error;
    // Another session's viewer got there first; let it show itself.
    const winner = readUiState(homeDir, dataDir);
    if (winner !== null && (await probeUi(winner))) await askToOpen(winner);
    return 0;
  }
  await serve(server);
  return 0;
}

/**
 * `wizardingcode-mem ui`: opens the viewer in the browser. Loopback only, token in the URL,
 * stops by itself after half an hour without a request or a tab.
 */
export async function run(argv: string[]): Promise<number> {
  const dataDir = defaultDataDir();
  if (argv.includes("--auto")) return auto(dataDir);
  const at = argv.indexOf("--port");
  const port = at === -1 ? 0 : Number(argv[at + 1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`wizardingcode-mem ui: --port takes a port number\n${USAGE}`);
    return EXIT_USAGE;
  }
  const server = await startUi({
    dataDir,
    port,
    open: !argv.includes("--no-open"),
    onIdle: () => {
      process.stdout.write("wizardingcode-mem ui: no requests for a while, stopping.\n");
      process.exit(0);
    },
  });
  process.stdout.write(`wizardingcode-mem ui: ${server.url}\n`);
  await serve(server);
  return 0;
}
