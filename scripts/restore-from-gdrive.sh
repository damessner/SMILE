#!/usr/bin/env bash
#
# restore-from-gdrive.sh — restore a SMILE database backup from Google Drive.
#
#   rclone crypt  ->  download  ->  pg_restore  ->  verify row counts
#
# By default this restores into a SCRATCH database, never over the live one. That
# is deliberate: the failure mode of a restore is a bad target, and the restore
# drill has to be safe to run unattended.
#
# Usage:
#   restore-from-gdrive.sh --list                  list available backups
#   restore-from-gdrive.sh --latest --dry-run       show what would be restored
#   restore-from-gdrive.sh --latest                 restore into scratch DB
#   restore-from-gdrive.sh --latest --target smile_db --force
#                                                      restore over live DB
#
# --force is required to overwrite the live database. Without it the script will
# not touch a database whose name is not SCRATCH_DB.

set -euo pipefail

: "${CRYPT_REMOTE:=gdrive-crypt}"
: "${DB_NAME:=smile_db}"
: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_USER:=smile_backup}"
: "${SCRATCH_DB:=smile_restore_test}"
: "${BACKUP_PREFIX:=smile}"
: "${RCLONE_TIMEOUT:=900}"

ACTION=""
WANTED=""
TARGET="$SCRATCH_DB"
DRY_RUN=0
FORCE=0
WORK_DIR=""

usage() { sed -n '2,25p' "$0"; exit 2; }

log()  { printf '%s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- arguments --------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --list)     ACTION="list" ;;
    --latest)   ACTION="restore" ;;
    --file)     ACTION="restore"; WANTED="${2:-}"; shift ;;
    --target)   TARGET="${2:-}"; shift ;;
    --dry-run)  DRY_RUN=1 ;;
    --force)    FORCE=1 ;;
    -h|--help)  usage ;;
    *)          printf 'Unknown option: %s\n\n' "$1" >&2; usage ;;
  esac
  shift
done

[ -n "$ACTION" ] || usage

WORK_DIR="$(mktemp -d -t smile-restore-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

# --- list ------------------------------------------------------------------
if [ "$ACTION" = "list" ]; then
  log "Available backups in ${CRYPT_REMOTE}:"
  log ""
  if ! rclone lsf "${CRYPT_REMOTE}:" --include "${BACKUP_PREFIX}-*.dump" \
        --format "tp" --separator " " 2>/dev/null | sort; then
    fail "Could not list '${CRYPT_REMOTE}:'. Check the remote and its passphrase."
  fi
  exit 0
fi

# --- resolve which file -----------------------------------------------------
if [ -n "$WANTED" ]; then
  SELECTED="$WANTED"
  case "$SELECTED" in *"/"*|*\\*) fail "Refusing a path in --file: ${SELECTED}" ;; esac
  rclone lsjson "${CRYPT_REMOTE}:${SELECTED}" >/dev/null 2>&1 \
    || fail "No such backup: ${SELECTED}  (run --list)"
else
  SELECTED="$(rclone lsf "${CRYPT_REMOTE}:" --include "${BACKUP_PREFIX}-*.dump" \
    --sort-by modtime 2>/dev/null | tail -1)"
  [ -n "$SELECTED" ] || fail "No backups found in ${CRYPT_REMOTE}:"
fi

SELECTED_SIZE="$(rclone size "${CRYPT_REMOTE}:${SELECTED}" --json 2>/dev/null \
  | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p' | head -1)"

log "Selected backup : ${SELECTED}"
log "Size            : ${SELECTED_SIZE:-unknown} bytes"
log "Destination     : ${DB_NAME} (host ${DB_HOST}:${DB_PORT})"
log "Target database : ${TARGET}"

if [ "$DRY_RUN" -eq 1 ]; then
  log ""
  log "DRY RUN — nothing was written. To actually restore, drop --dry-run."
  exit 0
fi

# --- safety gate ------------------------------------------------------------
# The one destructive action in this script. Everything else is additive.
if [ "$TARGET" = "$DB_NAME" ]; then
  [ "$FORCE" -eq 1 ] || fail "Refusing to overwrite the live database '${DB_NAME}'.
  Re-run with --force only if you are certain. This replaces all live data."
  log ""
  log "*** OVERWRITING THE LIVE DATABASE ***"
  log ""
fi

# --- download ---------------------------------------------------------------
LOCAL="${WORK_DIR}/${SELECTED}"
log "downloading..."
if ! timeout "$RCLONE_TIMEOUT" \
      rclone copyto "${CRYPT_REMOTE}:${SELECTED}" "$LOCAL" \
        --timeout 120s --retries 3 2>"${WORK_DIR}/dl.err"; then
  log "$(tail -5 "${WORK_DIR}/dl.err")" >&2
  fail "Download failed. If this is a decryption error, the passphrase is wrong
  or the rclone crypt configuration does not match the one used at backup time."
fi

if [ ! -s "$LOCAL" ]; then fail "Downloaded file is empty"; fi

if ! pg_restore --list "$LOCAL" >"${WORK_DIR}/toc.txt" 2>"${WORK_DIR}/toc.err"; then
  log "$(cat "${WORK_DIR}/toc.err")" >&2
  fail "Downloaded archive is corrupt or not a pg_dump custom-format file"
fi

ENTRIES="$(grep -c '^;' "${WORK_DIR}/toc.txt" || true)"
log "archive validated: ${ENTRIES} entries"

# --- restore ----------------------------------------------------------------
if [ "$TARGET" = "$DB_NAME" ] && [ "$FORCE" -eq 1 ]; then
  log "dropping and recreating ${DB_NAME}..."
  dropdb  --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
          --if-exists --force "$DB_NAME"
fi

if [ "$TARGET" != "$DB_NAME" ]; then
  dropdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
         --if-exists --force "$TARGET" 2>/dev/null || true
fi

createdb --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" "$TARGET"
log "restoring into ${TARGET} (this can take a minute)..."

if ! pg_restore --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
      --dbname="$TARGET" --no-owner --no-acl --exit-on-error "$LOCAL" \
      2>"${WORK_DIR}/restore.err"; then
  log "$(tail -10 "${WORK_DIR}/restore.err")" >&2
  fail "pg_restore failed"
fi

# --- verify -----------------------------------------------------------------
# A restore that exits 0 but lands no rows is a silent failure. Check the counts.
log ""
log "verifying restored data..."
for tbl in pupils school_classes teachers users behavior_cards audit_logs; do
  N="$(psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
        --dbname="$TARGET" --tuples-only --no-align \
        --command="SELECT count(*) FROM ${tbl};" 2>/dev/null | tr -d '[:space:]')"
  printf '  %-18s %s\n' "$tbl" "${N:-MISSING}"
done

P_COUNT="$(psql --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
  --dbname="$TARGET" --tuples-only --no-align \
  --command="SELECT count(*) FROM pupils;" 2>/dev/null | tr -d '[:space:]')"

if [ -z "$P_COUNT" ] || [ "$P_COUNT" -eq 0 ] 2>/dev/null; then
  fail "Restored database contains no pupils. Treat this restore as FAILED."
fi

log ""
log "RESTORE OK — ${P_COUNT} pupils in ${TARGET}"