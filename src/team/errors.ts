// The team server's own errors. A leaf: nothing of the server imports anything to throw these.

/** What a route handler throws; the router turns it into the problem answer with its status. */
export class HttpError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: { error: string } & Record<string, unknown>) {
    super(body.error);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/** A file named `team.db` that no team server wrote: a client store copied over, or a stranger. */
export class NotATeamDatabaseError extends Error {
  constructor() {
    super("not a team database");
    this.name = "NotATeamDatabaseError";
  }
}

/** A writer subcommand of a newer binary met a database a running older server holds. */
export class SchemaBehindError extends Error {
  constructor() {
    super("the server runs an older schema; upgrade the image first");
    this.name = "SchemaBehindError";
  }
}

/** A subcommand that needs the server stopped found its lease fresh. */
export class ServerRunningError extends Error {
  constructor(sub: string) {
    super(
      `stop the server first: docker compose stop server && docker compose run --rm server serve ${sub}`,
    );
    this.name = "ServerRunningError";
  }
}

/** Another owner holds the lease, until the time given. */
export class LeaseHeldError extends Error {
  readonly until: number;
  constructor(key: string, until: number) {
    super(`${key} is held until ${new Date(until).toISOString()}`);
    this.name = "LeaseHeldError";
    this.until = until;
  }
}

/** The exit code of `serve` against a `team.db` a newer wizardingcode-mem wrote. */
export const TEAM_SCHEMA_TOO_NEW = 3;
