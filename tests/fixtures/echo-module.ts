import type { EngineModule, Moment, MomentInput } from "../../src/engine/module.ts";

// A second module for tests only, never shipped: it proves that another module plugs into
// the engine through the contract alone. It says which moment it saw, in its own wrapper.

export const ECHO_SHARE = 0.25;

export const echoText = (input: Pick<MomentInput, "moment">) =>
  `<echo-module>\n${input.moment}\n</echo-module>`;

export function echoModule(options: { throwOn?: readonly Moment[]; id?: string } = {}): EngineModule {
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
  };
}

export const echo = echoModule();
