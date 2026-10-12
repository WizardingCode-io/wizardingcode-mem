import { z } from "zod";
import type { EngineModule, Moment, MomentInput } from "../../src/engine/module.ts";

// A second module for tests only, never shipped: it proves that another module plugs into
// the engine through the contract alone. It says which moment it saw, in its own wrapper;
// inside a project it offers one tool, and it has one view.

export const ECHO_SHARE = 0.25;

export const echoText = (input: Pick<MomentInput, "moment">) =>
  `<echo-module>\n${input.moment}\n</echo-module>`;

export const ECHO_VIEW = { tab: "echo", label: "Echo", icon: "i-lucide-radio", key: "7" };

export function echoModule(
  options: { throwOn?: readonly Moment[]; id?: string; toolsThrow?: boolean } = {},
): EngineModule {
  const throwOn = new Set(options.throwOn ?? []);
  return {
    id: options.id ?? "echo",
    name: "Echo",
    share: ECHO_SHARE,
    contribute(input) {
      if (throwOn.has(input.moment)) throw new Error(`echo breaks on ${input.moment}`);
      const text = echoText(input);
      return text.length <= input.budgetChars ? text : null;
    },
    tools(mode) {
      if (options.toolsThrow) throw new Error("echo's tools break");
      if (mode === "global") return [];
      return [
        {
          name: "echo_say",
          description: "Say the text back.",
          inputSchema: z.object({ text: z.string() }),
          run: (args, call) => `${(args as { text: string }).text} (in ${call.projectDir})`,
        },
      ];
    },
    views: [ECHO_VIEW],
  };
}

export const echo = echoModule();
