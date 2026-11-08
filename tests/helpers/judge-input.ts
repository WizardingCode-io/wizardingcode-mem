import { type Redacted, redact } from "../../src/core/redact.ts";
import { prepareTexts } from "../../src/distill/pipeline.ts";
import type { DistillInput } from "../../src/judge/types.ts";

const r = (text: string): Redacted => redact(text, { env: {} });

/**
 * Builds what the distillation pipeline would hand a judge for this turn: the host's blocks
 * removed, the texts segmented, the noise filter run (`prepareTexts`, as the drain does).
 */
export function distillInput(
  prompt: string,
  finalText: string,
  extra: { filesChanged?: string[]; commands?: string[]; hadErrors?: boolean } = {},
): DistillInput {
  const prepared = prepareTexts(r(prompt), r(finalText), []);
  return {
    prompt: prepared.prompt,
    finalText: prepared.finalText,
    candidates: prepared.candidates,
    filesChanged: extra.filesChanged ?? [],
    commands: (extra.commands ?? []).map(r),
    hadErrors: extra.hadErrors ?? false,
  };
}
