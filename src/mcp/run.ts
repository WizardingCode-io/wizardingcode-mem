import type { EngineModule, ModuleTool, ToolMode } from "../engine/module.ts";
import { logError } from "../util/log.ts";

// The tools an agent is offered, reachable from the MCP server and from `wizardingcode-mem
// tool` alike: whatever the enabled modules offer, in module order.

/**
 * Every enabled module's tools for this mode, in module order. A module whose tools fail to
 * load offers none (told to `onError`); a name an earlier module already took is skipped.
 */
export async function moduleTools(
  modules: readonly EngineModule[],
  mode: ToolMode,
  onError: (moduleId: string, error: unknown) => void = (id, error) =>
    logError(`tools (module ${id})`, error),
): Promise<ModuleTool[]> {
  const tools: ModuleTool[] = [];
  const taken = new Set<string>();
  for (const module of modules) {
    let offered: ModuleTool[];
    try {
      offered = (await module.tools?.(mode)) ?? [];
    } catch (error) {
      onError(module.id, error);
      continue;
    }
    for (const tool of offered) {
      if (taken.has(tool.name)) {
        onError(module.id, new Error(`tool ${tool.name} is already offered`));
        continue;
      }
      taken.add(tool.name);
      tools.push(tool);
    }
  }
  return tools;
}

/**
 * What the model is told when it has no project folder (Claude Desktop's chat): each
 * enabled module's sentences, joined by one space in module order; undefined when no
 * module has any.
 */
export function globalInstructions(modules: readonly EngineModule[]): string | undefined {
  const parts = modules.flatMap((module) =>
    module.globalInstructions === undefined || module.globalInstructions === ""
      ? []
      : [module.globalInstructions],
  );
  return parts.length === 0 ? undefined : parts.join(" ");
}
