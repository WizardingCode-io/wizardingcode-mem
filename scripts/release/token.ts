// The marketplace token's state for one repository it must write: a missing, expired or
// ungranted token fails with its own sentence, and one near its expiry is a warning.
//
//   bun scripts/release/token.ts <owner/repo>
//
// Environment: MARKETPLACE_TOKEN.
import { command, decideToken, ReleaseError, run, summary } from "./lib.ts";

/** One `gh api -i` answer: the status line, the headers, a blank line, the body. */
function parse(answer: string): {
  status: number | null;
  expiration: string | null;
  push: boolean | null;
} {
  const [head = "", ...rest] = answer.replaceAll("\r\n", "\n").split("\n\n");
  const lines = head.split("\n");
  const status = /^HTTP\/[\d.]+ (\d{3})/.exec(lines[0] ?? "");
  const header = lines.find((line) =>
    line.toLowerCase().startsWith("github-authentication-token-expiration:"),
  );
  let push: boolean | null = null;
  try {
    const body = JSON.parse(rest.join("\n\n")) as { permissions?: { push?: unknown } };
    if (typeof body.permissions?.push === "boolean") push = body.permissions.push;
  } catch {
    // A body that is not JSON says nothing about the permission.
  }
  return {
    status: status === null ? null : Number(status[1]),
    expiration: header === undefined ? null : header.slice(header.indexOf(":") + 1).trim(),
    push,
  };
}

command("token", () => {
  const repo = process.argv[2];
  if (repo === undefined)
    throw new ReleaseError("usage: bun scripts/release/token.ts <owner/repo>");
  const token = process.env.MARKETPLACE_TOKEN ?? "";
  // gh reads the token from its environment, so it is in no argument.
  const answer =
    token === ""
      ? null
      : run(["gh", "api", "-i", `repos/${repo}`], { env: { ...process.env, GH_TOKEN: token } });
  const read =
    answer === null ? { status: null, expiration: null, push: null } : parse(answer.stdout);
  const state = decideToken({
    token: token !== "",
    ...read,
    error: answer === null ? null : answer.stderr.trim(),
    now: new Date(),
    repo,
  });
  if (!state.ok) throw new ReleaseError(state.message);
  if (state.level === "warning") process.stdout.write(`::warning::${state.message}\n`);
  summary(state.message);
});
