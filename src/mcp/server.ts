import pkg from "../../package.json" with { type: "json" };
import { logError } from "../util/log.ts";
import {
  GLOBAL_INSTRUCTIONS,
  GLOBAL_TOOL_DESCRIPTIONS,
  GLOBAL_TOOL_NAMES,
  PROJECT_TOOL_NAMES,
  runGlobalTool,
  runTool,
  TOOL_DESCRIPTIONS,
  TOOL_META,
  toolSchemas,
} from "./run.ts";

// Tool descriptions are sent to the model in every session, so each is one sentence.

/**
 * The MCP server: its tools over stdio (project_links inside a project, memory_projects with --global). It lives as long as the host keeps its
 * stdin open, and holds no database connection between calls.
 */
export async function runMcpServer(options: { global?: boolean } = {}): Promise<void> {
  const global = options.global === true;
  // The SDK is loaded here and nowhere else: hooks must never pay for it.
  const { McpServer } = await import("@modelcontextprotocol/server");
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  const schemas = await toolSchemas(global);

  const answer = (text: string, isError = false) => ({
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  });

  // Without a project folder (Claude Desktop's chat) the server spans every project and
  // tells the model how to use it.
  const server = new McpServer(
    { name: "wizardingcode-mem", version: pkg.version },
    global ? { instructions: GLOBAL_INSTRUCTIONS } : undefined,
  );
  for (const name of global ? GLOBAL_TOOL_NAMES : PROJECT_TOOL_NAMES) {
    server.registerTool(
      name,
      {
        title: TOOL_META[name].title,
        annotations: TOOL_META[name].annotations,
        description: global
          ? GLOBAL_TOOL_DESCRIPTIONS[name as keyof typeof GLOBAL_TOOL_DESCRIPTIONS]
          : TOOL_DESCRIPTIONS[name as (typeof PROJECT_TOOL_NAMES)[number]],
        inputSchema: schemas[name],
      },
      async (args: unknown) => {
        try {
          return answer(
            global
              ? await runGlobalTool(name, args)
              : await runTool(name, args, process.env.CLAUDE_PROJECT_DIR || process.cwd()),
          );
        } catch (error) {
          logError(`mcp ${name}`, error);
          return answer(
            `wizardingcode-mem: ${error instanceof Error ? error.message : String(error)}`,
            true,
          );
        }
      },
    );
  }

  await server.connect(new StdioServerTransport());
}
