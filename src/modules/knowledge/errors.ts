export type KnowledgeErrorCode =
  | "invalid"
  | "stale"
  | "exists"
  | "missing"
  | "dirty"
  | "locked"
  | "git"
  | "quota"
  | "too-new";

/** A refusal of the knowledge store. The code is what a caller branches on; the message is for the person. */
export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode;

  constructor(code: KnowledgeErrorCode, message: string) {
    super(message);
    this.name = "KnowledgeError";
    this.code = code;
  }
}

/** A git call that was killed for running past its time: not the same as a git that is missing. */
export class GitTimeoutError extends KnowledgeError {
  constructor(message: string) {
    super("git", message);
    this.name = "GitTimeoutError";
  }
}

/** The knowledge tables were written by a newer wizardingcode-mem. The store leaves them alone. */
export class ModuleSchemaTooNewError extends KnowledgeError {
  constructor(module: string, supported: number) {
    super(
      "too-new",
      `the ${module} tables are newer than this wizardingcode-mem supports (${supported}); upgrade wizardingcode-mem`,
    );
    this.name = "ModuleSchemaTooNewError";
  }
}
