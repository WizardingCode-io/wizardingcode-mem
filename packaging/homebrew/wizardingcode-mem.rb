# Homebrew formula for wizardingcode-mem. Lives in the tap WizardingCode-io/homebrew-wizardingcode as
# Formula/wizardingcode-mem.rb; this copy is the source it is updated from on each release.
#
#   brew install wizardingcode-io/wizardingcode/wizardingcode-mem
class WizardingcodeMem < Formula
  desc "Persistent memory for coding agents: one local binary, no daemon"
  homepage "https://github.com/WizardingCode-io/wizardingcode-mem"
  version "0.6.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.6.0/wizardingcode-mem-darwin-arm64"
      sha256 "5332cb37f53cd47b06ef2f802d667b96efaa67aa762ff8250db3ffadc4a9f778"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.6.0/wizardingcode-mem-darwin-x64"
      sha256 "8e864cdbf175f3326a9e11bab4caa3e43c0d83dc2775f44d7fd6c28db694b89d"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.6.0/wizardingcode-mem-linux-arm64"
      sha256 "b1f3a39a6a292a325ed39d856b593d2abd3cb3e8a012d54d474efae0eddd5a37"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.6.0/wizardingcode-mem-linux-x64"
      sha256 "ed6d228213f2950a553d661a0ac4c8bfb8cbc008013649e1132da40ef7b28b9d"
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
