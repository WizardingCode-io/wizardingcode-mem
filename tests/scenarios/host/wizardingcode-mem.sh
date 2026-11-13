#!/bin/sh
# A stand-in for the team server in the host scenarios (tests/scenarios/host.test.ts): it
# answers the four things the host's tool asks of an image, from what the image was built with.
[ "${1:-}" = serve ] || exit 64
schema_of_data() {
  if [ -f /data/schema ]; then cat /data/schema; else echo 2; fi
}
case "${2:-}" in
  version)
    printf 'version=%s\nteam_schema=%s\ncontract=2\naccepts=1,2\n' "$WCM_VERSION" "$WCM_SCHEMA"
    ;;
  status)
    schema="$(schema_of_data)"
    if [ "$schema" -gt "$WCM_SCHEMA" ]; then
      echo "team.db is at a newer schema than this binary" >&2
      exit 3
    fi
    printf 'version: %s\nschema: %s\nfreeBytes: 9000000000\ndbBytes: 1000\n' "$WCM_VERSION" "$schema"
    ;;
  health)
    [ "$WCM_HEALTH" = ok ]
    ;;
  "")
    schema="$(schema_of_data)"
    if [ "$schema" -gt "$WCM_SCHEMA" ]; then exit 3; fi
    if [ "$WCM_SCHEMA" -gt "$schema" ]; then echo "$WCM_SCHEMA" > /data/schema; fi
    if [ "$WCM_START" = exit ]; then
      echo "wizardingcode-mem $WCM_VERSION: refusing to start"
      exit 2
    fi
    echo "wizardingcode-mem $WCM_VERSION: serving"
    exec sleep 3600
    ;;
  *)
    exit 64
    ;;
esac
