#!/bin/sh
# Installs wizardingcode-mem: downloads this platform's binary from the latest GitHub release
# (or WIZARDINGCODE_MEM_VERSION), checks its SHA-256 against the release's checksums, puts it
# in ~/.wizardingcode/mem/bin and sets it up for every supported agent found on this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/WizardingCode-io/wizardingcode-mem/main/scripts/install.sh | sh
#
# Arguments are passed on to `wizardingcode-mem install` (e.g. `sh install.sh claude-code --yes`);
# `--download-only` stops after placing the binary. WIZARDINGCODE_MEM_BIN_DIR says where.
# A newer binary already in place is left there, unless `--force` is among the arguments.
set -eu

download_only=0
if [ "${1:-}" = "--download-only" ]; then
  download_only=1
  shift
fi
force=0
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then force=1; fi
done

repo="WizardingCode-io/wizardingcode-mem"
version="${WIZARDINGCODE_MEM_VERSION:-latest}"
if [ "$version" = "latest" ]; then
  base="${WIZARDINGCODE_MEM_RELEASE_BASE:-https://github.com/$repo/releases/latest/download}"
else
  base="${WIZARDINGCODE_MEM_RELEASE_BASE:-https://github.com/$repo/releases/download/$version}"
fi

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "wizardingcode-mem: no binary for $os; on Windows, download wizardingcode-mem-windows-x64.exe from https://github.com/$repo/releases" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "wizardingcode-mem: no binary for $os/$arch" >&2; exit 1 ;;
esac
file="wizardingcode-mem-$os-$arch"

# True when version $1 is missing or older than $2, by semantic versioning's order: a pre-release
# is older than its release, and numeric identifiers compare as numbers. Not a version: older.
older() {
  [ -z "$1" ] && return 0
  LC_ALL=C awk -v a="$1" -v b="$2" 'BEGIN {
    if (a !~ /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$/) exit 0
    i = index(a, "-"); j = index(b, "-")
    ca = i ? substr(a, 1, i - 1) : a; pa = i ? substr(a, i + 1) : ""
    cb = j ? substr(b, 1, j - 1) : b; pb = j ? substr(b, j + 1) : ""
    split(ca, x, "."); split(cb, y, ".")
    for (k = 1; k <= 3; k++) { p = x[k] + 0; q = y[k] + 0; if (p < q) exit 0; if (p > q) exit 1 }
    if (!i || !j) exit ((i && !j) ? 0 : 1)
    n = split(pa, u, "."); m = split(pb, v, ".")
    for (k = 1; k <= n && k <= m; k++) {
      if ((u[k] "") == (v[k] "")) continue
      s = (u[k] ~ /^[0-9]+$/); t = (v[k] ~ /^[0-9]+$/)
      if (s && t) exit ((u[k] + 0 < v[k] + 0) ? 0 : 1)
      if (s != t) exit (s ? 0 : 1)
      exit (((u[k] "") < (v[k] "")) ? 0 : 1)
    }
    exit ((n < m) ? 0 : 1)
  }'
}

home="${WIZARDINGCODE_HOME:-$HOME/.wizardingcode}"
data="${WIZARDINGCODE_MEM_DATA_DIR:-$home/mem}"
bin="${WIZARDINGCODE_MEM_BIN_DIR:-$data/bin}"
mkdir -p "$bin"
tmp="$(mktemp "$bin/.wizardingcode-mem.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

echo "wizardingcode-mem: downloading $file ($version)"
curl -fsSL "$base/$file" -o "$tmp"
expected="$(curl -fsSL "$base/checksums.txt" | awk -v f="$file" '$2 == f { print $1 }')"
if [ -z "$expected" ]; then
  echo "wizardingcode-mem: $file is not in the release's checksums" >&2
  exit 1
fi
if command -v sha256sum > /dev/null 2>&1; then
  actual="$(sha256sum "$tmp" | awk '{ print $1 }')"
else
  actual="$(shasum -a 256 "$tmp" | awk '{ print $1 }')"
fi
if [ "$actual" != "$expected" ]; then
  echo "wizardingcode-mem: checksum mismatch for $file (expected $expected, got $actual)" >&2
  exit 1
fi
chmod 755 "$tmp"

# The version a binary answers: the first line of `--version`, when it is a version.
version_of() {
  answer="$("$1" --version 2> /dev/null | head -n 1 || true)"
  if printf '%s\n' "$answer" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'; then
    printf '%s\n' "$answer"
  fi
}

new="$(version_of "$tmp")"
if [ -z "$new" ]; then
  echo "wizardingcode-mem: the downloaded binary does not run" >&2
  exit 1
fi
staged=""
if [ -x "$bin/wizardingcode-mem" ]; then
  staged="$(version_of "$bin/wizardingcode-mem")"
fi
# The binary in place only moves forward: a plugin or a newer install may have put it there.
if [ "$force" = 0 ] && [ -n "$staged" ] && older "$new" "$staged"; then
  rm -f "$tmp"
  trap - EXIT
  echo "wizardingcode-mem: $staged is already in $bin/wizardingcode-mem; the older $new was not put in its place (--force replaces it)"
else
  mv -f "$tmp" "$bin/wizardingcode-mem"
  trap - EXIT
  echo "wizardingcode-mem: installed $new at $bin/wizardingcode-mem"
fi

if [ "$download_only" = 1 ]; then
  exit 0
fi
exec "$bin/wizardingcode-mem" install "$@"
