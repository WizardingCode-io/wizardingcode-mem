// One MCP session with the binary's entry point over stdio: the handshake under a client
// name of the test's choosing, the tool list, and any number of tool calls.

const MAIN = new URL("../../src/cli/main.ts", import.meta.url).pathname;

export interface McpSession {
  /** The `initialize` result. */
  initialize: { instructions?: string } & Record<string, unknown>;
  /** The `tools/list` result. */
  tools: { tools: unknown[] };
  /** The text of each call's answer, in the order of `calls`. */
  answers: string[];
}

export interface McpSessionOptions {
  /** The folder the server runs in, also its `CLAUDE_PROJECT_DIR`. */
  cwd: string;
  env: Record<string, string>;
  flags?: string[];
  clientName?: string;
  calls?: { name: string; arguments: Record<string, unknown> }[];
}

/**
 * Starts `mcp`, names the client `clientName` in `initialize`, lists the tools and sends
 * each `tools/call` of `calls`, in order; returns the three results.
 */
export async function runMcpSession(options: McpSessionOptions): Promise<McpSession> {
  const { flags = [], clientName = "test", calls = [] } = options;
  const lines: Record<string, unknown>[] = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: clientName, version: "0" },
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ...calls.map((call, at) => ({
      jsonrpc: "2.0",
      id: 3 + at,
      method: "tools/call",
      params: { name: call.name, arguments: call.arguments },
    })),
  ];
  const proc = Bun.spawn([process.execPath, MAIN, "mcp", ...flags], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, CLAUDE_PROJECT_DIR: options.cwd },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  for (const line of lines) proc.stdin.write(`${JSON.stringify(line)}\n`);
  await proc.stdin.flush();
  const results = new Map<number, Record<string, unknown>>();
  const ids = lines.flatMap((line) => (typeof line.id === "number" ? [line.id] : []));
  const reader = proc.stdout.getReader();
  let buffered = "";
  try {
    while (!ids.every((id) => results.has(id))) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`mcp ended early: ${buffered}`);
      buffered += new TextDecoder().decode(value);
      const parts = buffered.split("\n");
      buffered = parts.pop() ?? "";
      for (const line of parts) {
        if (line.trim() === "") continue;
        const message = JSON.parse(line) as {
          id?: number;
          result?: Record<string, unknown>;
          error?: { message?: string };
        };
        if (message.id === undefined) continue;
        if (message.result !== undefined) results.set(message.id, message.result);
        // A protocol error answers the request too: its text stands for the answer.
        else if (message.error !== undefined) {
          const text = `error: ${message.error.message ?? ""}`;
          results.set(message.id, { content: [{ type: "text", text }] });
        }
      }
    }
  } finally {
    proc.stdin.end();
    proc.kill();
    await proc.exited;
  }
  const textOf = (result: Record<string, unknown> | undefined) =>
    (result?.content as { text: string }[] | undefined)?.[0]?.text ?? "";
  return {
    initialize: results.get(1) as McpSession["initialize"],
    tools: results.get(2) as McpSession["tools"],
    answers: calls.map((_call, at) => textOf(results.get(3 + at))),
  };
}
