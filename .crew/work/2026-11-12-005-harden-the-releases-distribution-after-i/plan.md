# Plan: harden the release's distribution after its first review

Spec: `spec.md` in this folder. Branch `fix/release-hardening`, from `main` at `e4f8596`. Each phase leaves `bun run typecheck` and the named tests passing. Tests run with the pinned Bun: `./node_modules/.bin/bun test <file>`. Lint is run by name, since the lint gate checks no file inside a crew worktree: `./node_modules/.bin/biome check scripts tests`.

## Files

| File | Change | What and why |
| :- | :- | :- |
| `scripts/release/push.ts` | Modify | `encodedCredential` and `redact` (exported); `gitEnv` builds its header from `encodedCredential`; `commitAndPush` wraps its runner; `editTap` and `editMarketplace` exported; the command stops reading `PUSH_REMOTE` and `PUSH_ORIGIN` |
| `tests/integration/release-push.test.ts` | Modify | AC-9, AC-12; unit cases of the two new functions |
| `tests/integration/release-commands.test.ts` | Modify | AC-11, AC-17, AC-19 on a stub `git`; the three local-repository cases, the case "on a runner the two test overrides are ignored", and what only they used (`repository`, `tagged`, `env`, `git`, `IDENTITY`, the `run` import) are deleted |
| `.github/workflows/release.yml` | Modify | `timeout-minutes: 5` on the job `distribute` |
| `tests/unit/deploy-files.test.ts` | Modify | AC-6, in the existing case of `release.yml` |
| `docs/runbooks/release.md` | Modify | one paragraph under "Repeating a target" |
| `docs/real-use/findings.md` | Modify | the rows of 2026-11-12 "release distribution" (AC-21) |
| `docs/adr/0029-release-distribution.md` | Modify | the Decision paragraph on the token, and Limits (AC-22) |
| `CLAUDE.md` | Modify | the Releasing line (AC-22) |
| `tests/unit/release-docs.test.ts` | Modify | AC-20, AC-21, AC-22 |

No file is created or deleted. `scripts/release/lib.ts`, `gitEnv`'s output and `distribute.yml` do not change.

## Phase 1: the redaction and the exported edits (`push.ts`, `release-push.test.ts`)

Shapes in `scripts/release/push.ts`:

```ts
export function encodedCredential(token: string): string        // base64("x-access-token:" + token)
export function redact(text: string, token: string | null): string
// token null → text; else text.replaceAll(encodedCredential(token), "***")
```

`gitEnv` sets `GIT_CONFIG_VALUE_0` to `` `Authorization: Basic ${encodedCredential(token)}` ``. In `commitAndPush`, the line that picks the runner becomes a wrapper: it calls `options.runner ?? run` with the same command and options, and returns the same code with `stdout` and `stderr` passed through `redact(…, token)`. Nothing else in the function changes. `editTap` and `editMarketplace` gain `export`.

Test helpers in `tests/integration/release-push.test.ts`:

- `options`'s `edit` parameter is widened to `PushOptions["edit"]` (exported type, imported), and the `as never` of the existing left-alone case goes.
- `repository(name, files)` takes a record of path to content, creating parent folders; `beforeEach` calls it as `repository("other", { "a.txt": "one\n" })` and `repository("origin", { "package.json": "one\n" })`.
- `scripted(script)`: a `Runner` that counts calls per git subcommand (`cmd[1]`) and, for an entry `{ on: "push", nth: 1, answer: { code, stdout, stderr } }`, returns that answer without running git; every other call is delegated to `run`. An entry may instead give `add: { stdout?, stderr? }`, which runs git and appends the text to its real output.
- `QUOTED`: `` `fatal: unable to access: Authorization: Basic ${encodedCredential("secret")}` ``.

Tests, written and seen failing first:

- AC-9, in "the writer to another repository", all with `token: "secret"` unless said. Each failure case asserts the thrown message contains `Authorization: Basic ***` and not the encoded value:
  - the tag read: `{ on: "ls-remote", nth: 1, answer: code 1, stderr QUOTED }`;
  - the clone: `{ on: "clone", nth: 1, answer: code 128, stderr QUOTED }`;
  - the push: `{ on: "push", nth: 1, answer: code 1, stderr QUOTED }` (the sentence "the push to … failed");
  - the rebase: `push` 1 answers code 1 with `! [rejected] (fetch first)`, `pull` 1 answers code 1 with QUOTED;
  - the second push: `push` 1 answers `[rejected]` as above, `pull` runs for real, `push` 2 answers code 1 with QUOTED.
  - the dry run: `dryRun: true`, with `add: { stdout: QUOTED }` on `status` call 2 (`--short`) and on `diff` 1; the logged lines hold `***`, hold `+two`, and do not hold the encoded value.
  - the complement: the existing case "a push that fails for another reason" runs with `token: "secret"` and asserts the whole sentence equals `` `the push to ${other} failed: ${stderr}` `` where `stderr` is the trimmed text the real push returned, captured by a recording runner; and with `token: null`, the clone scripted to fail with QUOTED throws a sentence that still contains the encoded value.
- Unit cases in "gitEnv and tagNames": `redact` with a token whose encoding contains `+` or `/` (the test asserts that precondition on its chosen token), a text with two occurrences, a text with none (identical), `token` null. `gitEnv`'s existing case stays as it is.
- AC-12, a new `describe("the two edits")`. Each case creates its own bare repository with `repository` and passes it as `remote`; the tag stays the fixture's `v1.0.0` and the version written is the `version` option, `9.9.9`. Tap: a checksums file built from `REQUIRED_ASSETS` as the command's test does today; `commitAndPush(options(editTap("9.9.9", checksums), { remote, version: "9.9.9" }))` answers `written`, the bare repository's `Formula/wizardingcode-mem.rb` holds `version "9.9.9"` and no `@NAME@` placeholder; a second call answers `already-at` and the log is `["wizardingcode-mem 9.9.9", "first"]`. Marketplace: a repository holding both fixtures of `tests/fixtures/release/`; `written`, and both `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` name `9.9.9` (the second holds `"ref": "v9.9.9"`); then `editMarketplace("9.9.8")` answers `{ kind: "left-alone", higher: "9.9.9" }` and the head does not move.

Red for AC-12 is the import of two names that are not exported, which fails the file; it is recorded as that.

## Phase 2: the command (`push.ts`, `release-commands.test.ts`)

`gitStub({ sha, clone, quote })` writes the stub's cases through the existing `stub("git", …)`:

- `ls-remote *`: prints `<sha>\trefs/tags/v9.9.9`;
- `clone *`: runs the shell fragment `clone` in the clone folder (empty for the tap; for the marketplace, `mkdir -p .claude-plugin .agents/plugins` and `cp` of the two fixtures by absolute path). With `quote: "clone"` it instead prints `fatal: Authorization: Basic ${GIT_CONFIG_VALUE_0##* }` on standard error and exits 128: the value is the one `push.ts` put in the stub's own environment;
- `config *`, `add *`, `push *`: succeed silently; `status --porcelain`: prints ` M x`;
- `status --short`: prints ` M x`, and with `quote: "diff"` also the quoted header line; `diff`: prints `+two`, and with `quote: "diff"` also the quoted header line;
- `commit *`: copies `.agents/plugins/marketplace.json`, when it exists, to `<base>/committed.json`, then succeeds.

The command's environment for these cases: `TAG=v9.9.9`, `SHA`, `VERSION=9.9.9`, `DRY_RUN=false`, `GITHUB_REPOSITORY=o/r`, and `CHECKSUMS` for the tap. The test computes the encoded value of `secret` in JavaScript for its assertions.

Order:

1. AC-17 first, on the code as it is: `--target tap` (exit 0, empty standard error, summary `tap: written, 9.9.9\n`); `--target marketplace` (summary `marketplace: written, 9.9.9\n`, and `<base>/committed.json` holds `"ref": "v9.9.9"`); a moved tag (`sha` in the stub differs from `SHA`: exit 1, summary starts `tap: failed: v9.9.9 no longer names the commit that was judged`). `crew tdd before`.
2. AC-11, red: for each target, with `PUSH_REMOTE` and `PUSH_ORIGIN` set to `<base>/elsewhere.git`, with and without `GITHUB_ACTIONS=true`, the stub's log contains `ls-remote --tags https://github.com/o/r.git` and `clone --quiet https://github.com/WizardingCode-io/homebrew-wizardingcode.git .` (or `…/wizardingcode-plugins.git .`), and does not contain `elsewhere.git`. Off a runner this fails today.
3. AC-19, red, `--target tap` with `MARKETPLACE_TOKEN=secret`: (a) `quote: "clone"`: exit 1; standard output, standard error and the summary file do not contain the encoded value; the summary file starts `tap: failed:` and contains `Authorization: Basic ***`. (b) `DRY_RUN=true`, `quote: "diff"`: exit 0; standard output contains `Authorization: Basic ***` and `+two` and not the encoded value; the summary is `tap: would write 9.9.9 (dry run)\n`.
4. Code: `remote: REMOTES[target]`, `origin: https://github.com/${need("GITHUB_REPOSITORY")}.git`; the `onRunner` constant and its comment go. `token` stays `process.env.MARKETPLACE_TOKEN || null`.
5. Delete the three local-repository cases, the override case, and `repository`, `tagged`, `env`, `git`, `IDENTITY` and the `run` import if nothing else in the file uses them. `crew tdd green` for AC-11 and AC-19, `crew tdd after` for AC-17.

## Phase 3: the time limit

AC-6, red: in the existing case of `release.yml` in `tests/unit/deploy-files.test.ts`, `expect(distribute?.["timeout-minutes"]).toBe(5)`. Then the line in `.github/workflows/release.yml`.

## Phase 4: the documents

Tests first, in `tests/unit/release-docs.test.ts`, each red before its document is written:

- AC-20: the test takes the one paragraph of the runbook that contains `gh run list --workflow distribute.yml`; it lies between the headings "## Repeating a target" and "## Repairs". That paragraph contains the number read from `release.yml`'s `distribute` job (`timeout-minutes`) followed by " minutes", and all of `already published`, `already at`, `moved to` and "A bad release".
- AC-21: the test reads the table rows of `docs/real-use/findings.md` dated 2026-11-12 whose second cell starts with "release distribution", and selects by content, never by position. The rows whose last cell contains `2026-11-12-005`: one contains `redact`, one contains `PUSH_REMOTE` and `timeout-minutes`; no last cell of theirs starts with `deferred`. No row's last cell is `deferred, first of the follow-up`. The file contains a row with `version_of` whose last cell is `deferred, to the client update item`, and rows containing `GIT_CONFIG_GLOBAL`, "time limit" and `MARKETPLACE_TOKEN` (no assertion on their status, so a later item that answers them changes only the document).
- AC-22: ADR 0029 contains "redacts the encoded credential by exact match", "no destination from its environment", `commitAndPush` and `::add-mask::`; the Releasing line of `CLAUDE.md` (the one line starting `- Releasing (ADR 0029`, cut out before looking) contains "by exact match" and "no destination from its environment".

Then the documents, as the spec's Design 3 and Design 4 say: the runbook's paragraph writes the limit as "5 minutes"; ADR 0029's Decision paragraph on the token takes the redaction, its limit and the sentence on the runner's own masking and the absent `::add-mask::` line, and its Limits take the command's missing destination seam and "writes are tested through `commitAndPush`"; the findings rows are split and written as Design 4 lists them.

## Verification

- `./node_modules/.bin/bun test tests/integration/release-push.test.ts tests/integration/release-commands.test.ts tests/unit/deploy-files.test.ts tests/unit/release-docs.test.ts tests/unit/release-lib.test.ts`
- `bun run typecheck`; `./node_modules/.bin/biome check scripts tests`; `bun run test` once before the gates.
- `grep -rn "PUSH_REMOTE\|PUSH_ORIGIN" scripts src` prints nothing; in `tests/` the names remain only in the AC-11 case.
- Not verifiable here, said in the report: the runner's own masking of the header, and that 5 minutes covers the dispatch. Both are seen on the next release.
