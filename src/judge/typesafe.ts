import { type Answer, type SystemOneRequest, systemOne, TypeSafeError } from "./client.ts";
import {
  consolidateQuestions,
  consolidateState,
  consolidateVerdict,
  distillQuestions,
  distillState,
  distillVerdict,
  personalQuestions,
  personalState,
  personalVerdict,
} from "./questions.ts";
import type {
  ConsolidateInput,
  ConsolidateVerdict,
  DistillInput,
  DistillVerdict,
  Judge,
  PersonalInput,
  PersonalVerdict,
} from "./types.ts";

export interface TypeSafeJudgeOptions {
  apiKey: string;
  fetch?: typeof fetch;
  endpoint?: string;
  /** Per attempt. */
  timeoutMs?: number;
  /** Waits between attempts; their number is the number of retries. */
  retryDelaysMs?: number[];
  /** Input tokens of each request, for the cost to be visible. */
  onUsage?: (inputTokens: number) => void;
}

/** Errors worth another try: the service was busy, or the network blinked. */
const RETRIABLE = new Set(["rate", "overloaded", "network", "timeout", "server"]);

/**
 * The judge backed by TypeSafe's System One model. One request per turn for
 * distillation, one per draft for consolidation; nothing is generated, only judged.
 * It runs in the background, so a few seconds are acceptable; it never runs in a hook.
 */
export class TypeSafeJudge implements Judge {
  readonly name = "typesafe";
  readonly version = "1";
  readonly versions = { typesafe: "1" };
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: number[];

  constructor(private readonly options: TypeSafeJudgeOptions) {
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.retryDelaysMs = options.retryDelaysMs ?? [250, 1000];
  }

  async distill(input: DistillInput): Promise<DistillVerdict> {
    const answers = await this.ask({
      state: distillState(input),
      questions: distillQuestions(input),
    });
    return distillVerdict(input, answers);
  }

  async consolidate(input: ConsolidateInput): Promise<ConsolidateVerdict> {
    if (input.neighbours.length === 0) return { source: "typesafe", perNeighbour: [] };
    const answers = await this.ask({
      state: consolidateState(input),
      questions: consolidateQuestions(input),
    });
    return consolidateVerdict(input, answers);
  }

  /** One request per proposed rule, in the background, never on a hook path. */
  async personal(input: PersonalInput): Promise<PersonalVerdict> {
    const answers = await this.ask({ state: personalState(input), questions: personalQuestions() });
    return personalVerdict(answers);
  }

  private async ask(request: SystemOneRequest): Promise<Record<string, Answer>> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await systemOne(request, {
          apiKey: this.options.apiKey,
          timeoutMs: this.timeoutMs,
          ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
          ...(this.options.endpoint ? { endpoint: this.options.endpoint } : {}),
        });
        this.options.onUsage?.(response.usage.input_tokens);
        return response.answers;
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        const retriable = error instanceof TypeSafeError && RETRIABLE.has(error.kind);
        if (!retriable || delay === undefined) throw error;
        await Bun.sleep(delay);
      }
    }
  }
}
