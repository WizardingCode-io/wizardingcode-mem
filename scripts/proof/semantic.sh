#!/usr/bin/env bash
# The semantic search proof (ADR 0017), on a temporary copy of the real database.
#
#   scripts/proof/semantic.sh <pack> <queries.tsv> <work dir> [--history-seconds n] [--runs n]
#
# <pack>         a potion-multilingual-128M.wcpack already on disk (copied, never downloaded)
# <queries.tsv>  one query per line, optionally "project<TAB>query"; the author's own, never
#                committed
# <work dir>     an empty or new directory outside ~/.wizardingcode; everything is written here
#
# What it does, with the compiled binary (dist/wizardingcode-mem-<os>-<arch>, or $BIN):
# 1. copies the live database (and history.db, when the store has one) with sqlite3's
#    read-only .backup into a fresh data directory under <work dir>; the live store is only read;
# 2. without a history.db and with --history-seconds n > 0, indexes the agents' transcripts
#    (only read) into the copy's store, passes of n seconds until nothing is left;
# 3. measures memory_search and history_search without the model (scripts/proof/semantic.ts);
# 4. copies the pack into the data directory, times `embed backfill`, records the database's
#    growth, and fills the history vectors with `history index` passes;
# 5. measures again with the model, and writes the anonymous comparison to <work dir>/report.md.
#    <work dir>/full.md has the queries and titles, for the author's eyes; never commit it.
#
# TypeSafe is off (its variables are unset and the copy's data directory has no settings file),
# and so are distillation, the viewer's auto-open, the migration and the browser.

set -euo pipefail

usage() {
  echo "usage: scripts/proof/semantic.sh <pack> <queries.tsv> <work dir> [--history-seconds n] [--runs n]" >&2
  exit 1
}
[ $# -ge 3 ] || usage
PACK=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
QUERIES=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
WORK=$3
shift 3
HISTORY_SECONDS=0
RUNS=20
while [ $# -gt 0 ]; do
  case $1 in
    --history-seconds) HISTORY_SECONDS=$2; shift 2 ;;
    --runs) RUNS=$2; shift 2 ;;
    *) usage ;;
  esac
done

REPO=$(cd "$(dirname "$0")/../.." && pwd)
BUN="$REPO/node_modules/.bin/bun"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) PLATFORM=darwin-x64 ;;
  Linux-aarch64) PLATFORM=linux-arm64 ;;
  *) PLATFORM=linux-x64 ;;
esac
BIN=${BIN:-"$REPO/dist/wizardingcode-mem-$PLATFORM"}
[ -x "$BIN" ] || { echo "no binary at $BIN (bun scripts/build.ts --only=$PLATFORM)" >&2; exit 1; }
[ -f "$PACK" ] || { echo "no pack at $PACK" >&2; exit 1; }

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

say() { printf '%s\n' "$*" | tee -a "$WORK/run.log"; }
now_ms() { "$BUN" -e 'console.log(Date.now())'; }
size_of() { stat -f %z "$1" 2>/dev/null || stat -c %s "$1"; }

say "## semantic proof $(date -u +%Y-%m-%dT%H:%MZ)"
sqlite3 -readonly "$LIVE_DB" ".backup '$DATA/wizardingcode-mem.db'"
if [ -f "$LIVE_STORE/history.db" ]; then
  sqlite3 -readonly "$LIVE_STORE/history.db" ".backup '$DATA/history.db'"
  say "history.db: copied"
fi
DB="$DATA/wizardingcode-mem.db"

# The first open migrates the copy (the vector table); measured sizes start after it.
echo '{"query":"x"}' | "$BIN" tool memory_search --global >/dev/null
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
say "memories: $(sqlite3 "$DB" "SELECT status || ' ' || count(*) FROM memories GROUP BY status" | tr '\n' ',' )"

if [ ! -f "$DATA/history.db" ] && [ "$HISTORY_SECONDS" -gt 0 ]; then
  say "history index (no model), passes of ${HISTORY_SECONDS}s:"
  for _ in $(seq 1 50); do
    line=$("$BIN" history index --max-seconds "$HISTORY_SECONDS" | tail -1)
    say "  $line"
    case $line in *" 0 indexed,"*) break ;; esac
  done
fi
HISTORY=no
[ -f "$DATA/history.db" ] && HISTORY=yes
[ "$HISTORY" = yes ] && say "history turns: $(sqlite3 "$DATA/history.db" "SELECT count(*) FROM turns")"

say "### without the model"
"$BUN" "$REPO/scripts/proof/semantic.ts" measure "$QUERIES" "$WORK/before.json" --runs "$RUNS" --bin "$BIN" | tee -a "$WORK/run.log"

mkdir -p "$DATA/models"
cp "$PACK" "$DATA/models/potion-multilingual-128M.wcpack"
"$BIN" embed status | tee -a "$WORK/run.log"

size_before=$(size_of "$DB")
started=$(now_ms)
"$BIN" embed backfill | tee -a "$WORK/run.log"
ended=$(now_ms)
sqlite3 "$DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
size_after=$(size_of "$DB")
vectors=$(sqlite3 "$DB" "SELECT count(*) || ' vectors, ' || sum(length(vec)) || ' bytes of vectors' FROM memory_vectors")
say "backfill: $((ended - started)) ms; $vectors; database $size_before -> $size_after bytes (+$(((size_after - size_before) / 1024)) KiB)"

if [ "$HISTORY" = yes ]; then
  hsize_before=$(size_of "$DATA/history.db")
  started=$(now_ms)
  for _ in $(seq 1 500); do
    "$BIN" history index --max-seconds "${HISTORY_SECONDS:-60}" >/dev/null
    left=$(sqlite3 "$DATA/history.db" "SELECT count(*) FROM turns t LEFT JOIN turn_vectors v ON v.turn_id = t.id WHERE v.turn_id IS NULL")
    [ "$left" -eq 0 ] && break
  done
  ended=$(now_ms)
  hsize_after=$(size_of "$DATA/history.db")
  say "history vectors: $((ended - started)) ms; $(sqlite3 "$DATA/history.db" "SELECT count(*) FROM turn_vectors") vectors, $left turns left; history.db $hsize_before -> $hsize_after bytes"
fi

say "### with the model"
"$BUN" "$REPO/scripts/proof/semantic.ts" measure "$QUERIES" "$WORK/after.json" --runs "$RUNS" --bin "$BIN" | tee -a "$WORK/run.log"

"$BUN" "$REPO/scripts/proof/semantic.ts" compare "$WORK/before.json" "$WORK/after.json" > "$WORK/report.md"
"$BUN" "$REPO/scripts/proof/semantic.ts" compare "$WORK/before.json" "$WORK/after.json" --full > "$WORK/full.md"
cat "$WORK/run.log" "$WORK/report.md" > "$WORK/report.tmp" && mv "$WORK/report.tmp" "$WORK/report.md"
say "report: $WORK/report.md (anonymous); $WORK/full.md (queries and titles: never commit)"
