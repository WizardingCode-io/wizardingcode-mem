# wizardingcode-mem

Memory for coding agents. What one session learns, the next one is told — in Claude Code, Codex, OpenCode, Cursor, Qwen Code, Factory Droid, GitHub Copilot and Antigravity, from the same memory. One local binary, no daemon, no model in the loop, nothing leaves your machine unless you ask.

This package is the binary's npm front door:

```sh
npx wizardingcode-mem install
```

fetches the binary for your platform from the matching GitHub release (checksum verified), keeps it in `~/.wizardingcode/mem/bin`, and sets it up for every supported agent found on the machine. Nothing runs at install time.

Most people will not need it: each agent installs wizardingcode-mem itself (`claude plugin install wizardingcode-mem@wizardingcode-plugins`, `codex plugin add wizardingcode-mem@wizardingcode-plugins`, `opencode plugin wizardingcode-mem-opencode --global`).

Everything else — what it remembers, what your agent sees, the viewer, privacy, the optional TypeSafe judge — is in the [repository README](https://github.com/WizardingCode-io/wizardingcode-mem#readme).

A [WizardingCode](https://wizardingcode.io) product. Apache-2.0.
