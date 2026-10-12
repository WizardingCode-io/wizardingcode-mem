#!/usr/bin/env bash
# The linked projects and your rules proof (ADR 0018), on a temporary copy of the real database.
#
#   scripts/proof/links.sh <work dir> [--runs n] [--prompts n] [--hand-links n] [--unbounded]
#
# <work dir>  an empty or new directory outside ~/.wizardingcode; everything is written here
#
# What it does:
# 1. copies the live database with sqlite3's read-only .backup into a fresh data directory under
#    <work dir>; the live store is only read;
# 2. runs scripts/proof/links.ts there, which migrates the copy, times the suggestion and the
#    proposal passes the drain runs, counts what they produce, and measures the brief and the
#    prompt notes before and after confirming every suggestion, after a stress of links made by
#    hand to the biggest projects, and after accepting every proposal. --unbounded adds a
#    proposal pass with no time budget.
#    The suggestion pass reads manifests (package.json and the like) from the project roots the
#    copy records: those files are only read.
#
# <work dir>/report.md is anonymous; <work dir>/full.md names projects and rules, for the
# author's eyes only: never commit it.
#
# TypeSafe is off (its variables are unset and the copy's data directory has no settings file),
# and so are distillation, the viewer's auto-open, the migration and the browser.

set -euo pipefail

usage() {
  echo "usage: scripts/proof/links.sh <work dir> [--runs n] [--prompts n] [--hand-links n] [--unbounded]" >&2
  exit 1
}
[ $# -ge 1 ] || usage
WORK=$1
shift
RUNS=10
PROMPTS=10
HAND_LINKS=3
EXTRA=()
while [ $# -gt 0 ]; do
  case $1 in
    --runs) RUNS=$2; shift 2 ;;
    --prompts) PROMPTS=$2; shift 2 ;;
    --hand-links) HAND_LINKS=$2; shift 2 ;;
    --unbounded) EXTRA+=(--unbounded); shift ;;
    *) usage ;;
  esac
done

REPO=$(cd "$(dirname "$0")/../.." && pwd)
BUN="$REPO/node_modules/.bin/bun"

# The live store: the default data directory, or where its settings moved the database.
LIVE_DATA=${LIVE_DATA:-"$HOME/.wizardingcode/mem"}
LIVE_STORE=$LIVE_DATA
if [ -f "$LIVE_DATA/env" ]; then
  moved=$(sed -n 's/^WIZARDINGCODE_MEM_STORE_DIR=//p' "$LIVE_DATA/env" | tr -d '"' | tail -1)
  [ -n "$moved" ] && LIVE_STORE=$moved
fi
LIVE_DB="$LIVE_STORE/wizardingcode-mem.db"
[ -f "$LIVE_DB" ] || { echo "no database at $LIVE_DB" >&2; exit 1; }

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd -P)
case "$WORK/" in
  "$(cd "$LIVE_DATA" && pwd -P)/"* | "$(cd "$LIVE_STORE" && pwd -P)/"*)
    echo "refusing: the work dir is inside the live data" >&2; exit 1 ;;
esac
HOME_DIR="$WORK/home"
DATA="$HOME_DIR/mem"
[ -e "$DATA" ] && { echo "refusing: $DATA already exists; use a new work dir" >&2; exit 1; }
mkdir -p "$DATA"

# The environment every step runs in: the copy, nothing else.
for var in $(env | sed -n 's/^\(TYPESAFE[A-Z_]*\)=.*/\1/p; s/^\(WIZARDINGCODE[A-Z_]*\)=.*/\1/p'); do
  unset "$var"
done
export WIZARDINGCODE_HOME="$HOME_DIR"
export WIZARDINGCODE_MEM_DISTILL=off
export WIZARDINGCODE_MEM_UI_AUTO_OPEN=off
export WIZARDINGCODE_MEM_MIGRATE=off
export WIZARDINGCODE_MEM_UI_BROWSER=none

echo "## links proof $(date -u +%Y-%m-%dT%H:%MZ)" | tee "$WORK/run.log"
sqlite3 -readonly "$LIVE_DB" ".backup '$DATA/wizardingcode-mem.db'"
"$BUN" "$REPO/scripts/proof/links.ts" "$WORK" --runs "$RUNS" --prompts "$PROMPTS" \
  --hand-links "$HAND_LINKS" ${EXTRA[@]+"${EXTRA[@]}"} | tee -a "$WORK/run.log"
