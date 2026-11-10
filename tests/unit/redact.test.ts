import { describe, expect, test } from "bun:test";
import { findSecrets, PATTERN_RULES, redact } from "../../src/core/redact.ts";

describe("the team server's token and invitation code", () => {
  const token = ["wcm1_", "A".repeat(20), "b".repeat(20), "0_-"].join("");
  const code = ["wci1_", "B".repeat(13), "7".repeat(13)].join("");

  test("a token and a code are redacted by name, a bearer token as the team's, not as a header", () => {
    expect(String(redact(`token ${token}`))).toBe("token [REDACTED:team-token]");
    expect(String(redact(`code ${code}`))).toBe("code [REDACTED:team-invitation]");
    expect(findSecrets(`Authorization: Bearer ${token}`).map((match) => match.rule)).toEqual([
      "team-token",
    ]);
    expect(String(redact(`Authorization: Bearer ${token}`))).toBe(
      "Authorization: Bearer [REDACTED:team-token]",
    );
    expect(findSecrets(`a code of 25: wci1_${"B".repeat(25)}`)).toEqual([]);
  });

  test("the two rules carry the d and g flags and sit before auth-header", () => {
    const names = PATTERN_RULES.map((rule) => rule.rule);
    const tokenAt = names.indexOf("team-token");
    const codeAt = names.indexOf("team-invitation");
    const authAt = names.indexOf("auth-header");
    expect(tokenAt).toBeGreaterThan(-1);
    expect(codeAt).toBeGreaterThan(-1);
    expect(tokenAt).toBeLessThan(authAt);
    expect(codeAt).toBeLessThan(authAt);
    for (const rule of PATTERN_RULES.filter((entry) => entry.rule.startsWith("team-"))) {
      expect(rule.pattern.flags).toContain("d");
      expect(rule.pattern.flags).toContain("g");
    }
  });
});

// Fake credentials are assembled at runtime so secret scanners never see them whole.
const j = (...parts: string[]) => parts.join("");
const hex = (length: number) => "0123456789abcdef".repeat(8).slice(0, length);

const githubToken = j("ghp_", "0123456789abcdefghijklmnopqrstuvwxyzAB");
const pem = j(
  "-----BEGIN RSA PRIVATE",
  " KEY-----\nMIIEpAIBAAKCAQEAxyz0123456789abcdef\nQwErTyUiOp==\n-----END RSA PRIVATE",
  " KEY-----",
);
const opensshPem = j(
  "-----BEGIN OPENSSH PRIVATE",
  " KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ\n-----END OPENSSH PRIVATE",
  " KEY-----",
);
const jwt = j(
  "eyJ",
  "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  ".eyJ",
  "zdWIiOiIxMjM0NTY3ODkwIn0",
  ".",
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
);

/** [what it is, text containing it, the part that must not survive] */
const SECRETS: [string, string, string][] = [
  [
    "Anthropic key",
    `key ${j("sk-ant-", "api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")} here`,
    "AbCdEfGhIjKl",
  ],
  ["OpenAI project key", j("sk-", "proj-Zx9Y8w7V6u5T4s3R2q1P0oNmLkJiHgFe"), "Zx9Y8w7V6u5T"],
  ["OpenAI classic key", j("sk-", "Zx9Y8w7V6u5T4s3R2q1P0oNmLkJiHgFeDcBa"), "Zx9Y8w7V6u5T"],
  ["GitHub classic token", `token is ${githubToken}`, "0123456789abcdefghij"],
  [
    "GitHub OAuth token",
    j("gho_", "0123456789abcdefghijklmnopqrstuvwxyzAB"),
    "0123456789abcdefghij",
  ],
  [
    "GitHub server token",
    j("ghs_", "0123456789abcdefghijklmnopqrstuvwxyzAB"),
    "0123456789abcdefghij",
  ],
  [
    "GitHub fine-grained token",
    j("github_", "pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyzABCDEFGHIJ"),
    "11ABCDEFG0abcdef",
  ],
  ["GitLab token", j("glpat-", "abcdefghij0123456789"), "abcdefghij0123456789"],
  ["AWS access key id", `aws ${j("AKIA", "IOSFODNN7EXAMPLE")}`, "IOSFODNN7EXAMPLE"],
  ["AWS temporary key id", j("ASIA", "IOSFODNN7EXAMPLE"), "IOSFODNN7EXAMPLE"],
  [
    "Slack bot token",
    j("xoxb-", "123456789012-1234567890123-abcdefghijklmnopqrstuvwx"),
    "abcdefghijklmnop",
  ],
  [
    "Slack user token",
    j("xoxp-", "123456789012-1234567890123-abcdefghijklmnopqrstuvwx"),
    "abcdefghijklmnop",
  ],
  ["Stripe live key", j("sk_", "live_4eC39HqLyjWDarjtT1zdp7dc"), "4eC39HqLyjWDarjt"],
  ["Stripe restricted key", j("rk_", "test_4eC39HqLyjWDarjtT1zdp7dc"), "4eC39HqLyjWDarjt"],
  ["Google API key", j("AIza", "SyA-0123456789abcdefghijklmnopqrstu"), "0123456789abcdefghij"],
  ["npm token", j("npm_", "0123456789abcdefghijklmnopqrstuvwxyz"), "0123456789abcdefghij"],
  [
    "SendGrid key",
    j("SG.", "abcdefghijklmnopqrstuv.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"),
    "abcdefghijklmnopqrstuv",
  ],
  ["Hugging Face token", j("hf_", "abcdefghijklmnopqrstuvwxyzABCDEFGH"), "abcdefghijklmnop"],
  ["Twilio API key", j("SK", hex(32)), hex(32)],
  ["DigitalOcean token", j("dop_v1_", hex(64)), hex(64)],
  ["JWT", `Cookie: session=${jwt}`, "SflKxwRJSMeKKF2QT4fw"],
  ["RSA private key block", `key:\n${pem}\nend`, "MIIEpAIBAAKCAQEA"],
  ["OpenSSH private key block", opensshPem, "b3BlbnNzaC1rZXktdjE"],
  [
    "Postgres URL password",
    j("postgres://admin:", "s3cr3tP4ss", "@db.internal:5432/app"),
    "s3cr3tP4ss",
  ],
  [
    "HTTPS URL token",
    j("https://x-access-token:", githubToken, "@github.com/org/repo.git"),
    "0123456789abcdefghij",
  ],
  [
    "Redis URL password without user",
    j("redis://:", "p4ssw0rdvalue", "@cache:6379"),
    "p4ssw0rdvalue",
  ],
  [
    "Bearer header",
    j("Authorization: Bearer ", "abcdefghijklmnopqrstuvwxyz012345"),
    "abcdefghijklmnopqrstuvwxyz012345",
  ],
  [
    "lowercase bearer header",
    j("authorization: bearer ", "abcdefghijklmnopqrstuvwxyz012345"),
    "abcdefghijklmnop",
  ],
  [
    "Basic header",
    j("Authorization: Basic ", "dXNlcjpwYXNzd29yZDEyMw=="),
    "dXNlcjpwYXNzd29yZDEyMw",
  ],
  ["env assignment", j("DATABASE_PASSWORD=", "hunter2-correct-horse"), "hunter2-correct-horse"],
  [
    "quoted env assignment",
    j('API_KEY="', "9f8e7d6c5b4a39281706f5e4d3c2b1a0", '"'),
    "9f8e7d6c5b4a3928",
  ],
  ["JSON property", j('"client_secret": "', "Zm9vYmFyYmF6cXV4MTIzNDU2", '"'), "Zm9vYmFyYmF6cXV4"],
  ["YAML property", j("secret_key: ", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"), "wJalrXUtnFEMI"],
  [
    "camelCase assignment",
    j("accessToken = '", "ya29.a0AfH6SMBx-long-google-token-value", "'"),
    "a0AfH6SMBx",
  ],
  [
    "exported variable",
    j("export NPM_AUTH_TOKEN=", "f3a9c1e8b7d6a5f4e3d2c1b0"),
    "f3a9c1e8b7d6a5f4",
  ],
  ["passphrase", j("passphrase: ", "correct-horse-battery-staple-42"), "correct-horse-battery"],
  ["weak password", j("PGPASSWORD=", "letmein"), "letmein"],
  ["password with symbols", j("db_password = ", "Sup3rS3cret!x"), "Sup3rS3cret!x"],
  ["CLI flag", j("deploy --token=", "abcdef0123456789abcdef"), "abcdef0123456789abcdef"],
  ["HTTP header", j('curl -H "X-Api-Key: ', "abcd1234efgh5678ijkl", '"'), "abcd1234efgh5678ijkl"],
  ["Rails secret", j("SECRET_KEY_BASE=", hex(40)), hex(40)],
  ["short password name", j("DB_PASS=", "s3cretPw-xyz"), "s3cretPw-xyz"],
  ["pw name", j("ADMIN_PW=", "hunter2horse"), "hunter2horse"],
  [
    "Laravel app key",
    j("APP_KEY=base64:", "dGhpc2lzYXNlY3JldGtleTEyMzQ1Njc4OTA="),
    "dGhpc2lzYXNlY3JldGtleTEy",
  ],
  ["Rails master key", j("RAILS_MASTER_KEY=", hex(32)), hex(32)],
  ["session key", j("SESSION_KEY=", "k9s8d7f6g5h4j3k2l1"), "k9s8d7f6g5h4"],
  [
    "password flag with a space",
    j("mysqldump --user root --password ", "S3cretPw1x", " app"),
    "S3cretPw1x",
  ],
  ["mysql -p", j("mysql -u root -p", "S3cretPw1x", " app_db"), "S3cretPw1x"],
  ["curl -u", j("curl -u admin:", "S3cretPw1x", " https://api.example.com/v1"), "S3cretPw1x"],
  [
    "Authorization with another scheme",
    j("Authorization: Token ", "abcdef0123456789abcdef"),
    "abcdef0123456789",
  ],
  [
    "Cookie header",
    j("Cookie: sessionid=", "a1b2c3d4e5f6g7h8i9j0", "; theme=dark"),
    "a1b2c3d4e5f6g7h8",
  ],
  [
    "private key cut off before its end",
    j("-----BEGIN RSA PRIVATE", " KEY-----\nMIIEpAIBAAKCAQEAxyz0123456789abcdef\nQwErTyUiOp"),
    "MIIEpAIBAAKCAQEA",
  ],
  [
    "URL password containing @",
    j("postgres://app:", "p@ss:w0rdX9", "@db.internal:5432/app"),
    "ss:w0rdX9",
  ],
  ["private block", "before <private>my bank pin is 4242</private> after", "bank pin is 4242"],
  ["multi-line private block", "a\n<private>\nline one\nline two\n</private>\nb", "line one"],
  [
    "two secrets on one line",
    j("A_TOKEN=", "aaaa1111bbbb2222", " B_SECRET=", "cccc3333dddd4444"),
    "cccc3333dddd4444",
  ],
];

const HARMLESS: string[] = [
  "Fixed the login bug in src/auth/session.ts",
  "max_tokens: 4096",
  "total_tokens=128000",
  "const token = getToken()",
  "password: string",
  "apiKey: process.env.API_KEY",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell and CI syntax under test
  "secret=${SECRET}",
  "TOKEN=<your-token-here>",
  "password = null",
  'author = "Jane Doe Smith"',
  "the secretary = someone important",
  "commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39",
  "session 205fc789-847d-4d65-a969-6aa483d2fb82",
  "https://example.com/path?x=1",
  "git@github.com:org/repo.git",
  "user@example.com sent an email",
  "http://localhost:3000/api",
  "keyboard shortcut: ctrl+shift+p",
  "The token bucket algorithm refills 10 tokens per second",
  "Use Bearer authentication for the API",
  "sk-learn is a Python library",
  "the password_hash column stores bcrypt output",
  'tokenize = "unicode61 remove_diacritics 2"',
  "primary_key: identifier",
  "public_key_path=/etc/ssl/certs/server.pub",
  "TOKEN_EXPIRY_SECONDS=3600000",
  "TOKEN_ENDPOINT=https://auth.example.com/oauth/token",
  "apiKey: string | undefined",
  "password=********",
  "API_KEY=your_api_key_here",
  "cache key: user:42:profile",
  "a palavra-passe foi alterada na página de definições",
  "Set `secrets.GITHUB_TOKEN` in the workflow",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell and CI syntax under test
  "token: ${{ secrets.NPM_TOKEN }}",
  "ls -p /tmp/build",
  "mysql -u root -p app_db",
  "the bypass=enabled-for-admins flag",
  "cache_key=user-profile-page",
  "SESSION_KEY_PREFIX=sess-prod",
  "APP_KEYBOARD=us-international",
  "the --password flag is required",
  "accept the cookie banner first",
  "curl -L https://example.com/install.sh",
  "",
];

describe("redact", () => {
  test("the corpus is large enough to mean something", () => {
    expect(SECRETS.length).toBeGreaterThanOrEqual(40);
    expect(HARMLESS.length).toBeGreaterThanOrEqual(30);
  });

  test.each(SECRETS)("removes: %s", (_label, text, secret) => {
    const out = redact(text, { env: {} });
    expect(out).not.toContain(secret);
    expect(out).toMatch(/\[(REDACTED:[a-z-]+|PRIVATE)\]/);
  });

  test.each(HARMLESS)("leaves alone: %s", (text) => {
    expect(redact(text, { env: {} }) as string).toBe(text);
  });

  test.each([...SECRETS.map(([, text]) => text), ...HARMLESS])("is idempotent on: %s", (text) => {
    const once = redact(text, { env: {} });
    expect(redact(once, { env: {} })).toBe(once);
  });

  test("keeps the words around a secret", () => {
    const out = redact(
      j("connect to postgres://admin:", "s3cr3tP4ss", "@db.internal:5432/app now"),
      {
        env: {},
      },
    );
    expect(out).toStartWith("connect to postgres://");
    expect(out).toEndWith("@db.internal:5432/app now");
  });

  test("keeps the variable name and drops only its value", () => {
    expect(redact(j("DATABASE_PASSWORD=", "hunter2-correct-horse"), { env: {} }) as string).toBe(
      "DATABASE_PASSWORD=[REDACTED:assignment]",
    );
  });

  test("removes the exact value of a sensitive environment variable wherever it appears", () => {
    const value = "plain-looking-value-123";
    const out = redact(`the service answered with ${value} twice: ${value}`, {
      env: { MY_SERVICE_TOKEN: value, HOME: "/Users/dev", EDITOR: "plain-looking-editor" },
    });
    expect(out).not.toContain(value);
    expect(out).toContain("[REDACTED:env-value]");
  });

  test("ignores environment values too short to be meaningful", () => {
    expect(redact("the flag is on", { env: { DEBUG_TOKEN: "on" } }) as string).toBe(
      "the flag is on",
    );
  });

  test("findSecrets reports non-overlapping spans in order", () => {
    const text = j("A_TOKEN=", "aaaa1111bbbb2222", " and ", githubToken);
    const found = findSecrets(text, { env: {} });
    expect(found.map((match) => match.rule)).toEqual(["assignment", "github-token"]);
    for (let i = 1; i < found.length; i++) {
      expect(found[i]?.start).toBeGreaterThanOrEqual(found[i - 1]?.end ?? 0);
    }
  });

  test("stays fast on large input", () => {
    const text = `${"some ordinary sentence about a token bucket; ".repeat(12_000)}${githubToken}`;
    const started = performance.now();
    const out = redact(text, { env: {} });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).not.toContain(githubToken);
  });
});
