# Homebrew formula for wizardingcode-mem. Lives in the tap WizardingCode-io/homebrew-wizardingcode as
# Formula/wizardingcode-mem.rb; this copy is the source it is updated from on each release.
#
#   brew install wizardingcode-io/wizardingcode/wizardingcode-mem
class WizardingcodeMem < Formula
  desc "Persistent memory for coding agents: one local binary, no daemon"
  homepage "https://github.com/WizardingCode-io/wizardingcode-mem"
  version "0.7.0"
  license "Apache-2.0"

  on_macos do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.7.0/wizardingcode-mem-darwin-arm64"
      sha256 "dce8c55428dcef281a7dbe270d64e218bac77e1419c0804c75c267dbbfaaf571"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.7.0/wizardingcode-mem-darwin-x64"
      sha256 "1096f82913bd503c0ae96a9414757d47b69bc8dd23ab55fd7b69aa7d553de553"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.7.0/wizardingcode-mem-linux-arm64"
      sha256 "6bb2a5c4e7c7421ea1a93031306fbfecb23d9582723492a5d489e60539ae99c1"
    end
    on_intel do
      url "https://github.com/WizardingCode-io/wizardingcode-mem/releases/download/v0.7.0/wizardingcode-mem-linux-x64"
      sha256 "7e2c6be161bf44b2b2457ba6723a77bd1ce4d7056816823d9419983242a45d1f"
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
