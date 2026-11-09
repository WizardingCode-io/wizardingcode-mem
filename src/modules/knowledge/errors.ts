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

/**
 * Whether an error is the store refusing what it was given as it stands (code `invalid`:
 * a repository it did not make, or a request it cannot take), rather than a fault such as
 * a missing git or a lease held elsewhere. The one place that says so: a command over
 * several repositories sets a refusal aside and goes on.
 */
export const isRefusal = (error: unknown): error is KnowledgeError =>
  error instanceof KnowledgeError && error.code === "invalid";

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
