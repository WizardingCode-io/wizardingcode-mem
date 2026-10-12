import pkg from "../../package.json" with { type: "json" };
import type { EngineModule } from "../engine/module.ts";
import { enabledModules } from "../engine/modules.ts";
import { loadSettings } from "../settings/settings.ts";
import { logError } from "../util/log.ts";
import { defaultDataDir } from "../util/paths.ts";
import { GLOBAL_INSTRUCTIONS, moduleTools } from "./run.ts";

// Tool descriptions are sent to the model in every session, so each is one sentence.

/**
 * The MCP server: the enabled modules' tools over stdio (memory's: project_links inside a
 * project, memory_projects with --global). It lives as long as the host keeps its stdin
 * open, and holds no database connection between calls.
 */
export async function runMcpServer(
  options: { global?: boolean; modules?: readonly EngineModule[] } = {},
): Promise<void> {
  const global = options.global === true;
  // The SDK is loaded here and nowhere else: hooks must never pay for it.
  const { McpServer } = await import("@modelcontextprotocol/server");
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  const modules =
    options.modules ?? enabledModules(loadSettings(process.env, defaultDataDir()).modules);
  const tools = await moduleTools(modules, global ? "global" : "project");

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
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        ...(tool.title === undefined ? {} : { title: tool.title }),
        ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: unknown) => {
        try {
          return answer(
            await tool.run(args, {
              projectDir: global ? null : process.env.CLAUDE_PROJECT_DIR || process.cwd(),
            }),
          );
        } catch (error) {
          logError(`mcp ${tool.name}`, error);
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
