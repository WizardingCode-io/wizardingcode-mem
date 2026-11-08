#!/usr/bin/env bash
# The memory quality proof (ADR 0023), on a copy of the real database.
#
#   scripts/proof/quality.sh <work dir> sample  [--size n] [--skipped n] [--seed n]
#                                               [--projects a,b] [--exclude-projects c,d]
#   scripts/proof/quality.sh <work dir> measure --a <labels> [--b <labels>] [--s <labels>]
#
# <work dir>  a directory outside the repository and outside the live data and store
#             directories; everything is written here.
#
# 1. On the first call for a work dir, copies the live database with sqlite3's read-only
#    .backup into <work dir>/home/mem, where quality.ts looks for it; the live store is only
#    read. Later calls reuse that copy, so that the samples, the labels and the measure refer
#    to the same memories. The live store is the one the caller's environment names
#    (WIZARDINGCODE_MEM_STORE_DIR, WIZARDINGCODE_MEM_DATA_DIR, WIZARDINGCODE_HOME), else the
#    default, else where its env file moved it.
# 2. Runs scripts/proof/quality.ts on the copy (see its header). `measure` needs a TypeSafe
#    key: TYPESAFE_API_KEY from the environment, or the one in the live data directory's env
#    file (only read). Nothing is sent to any other model: the labels come from a labeller the
#    author chooses (ADR 0023, D-4; see scripts/proof/quality-brief.md).
#
# <work dir>/report.md is anonymous. <work dir>/full.md, the samples and the labels hold the
# author's text: never commit them. The work dir also holds a full copy of the store, which the
# mem's forget and compact never reach: once the report is taken, delete it (`rm -rf <work dir>`).
# The labeller the author chose reads the samples. Distillation, the viewer's auto-open, the legacy migration and
# the browser are off. The semantic model is not used: nothing is consolidated or written.

set -euo pipefail
# The copy, the samples, the labels and the reports hold the author's own text: owner only.
umask 077

usage() {
  echo "usage: scripts/proof/quality.sh <work dir> sample [--size n] [--skipped n] [--seed n] [--projects a,b] [--exclude-projects c,d] | measure --a <labels> [--b <labels>] [--s <labels>]" >&2
  exit 1
}
[ $# -ge 2 ] || usage
WORK=$1
MODE=$2
shift 2
case $MODE in sample | measure) ;; *) usage ;; esac

REPO=$(cd "$(dirname "$0")/../.." && pwd -P)
BUN="$REPO/node_modules/.bin/bun"

# The live store: a data or store directory named in the environment, else the default data
# directory under the brand home (WIZARDINGCODE_HOME honoured), or where its settings moved it.
LIVE_DATA=${LIVE_DATA:-${WIZARDINGCODE_MEM_DATA_DIR:-${WIZARDINGCODE_HOME:-$HOME/.wizardingcode}/mem}}
LIVE_STORE=${WIZARDINGCODE_MEM_STORE_DIR:-$LIVE_DATA}
if [ -z "${WIZARDINGCODE_MEM_STORE_DIR:-}" ] && [ -f "$LIVE_DATA/env" ]; then
  moved=$(sed -n 's/^WIZARDINGCODE_MEM_STORE_DIR=//p' "$LIVE_DATA/env" | tr -d '"' | tail -1)
  [ -n "$moved" ] && LIVE_STORE=$moved
fi
case $LIVE_STORE in /*) ;; *) echo "the live store must be an absolute path: $LIVE_STORE" >&2; exit 1 ;; esac
LIVE_DB="$LIVE_STORE/wizardingcode-mem.db"
[ -f "$LIVE_DB" ] || { echo "no database at $LIVE_DB" >&2; exit 1; }

# A directory's real path, or its spelling when it does not exist (never an empty string).
real() { if [ -d "$1" ]; then (cd "$1" && pwd -P); else printf '%s' "${1%/}"; fi; }

# Checked on the real path before anything is created.
[ -d "$(dirname "$WORK")" ] || { echo "no directory $(dirname "$WORK")" >&2; exit 1; }
WORK=$(real "$(dirname "$WORK")")/$(basename "$WORK")
for live in "$REPO" "$(real "$LIVE_DATA")" "$(real "$LIVE_STORE")" "${WIZARDINGCODE_HOME:+$(real "$WIZARDINGCODE_HOME")}"; do
  [ -n "$live" ] || continue
  case "$WORK/" in
    "$live/"*)
      echo "refusing: the work dir is inside the repository or the live data" >&2
      exit 1
      ;;
  esac
done
mkdir -p "$WORK"
HOME_DIR="$WORK/home"
DATA="$HOME_DIR/mem"
if [ ! -f "$DATA/wizardingcode-mem.db" ]; then
  mkdir -p "$DATA"
  sqlite3 -readonly "$LIVE_DB" ".backup '$DATA/wizardingcode-mem.db'"
  echo "copied the store to $DATA"
fi

# The environment the script runs in: no variable of the live install. quality.ts opens the
# copy at <work dir>/home/mem and treats any data directory the environment names as live.
# A key given in the environment is kept for `measure`.
KEY=${TYPESAFE_API_KEY:-}
for var in $(env | sed -n 's/^\(TYPESAFE[A-Z_]*\)=.*/\1/p; s/^\(WIZARDINGCODE[A-Z_]*\)=.*/\1/p'); do
  unset "$var"
done
export WIZARDINGCODE_MEM_DISTILL=off
export WIZARDINGCODE_MEM_UI_AUTO_OPEN=off
export WIZARDINGCODE_MEM_MIGRATE=off
export WIZARDINGCODE_MEM_UI_BROWSER=none
export LIVE_DATA LIVE_STORE
if [ "$MODE" = measure ] && [ -n "$KEY" ]; then
  export TYPESAFE_API_KEY="$KEY"
fi

"$BUN" "$REPO/scripts/proof/quality.ts" "$WORK" "$MODE" "$@"
