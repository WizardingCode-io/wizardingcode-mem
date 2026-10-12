import { enabledModules } from "../../engine/modules.ts";
import { moduleTools } from "../../mcp/run.ts";
import { loadSettings } from "../../settings/settings.ts";
import { logError } from "../../util/log.ts";
import { defaultDataDir } from "../../util/paths.ts";
import { EXIT_USAGE } from "../exit.ts";

const usage = (project: readonly string[], global: readonly string[]) =>
  `Usage: wizardingcode-mem tool <${project.join("|")}> --project <dir>  (JSON arguments on stdin)
       wizardingcode-mem tool <${global.join("|")}> --global   (every project)\n`;

/**
 * `wizardingcode-mem tool <name> --project <dir>`: one tool call outside MCP, for hosts whose
 * plugins define tools natively (OpenCode). Arguments come as JSON on stdin; the answer
 * is the tool's text. It is the agent's transport, so it offers the enabled modules' tools as
 * the MCP server does (memory's project_links too); it is not a command for people to link
 * projects with.
 */
export async function run(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const at = rest.indexOf("--project");
  const projectDir = at === -1 ? undefined : rest[at + 1];
  const global = rest.includes("--global");
  const modules = enabledModules(loadSettings(process.env, defaultDataDir()).modules);
  const tools = await moduleTools(modules, global ? "global" : "project");
  const tool = tools.find((candidate) => candidate.name === name);
  const help = async () => {
    const other = await moduleTools(modules, global ? "project" : "global");
    const names = (list: typeof tools) => list.map((each) => each.name);
    return global ? usage(names(other), names(tools)) : usage(names(tools), names(other));
  };
  if (tool === undefined) {
    process.stderr.write(`wizardingcode-mem tool: unknown tool "${name ?? ""}"\n${await help()}`);
    return EXIT_USAGE;
  }
  if (!global && (projectDir === undefined || projectDir === "")) {
    process.stderr.write(`wizardingcode-mem tool: --project <dir> is required\n${await help()}`);
    return EXIT_USAGE;
  }
  let args: unknown;
  try {
    const raw = await Bun.stdin.text();
    args = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    process.stderr.write("wizardingcode-mem tool: stdin must hold the arguments as JSON\n");
    return EXIT_USAGE;
  }
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
      .join("; ");
    process.stderr.write(`wizardingcode-mem tool ${name}: ${issues}\n`);
    return EXIT_USAGE;
  }
  try {
    const answer = await tool.run(parsed.data, {
      projectDir: global ? null : (projectDir as string),
    });
    process.stdout.write(`${answer}\n`);
    return 0;
  } catch (error) {
    logError(`tool ${name}`, error);
    process.stderr.write(
      `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
