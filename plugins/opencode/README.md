# wizardingcode-mem for OpenCode

```
opencode plugin wizardingcode-mem-opencode --global
```

Persistent memory for OpenCode sessions, shared with Claude Code, Codex, Cursor, Qwen Code, Factory Droid, GitHub Copilot and Antigravity. The plugin fetches the [wizardingcode-mem](https://github.com/WizardingCode-io/wizardingcode-mem) binary of its own version on first use (checksum verified) and keeps it in `~/.wizardingcode/mem/bin`. Memories live in `~/.wizardingcode/mem`.
