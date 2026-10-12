#!/usr/bin/env bash
# The knowledge proof (ADR 0020): a synthetic project, then a temporary copy of the real database.
#
#   scripts/proof/knowledge.sh <work dir> [--runs n] [--no-copy]
#
# <work dir>  an empty or new directory outside ~/.wizardingcode; everything is written here
#
# What it does:
# 1. copies the live database with sqlite3's read-only .backup into a fresh data directory under
#    <work dir> (skipped with --no-copy); the live store is only read;
# 2. runs scripts/proof/knowledge.ts, which
#    a. builds a synthetic project under <work dir> with 20 entries written for the proof (no
#       real data), prints the session-start and prompt outputs, times the hooks in process with
#       0 (no folder), 50 and 500 entries, and counts the relevance floor's hits and misses on
#       the entries' own prompts and on tests/fixtures/knowledge-probe.ts;
#    b. on the copy, runs the promotion pass drain after drain until it has reached the backlog,
#       then quiet drains, and counts the proposals. The pass looks at the project roots the copy
#       records (lstat and realpath only) and writes nothing outside the copy: proposing writes
#       no file, and nothing is accepted.
#
# <work dir>/report.md is anonymous; <work dir>/full.md names projects and memory titles, for the
# author's eyes only: never commit it.
#
# TypeSafe is off (its variables are unset and the copy's data directory has no settings file),
# and so are distillation, the viewer's auto-open, the migration and the browser.

set -euo pipefail

usage() {
  echo "usage: scripts/proof/knowledge.sh <work dir> [--runs n] [--no-copy]" >&2
  exit 1
}
[ $# -ge 1 ] || usage
WORK=$1
shift
RUNS=30
COPY=1
while [ $# -gt 0 ]; do
  case $1 in
    --runs) RUNS=$2; shift 2 ;;
    --no-copy) COPY=0; shift ;;
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

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd -P)
if [ -d "$LIVE_DATA" ]; then
  case "$WORK/" in
    "$(cd "$LIVE_DATA" && pwd -P)/"* | "$(cd "$LIVE_STORE" && pwd -P)/"*)
      echo "refusing: the work dir is inside the live data" >&2; exit 1 ;;
  esac
fi
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

echo "## knowledge proof $(date -u +%Y-%m-%dT%H:%MZ)" | tee "$WORK/run.log"
EXTRA=()
if [ "$COPY" = 1 ]; then
  [ -f "$LIVE_DB" ] || { echo "no database at $LIVE_DB" >&2; exit 1; }
  sqlite3 -readonly "$LIVE_DB" ".backup '$DATA/wizardingcode-mem.db'"
else
  EXTRA+=(--no-copy)
fi
"$BUN" "$REPO/scripts/proof/knowledge.ts" "$WORK" --runs "$RUNS" ${EXTRA[@]+"${EXTRA[@]}"} \
  | tee -a "$WORK/run.log"
