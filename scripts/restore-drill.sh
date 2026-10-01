#!/usr/bin/env bash
#
# restore-drill.sh — unattended proof that backups are actually restorable.
#
# A backup that has never been restored is not a backup. This runs the real
# restore path on a schedule into a throwaway database, checks the data landed,
# and drops the database again. It never touches the live database.
#
# Exit codes:
#   0  drill passed
#   1  drill failed        -> the monitoring should alert on this
#   2  nothing to drill    -> no backup has been taken yet
#
# Intended to be run from smile-restore-drill.timer.

set -euo pipefail

: "${CRYPT_REMOTE:=gdrive-crypt}"
: "${DB_NAME:=smile_db}"
: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_USER:=smile_backup}"
: "${DRILL_DB:=smile_restore_drill}"
: "${BACKUP_PREFIX:=smile}"

log()  { printf '%s drill: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { log "FAILED — $*"; exit 1; }

DRILL_DIR="$(mktemp -d -t smile-drill-XXXXXX)"
cleanup() {
  dropdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
         --if-exists --force "$DRILL_DB" >/dev/null 2>&1 || true
  rm -rf "$DRILL_DIR"
}
trap cleanup EXIT

log "starting against ${CRYPT_REMOTE}:"

SELECTED="$(rclone lsf "${CRYPT_REMOTE}:" --include "${BACKUP_PREFIX}-*.dump" \
  --sort-by modtime 2>/dev/null | tail -1)"

if [ -z "$SELECTED" ]; then
  log "no backups found yet"
  exit 2
fi
log "testing most recent backup: ${SELECTED}"

# Delegate to the real restore script, so the drill exercises the same code path
# an operator would use in an incident. Testing a copy of the logic tests nothing.
if ! bash "$(dirname "$0")/restore-from-gdrive.sh" \
      --file "$SELECTED" \
      --target "$DRILL_DB" >"${DRILL_DIR}/restore.log" 2>&1; then
  log "restore failed:"
  tail -20 "${DRILL_DIR}/restore.log" >&2
  exit 1
fi

# The drill database is dropped by the trap, so read the counts before that.
REPORT="$(grep -E '^  (pupils|behavior_cards|audit_logs) ' "${DRILL_DIR}/restore.log" || true)"
if [ -z "$REPORT" ]; then
  fail "restore produced no verification report"
fi

log "restored data:"
echo "$REPORT" | sed 's/^/  /'

PUPILS="$(echo "$REPORT" | awk '$1=="pupils"{print $2}')"
CARDS="$(echo "$REPORT"  | awk '$1=="behavior_cards"{print $2}')"

case "$PUPILS" in
  ''|*[!0-9]*) fail "pupils count was not a number (got '${PUPILS}')" ;;
esac

if [ "$PUPILS" -eq 0 ]; then
  fail "restored database has zero pupils"
fi

# Flag a suspiciously small pupil count: a truncated restore can still exit 0.
if [ "$PUPILS" -lt 100 ]; then
  fail "restored only ${PUPILS} pupils. Expected several hundred for this school.
  This looks like a partial restore — investigate before trusting the backup chain."
fi

log "PASSED — ${PUPILS} pupils, ${CARDS} behaviour cards restored from ${SELECTED}"
exit 0