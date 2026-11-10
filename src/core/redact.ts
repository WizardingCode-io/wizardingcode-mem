/**
 * Text that has been through `redact`. The store and the network client accept
 * nothing else, so unredacted text cannot reach disk or leave the machine by accident.
 */
export type Redacted = string & { readonly __redacted: unique symbol };

export interface SecretMatch {
  rule: string;
  start: number;
  end: number;
}

export interface RedactOptions {
  /** Environment whose sensitive values are removed verbatim. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

interface PatternRule {
  rule: string;
  /** Must carry the `g` and `d` flags. */
  pattern: RegExp;
  /** Capture group holding the secret; the whole match when absent. */
  group?: number;
}

// Rule-based detection is fallible: it finds credentials with a known shape and values
// assigned to sensitive names. A secret with neither is not recognised.
const PATTERNS: PatternRule[] = [
  {
    rule: "private-key",
    // To the END line, or to the end of the text when the block was cut short.
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/dg,
  },
  { rule: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/dg },
  { rule: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/dg },
  {
    rule: "github-token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/dg,
  },
  { rule: "gitlab-token", pattern: /\bglpat-[A-Za-z0-9_-]{20,}/dg },
  { rule: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/dg },
  { rule: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/dg },
  { rule: "stripe-key", pattern: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/dg },
  { rule: "google-api-key", pattern: /\bAIza[0-9A-Za-z_-]{35}/dg },
  { rule: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}/dg },
  { rule: "sendgrid-key", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/dg },
  { rule: "huggingface-token", pattern: /\bhf_[A-Za-z0-9]{30,}/dg },
  { rule: "twilio-key", pattern: /\bSK[0-9a-f]{32}\b/dg },
  { rule: "digitalocean-token", pattern: /\bdop_v1_[a-f0-9]{64}\b/dg },
  { rule: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/dg },
  {
    rule: "url-credentials",
    // Bounded scheme: an unbounded one is quadratic on long runs of hex or base64.
    // Greedy up to the last "@" of the authority: a password may itself contain "@".
    pattern: /\b[a-z][a-z0-9+.-]{0,30}:\/\/([^/\s:@]*:[^/\s]+)@/dgi,
    group: 1,
  },
  // The team server's device token and invitation code (ADR 0026), ahead of the header rules
  // so a bearer token is named as what it is.
  { rule: "team-token", pattern: /\bwcm1_[A-Za-z0-9_-]{43}/dg },
  { rule: "team-invitation", pattern: /\bwci1_[A-Z2-7]{26}/dg },
  {
    rule: "auth-header",
    pattern: /\b(?:Bearer|Basic)[ \t]+([A-Za-z0-9._~+/=-]{16,})/dgi,
    group: 1,
  },
  {
    rule: "auth-header",
    pattern: /\bAuthorization:[ \t]*[A-Za-z-]+[ \t]+([^\s"']{8,})/dgi,
    group: 1,
  },
  { rule: "cookie", pattern: /\b(?:Set-)?Cookie:[ \t]*([^\n"']{8,})/dgi, group: 1 },
  // Command lines. `-p` is lower case on purpose: `-P` is the port.
  {
    rule: "cli-secret",
    pattern: /\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s-p([^\s"']{3,})/dg,
    group: 1,
  },
  {
    rule: "cli-secret",
    pattern: /\bcurl\b[^\n|;&]{0,300}?\s(?:-u|--user)[ \t]+(?!\S*\/\/)([^\s"':]+:[^\s"']+)/dg,
    group: 1,
  },
];

/** The shape rules in the order they are tried: a test pins where a rule sits and its flags. */
export const PATTERN_RULES: readonly Pick<PatternRule, "rule" | "pattern">[] = PATTERNS;

// `--password value`: the value follows a space. (`--password=value` is an assignment.)
const CLI_FLAG =
  /(?:^|\s)--?(?:password|passwd|pass|pwd|token|secret|api-key|apikey)[ \t]+(?!-)([^\s"']{6,})/dgi;

const PRIVATE_BLOCK = /<private>[\s\S]*?(?:<\/private>|$)/dgi;

// name [:=] value, with either side optionally quoted. Group 2 is the name, group 4 the value.
const ASSIGNMENT =
  /(["']?)\b([A-Za-z][A-Za-z0-9_.-]{1,60})\1[ \t]*[:=][ \t]*(["'`]?)([^\s"'`,;]{6,})\3/dg;

const PASSWORD_WORDS = ["password", "passwd", "pwd", "passphrase"];
// Matched whole, not as endings: "bypass" and "compass" are not passwords.
const SHORT_PASSWORD_WORDS = new Set(["pass", "pw"]);
const SECRET_WORDS = [...PASSWORD_WORDS, "secret", "token", "apikey", "credential", "credentials"];
const KEY_QUALIFIERS = new Set([
  "api",
  "access",
  "private",
  "secret",
  "auth",
  "signing",
  "encryption",
  "app",
  "master",
  "session",
  "ssh",
  "deploy",
  "license",
  "hmac",
  "jwt",
  "webhook",
]);
// Words that may follow the sensitive part of a name without changing what it holds.
const TRAILING = new Set([
  "base",
  "value",
  "prod",
  "production",
  "dev",
  "staging",
  "live",
  "old",
  "new",
]);

type Sensitivity = "password" | "secret" | null;

function words(name: string): string[] {
  return name
    .split(/[_.-]+/)
    .flatMap((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .split(" "),
    )
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
}

/** A name is sensitive when its head noun is: `GITHUB_TOKEN` yes, `TOKEN_ENDPOINT` no. */
function sensitivity(name: string): Sensitivity {
  const parts = words(name);
  while (parts.length > 1 && TRAILING.has(parts[parts.length - 1] as string)) parts.pop();
  const last = parts[parts.length - 1];
  if (last === undefined) return null;
  if (SHORT_PASSWORD_WORDS.has(last)) return "password";
  if (PASSWORD_WORDS.some((word) => last.endsWith(word))) return "password";
  if (last === "authorization" || SECRET_WORDS.some((word) => last.endsWith(word))) return "secret";
  const previous = parts[parts.length - 2];
  if (last === "key" && previous !== undefined && KEY_QUALIFIERS.has(previous)) return "secret";
  return null;
}

const PLACEHOLDER =
  /^(?:<|\$|\{\{|%|\[REDACTED:|\[PRIVATE\]|(?:your|example|changeme|placeholder|dummy|sample|fake|xxx+|todo|none|null|nil|undefined|true|false)(?:[_.-]|$))/i;
const TYPE_KEYWORD =
  /^(?:string|number|boolean|bool|int|str|any|unknown|required|optional|object|bytes)$/i;
const AUTH_SCHEME = /^(?:bearer|basic|digest)$/i;
const IDENTIFIER_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function looksLikeSecretValue(value: string, kind: Exclude<Sensitivity, null>): boolean {
  if (PLACEHOLDER.test(value) || TYPE_KEYWORD.test(value) || AUTH_SCHEME.test(value)) return false;
  if (!/[A-Za-z0-9]/.test(value) || /^\d+$/.test(value)) return false;
  // Code, not data: a call or a property access.
  if (/[()]/.test(value) || IDENTIFIER_PATH.test(value)) return false;
  return kind === "password" || /\d/.test(value) || value.length >= 16;
}

function candidates(text: string, env: Record<string, string | undefined>): SecretMatch[] {
  const found: SecretMatch[] = [];

  for (const match of text.matchAll(PRIVATE_BLOCK)) {
    found.push({ rule: "private", start: match.index, end: match.index + match[0].length });
  }

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value.length < 8 || sensitivity(name) === null) continue;
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + value.length)) {
      found.push({ rule: "env-value", start: at, end: at + value.length });
    }
  }

  for (const { rule, pattern, group } of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const span = match.indices?.[group ?? 0];
      if (span !== undefined) found.push({ rule, start: span[0], end: span[1] });
    }
  }

  for (const match of text.matchAll(ASSIGNMENT)) {
    const kind = sensitivity(match[2] ?? "");
    const span = match.indices?.[4];
    if (kind === null || span === undefined) continue;
    if (looksLikeSecretValue(match[4] ?? "", kind)) {
      found.push({ rule: "assignment", start: span[0], end: span[1] });
    }
  }

  for (const match of text.matchAll(CLI_FLAG)) {
    const span = match.indices?.[1];
    if (span !== undefined && looksLikeSecretValue(match[1] ?? "", "secret")) {
      found.push({ rule: "cli-secret", start: span[0], end: span[1] });
    }
  }

  return found;
}

/** Secrets in `text`, in order of appearance. Where two rules overlap, the earlier rule wins. */
export function findSecrets(text: string, options: RedactOptions = {}): SecretMatch[] {
  const accepted: SecretMatch[] = [];
  for (const match of candidates(text, options.env ?? process.env)) {
    // A span that already holds a placeholder has had its secret removed by an earlier pass.
    if (match.rule !== "private" && text.slice(match.start, match.end).includes("[REDACTED:")) {
      continue;
    }
    if (accepted.every((other) => match.end <= other.start || match.start >= other.end)) {
      accepted.push(match);
    }
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export function redact(text: string, options: RedactOptions = {}): Redacted {
  let out = "";
  let cursor = 0;
  for (const match of findSecrets(text, options)) {
    out += text.slice(cursor, match.start);
    out += match.rule === "private" ? "[PRIVATE]" : `[REDACTED:${match.rule}]`;
    cursor = match.end;
  }
  return (out + text.slice(cursor)) as Redacted;
}
