// Where releases are read from, and how a person gets one on each channel. The three shell
// commands are also in the README (tests/unit/update-docs.test.ts holds them there).

export const REPOSITORY = "WizardingCode-io/wizardingcode-mem";

export const CHANNEL_COMMANDS: ReadonlyArray<{ channel: string; command: string; shell: boolean }> =
  [
    {
      channel: "plugin",
      command: "update the wizardingcode-mem plugin from your agent's plugin manager",
      shell: false,
    },
    {
      channel: "Homebrew",
      command: "brew upgrade wizardingcode-mem && wizardingcode-mem install",
      shell: true,
    },
    { channel: "npm (and Windows)", command: "npx wizardingcode-mem@latest install", shell: true },
    {
      channel: "script",
      command:
        "curl -fsSL https://raw.githubusercontent.com/WizardingCode-io/wizardingcode-mem/main/scripts/install.sh | sh",
      shell: true,
    },
  ];
