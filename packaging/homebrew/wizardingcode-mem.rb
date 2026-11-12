# Homebrew formula for wizardingcode-mem. Lives in the tap WizardingCode-io/homebrew-wizardingcode as
# Formula/wizardingcode-mem.rb; this copy is the source it is updated from on each release.
#
#   brew install wizardingcode-io/wizardingcode/wizardingcode-mem
class WizardingcodeMem < Formula
  desc "Persistent memory for coding agents: one local binary, no daemon"
  homepage "https://github.com/WizardingCode-io/wizardingcode-mem"
  version "0.8.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.8.0/wizardingcode-mem-darwin-arm64"
      sha256 "5db81910f7be19a6abe338b68446b3dcbfa8f9c3521c3a7976e6fbd270524191"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.8.0/wizardingcode-mem-darwin-x64"
      sha256 "f21124eff71789a3339d40065da592fdc2d06e5c102588267c0e703c391e9bc1"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.8.0/wizardingcode-mem-linux-arm64"
      sha256 "bb4566ecb4a2094eb9bec30ce5239abdbe2c5ba868646d2344e97bb649fa1aeb"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.8.0/wizardingcode-mem-linux-x64"
      sha256 "f713b5918b2f8551a3aff969d0fd282a1a8bb2ee17b99d79aa24778cf7c03edf"
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
