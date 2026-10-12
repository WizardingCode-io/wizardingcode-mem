# Homebrew formula for wizardingcode-mem. Lives in the tap WizardingCode-io/homebrew-wizardingcode as
# Formula/wizardingcode-mem.rb; this copy is the source it is updated from on each release.
#
#   brew install wizardingcode-io/wizardingcode/wizardingcode-mem
class WizardingcodeMem < Formula
  desc "Persistent memory for coding agents: one local binary, no daemon"
  homepage "https://github.com/WizardingCode-io/wizardingcode-mem"
  version "0.5.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.5.0/wizardingcode-mem-darwin-arm64"
      sha256 "6d52ca0a867c10734530b2cffb79f0b6c9768e1d610fcd8b173dfe580c668564"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.5.0/wizardingcode-mem-darwin-x64"
      sha256 "43edccb5f6e5a3e6026164592913f6b19f8a61f1c50261535c81cb01f2dafc1b"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.5.0/wizardingcode-mem-linux-arm64"
      sha256 "448bba60d886d907fc584d582694d26a0302cd76c023d7108fba90717393b7c3"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.5.0/wizardingcode-mem-linux-x64"
      sha256 "97e4d4a14bfa61405c0d8e9f4a4883235f8a35c6789dc5a693ed15d3219ab14f"
    end
  end

  def install
    bin.install Dir["wizardingcode-mem-*"].first => "wizardingcode-mem"
  end

  def caveats
    <<~EOS
      Set it up for the agents on this machine:
        wizardingcode-mem install
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/wizardingcode-mem --version")
  end
end
