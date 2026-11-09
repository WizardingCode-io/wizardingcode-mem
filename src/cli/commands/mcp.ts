import { checkedAgentId } from "../../mcp/agent-id.ts";
import { runMcpServer } from "../../mcp/server.ts";
import { EXIT_USAGE } from "../exit.ts";

/**
 * `wizardingcode-mem mcp [--global] [--agent <id>]`: the MCP server on stdio. Returns once it
 * is listening; the process ends with its stdin. --global spans every project, for hosts
 * with no project folder (Claude Desktop's chat). --agent names the agent a knowledge
 * proposal is written under, in place of the name the host gives in its handshake.
 */
export async function run(argv: string[] = []): Promise<number> {
  const at = argv.indexOf("--agent");
  let agent: string | undefined;
  if (at !== -1) {
    try {
      agent = checkedAgentId(argv[at + 1] ?? "");
    } catch {
      process.stderr.write(
        "wizardingcode-mem mcp: --agent takes an id of lower-case letters, digits and hyphens\n",
      );
      return EXIT_USAGE;
    }
  }
  await runMcpServer({
    global: argv.includes("--global"),
    ...(agent === undefined ? {} : { agent }),
  });
  return 0;
}
