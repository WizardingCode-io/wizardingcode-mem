#!/bin/sh
# The launcher of a team server's host (ADR 0033, docs/runbooks/team-server.md, Upgrade).
# Copy it, once, beside your compose.yml with the two units of this folder.
#
#   upgrade.sh status             what runs, the last change, what waits, one next command
#   upgrade.sh follow             the timer's verb: applies a signed release that does not migrate
#   upgrade.sh follow --dry-run   what follow would do; may download, changes nothing that runs
#   upgrade.sh upgrade            your verb: applies a signed release across a migration too
#
# It decides nothing about a release. It finds the server's container, takes the lock, and
# runs `wizardingcode-mem serve host`, the binary of the image your server runs, copied out of
# that image (never out of the running container). Each release you apply brings the tool
# that judges the next one. This file is not delivered: when it says it is older than the
# tool, copy it again from the repository.
set -eu

# These four lines are this file's own copies; tests/unit/host-units.test.ts holds each
# against the code it copies.
IMAGE=ghcr.io/wizardingcode-io/wizardingcode-mem
TOOL_PATH=/usr/local/bin/wizardingcode-mem
LABEL=io.wizardingcode.mem.upgrade=tool
SERVICE=com.docker.compose.service=server

say() {
  printf 'upgrade.sh: %s\n' "$*" >&2
}

usage() {
  cat >&2 <<'EOF'
Usage: upgrade.sh status | follow [--dry-run] | upgrade
EOF
  exit 64
}

verb="${1:-}"
flag="${2:-}"
[ "$#" -le 2 ] || usage
case "$verb $flag" in
  "status " | "follow " | "follow --dry-run" | "upgrade ") ;;
  *) usage ;;
esac

for needed in docker flock awk timeout; do
  if ! command -v "$needed" >/dev/null 2>&1; then
    say "$needed is not installed"
    exit 69
  fi
done

# The folder is where this file is, in the form it was reached by and in the disk's own:
# Compose records whichever `up` was typed in.
dir="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -L)"
phys="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
me="$(id -u)"

# `ls -ldn` and not `find` or `stat`, whose options differ between systems: one line, the
# mode first and the owner's number third, whatever the name.
owner_of() {
  # shellcheck disable=SC2012
  ls -ldn "$1" | awk '{print $3}'
}
mode_of() {
  # shellcheck disable=SC2012
  ls -ldn "$1" | awk '{print $1}'
}

owner="$(owner_of "$dir")"
if [ "$owner" != "$me" ]; then
  say "$dir belongs to user $owner and you are user $me: run it as the folder's owner (never with sudo), or its files stop being the timer's to write"
  exit 69
fi

state="$dir/upgrade-state"
tooldir="$state/tool"
tool="$tooldir/wizardingcode-mem"
lock="$state/lock"

for path in "$state" "$tooldir" "$tool" "$lock" "$dir/.env"; do
  if [ -L "$path" ]; then
    say "$path is a symbolic link"
    exit 69
  fi
done
for path in "$state" "$tooldir"; do
  [ -d "$path" ] || continue
  if [ "$(owner_of "$path")" != "$me" ]; then
    say "$path is not yours"
    exit 69
  fi
  case "$(mode_of "$path")" in
    ?????w* | ????????w*)
      say "$path can be written by others: chmod 700 it"
      exit 69
      ;;
  esac
done
for path in "$state" "$tooldir"; do
  [ -d "$path" ] || mkdir -m 700 "$path"
done

# The changing verbs run again under the lock, without waiting for it. The marker tells the
# tool it was started here; it guards against the tool typed by hand and is no control.
if [ "$verb" != status ] && [ "${WIZARDINGCODE_MEM_HOST_LOCKED:-}" != 1 ]; then
  code=0
  WIZARDINGCODE_MEM_HOST_LOCKED=1 flock -n -E 75 "$lock" "$0" "$@" || code=$?
  [ "$code" != 75 ] || say "another run holds the lock; see $dir/upgrade.sh status"
  exit "$code"
fi
if [ "$verb" != status ]; then
  printf '%s\n%s\n%s\n' "$verb" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$state/lock.info"
  trap 'rm -f "$state/lock.info"' EXIT
fi

# Every call to Docker has a time bound, and one that fails is never read as "no container".
docker_did_not_answer() {
  say "Docker did not answer"
  exit 13
}
dock() {
  bound="$1"
  shift
  timeout "$bound" docker "$@"
}

ids=""
for form in "$dir" "$phys"; do
  found="$(dock 30 ps -a -q --filter "label=$SERVICE" --filter "label=com.docker.compose.project.working_dir=$form")" || docker_did_not_answer
  ids="$ids
$found"
  [ "$dir" != "$phys" ] || break
done
ids="$(printf '%s\n' "$ids" | awk 'NF && !seen[$0]++')"
count="$(printf '%s\n' "$ids" | awk 'NF { n++ } END { print n + 0 }')"

if [ "$count" -gt 1 ]; then
  say "more than one server container belongs to $dir: $(printf '%s' "$ids" | awk '{ printf "%s ", $0 }')"
  exit 69
fi

healthy=no
if [ "$count" -eq 1 ]; then
  facts="$(dock 30 inspect --format '{{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.Config.Image}}' "$ids")" || docker_did_not_answer
  image_id="$(printf '%s' "$facts" | awk '{print $1}')"
  running="$(printf '%s' "$facts" | awk '{print $2}')"
  health="$(printf '%s' "$facts" | awk '{print $3}')"
  reference="$(printf '%s' "$facts" | awk '{print $4}')"
  if [ "$running" = running ] && [ "$health" = healthy ]; then healthy=yes; fi
else
  # No server here. One of this repository's under another folder means this file is in the wrong place.
  others="$(dock 30 ps -a --filter "label=$SERVICE" --format '{{.Image}}	{{.Label "com.docker.compose.project.working_dir"}}')" || docker_did_not_answer
  elsewhere="$(printf '%s\n' "$others" | awk -F '\t' -v image="$IMAGE" 'index($1, image ":") == 1 || index($1, image "@") == 1 { print $2; exit }')"
  if [ -n "$elsewhere" ]; then
    say "no server belongs to $dir, and one runs from $elsewhere: copy this file there and run it from there"
    exit 69
  fi
fi

# The tool comes from the image of a server that is running and healthy, through a container
# that is created and never started. A candidate that did not come up does not bring its
# tool: the one that applied it also takes it back. `status` copies only when there is none.
recorded=""
[ ! -f "$tooldir/image" ] || recorded="$(cat "$tooldir/image")"
if [ "$healthy" = yes ] && [ "$image_id" != "$recorded" ] && { [ "$verb" != status ] || [ ! -x "$tool" ]; }; then
  case "$reference" in
    "$IMAGE":* | "$IMAGE"@*) ;;
    *)
      say "the server runs $reference, which is not an image of $IMAGE"
      exit 69
      ;;
  esac
  # A run killed between create and rm left a container behind: it goes first.
  stale="$(dock 30 ps -a -q --filter "label=$LABEL")" || docker_did_not_answer
  for old in $stale; do
    dock 30 rm -f "$old" >/dev/null || docker_did_not_answer
  done
  created="$(dock 30 create --label "$LABEL" "$image_id")" || docker_did_not_answer
  if ! dock 120 cp "$created:$TOOL_PATH" "$tooldir/.wizardingcode-mem.new"; then
    dock 30 rm -f "$created" >/dev/null 2>&1 || true
    rm -f "$tooldir/.wizardingcode-mem.new"
    docker_did_not_answer
  fi
  dock 30 rm -f "$created" >/dev/null || docker_did_not_answer
  chmod 0755 "$tooldir/.wizardingcode-mem.new"
  mv -f "$tooldir/.wizardingcode-mem.new" "$tool"
  printf '%s\n' "$image_id" >"$tooldir/image"
fi

if [ ! -x "$tool" ]; then
  say "no healthy server in $dir and no tool yet; start the server by the runbook first"
  exit 69
fi

code=0
if [ "$verb" = status ]; then
  held=free
  flock -n "$lock" true 2>/dev/null || held=held
  "$tool" serve host status --dir "$dir" --lock "$held" || code=$?
elif [ -n "$flag" ]; then
  "$tool" serve host "$verb" --dir "$dir" "$flag" || code=$?
else
  "$tool" serve host "$verb" --dir "$dir" || code=$?
fi

case "$code" in
  64)
    say "the tool does not know this command: either the running server is older than the first release with \`serve host\` (upgrade to it by hand once, the runbook's Upgrade), or this launcher is older than the tool (copy deploy/upgrade.sh again)"
    exit 69
    ;;
  126 | 127)
    say "the server's binary does not run on this host (for example another C library)"
    exit 69
    ;;
esac
exit "$code"
