#!/usr/bin/env bash
#
# backup-to-gdrive.sh — one encrypted SMILE database backup to Google Drive.
#
#   pg_dump -Fc  ->  validate  ->  rclone crypt (client-side encryption)  ->  Drive
#
# Design notes:
#   - Checks the remote is reachable BEFORE dumping, so a Drive outage does not
#     generate a full local dump that cannot be sent.
#   - Validates each dump with `pg_restore --list` before uploading. A dump that
#     cannot be listed cannot be restored, and finding that out during an incident
#     is too late.
#   - Retention is tiered. Hourly for 3 days, daily to 31 days, weekly to 16 weeks,
#     monthly to 12 months. At ~30 MB per compressed dump that is roughly 3-4 GB.
#   - Exits non-zero on any failure so systemd and monitoring can react.
#
# Intended to be run from smile-backup.timer with /etc/smile/backup.env loaded.

set -euo pipefail

# --- configuration (overridable by /etc/smile/backup.env) ------------------
: "${CRYPT_REMOTE:=gdrive-crypt}"
: "${DB_NAME:=smile_db}"
: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_USER:=smile_backup}"
: "${BACKUP_PREFIX:=smile}"
: "${KEEP_HOURS_DAYS:=3}"
: "${KEEP_DAILY_DAYS:=31}"
: "${KEEP_WEEKLY_WEEKS:=16}"
: "${KEEP_MONTHLY_MONTHS:=12}"
: "${DUMP_TIMEOUT:=1800}"
: "${RCLONE_TIMEOUT:=900}"
: "${LOG_PREFIX:=smile-backup}"

WORK_DIR="$(mktemp -d -t smile-backup-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

log()  { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fail() { log "ERROR: $*" >&2; exit 1; }

START_EPOCH="$(date +%s)"
DUMP_NAME="${BACKUP_PREFIX}-$(date -u '+%Y%m%d-%H%M%S').dump"
LOCAL_PATH="${WORK_DIR}/${DUMP_NAME}"

# --- 0. prerequisites -------------------------------------------------------
log "${LOG_PREFIX} starting"

for cmd in pg_dump pg_restore rclone; do
  command -v "$cmd" >/dev/null 2>&1 || fail "$cmd not found in PATH"
done

# --- 1. verify the destination BEFORE spending a dump -----------------------
# A full dump of a 120 MB database is real I/O. Do not produce one we cannot send.
if ! rclone lsd "${CRYPT_REMOTE}:" --timeout 30s >/dev/null 2>&1; then
  fail "Destination '${CRYPT_REMOTE}:' is not reachable. Skipping dump.
  If this persists the encrypted backups are falling behind."
fi

# --- 2. dump ----------------------------------------------------------------
log "dumping ${DB_NAME} on ${DB_HOST}:${DB_PORT}"
if ! PGCONNECT_TIMEOUT=10 timeout "$DUMP_TIMEOUT" \
      pg_dump \
        --host="$DB_HOST" --port="$DB_PORT" --username="$DB_USER" \
        --dbname="$DB_NAME" \
        --format=custom \
        --compress=6 \
        --no-owner --no-acl \
        --file="$LOCAL_PATH" 2>"${WORK_DIR}/dump.err"; then
  log "pg_dump stderr: $(cat "${WORK_DIR}/dump.err")"
  fail "pg_dump failed"
fi

[ -s "$LOCAL_PATH" ] || fail "pg_dump produced an empty file"
DUMP_BYTES="$(stat -c%s "$LOCAL_PATH")"
log "dump written: ${DUMP_BYTES} bytes"

# --- 3. validate before upload ---------------------------------------------
# pg_restore --list parses the archive index. If it cannot be listed, it cannot be
# restored, and we should not spend bandwidth storing it.
if ! pg_restore --list "$LOCAL_PATH" >"${WORK_DIR}/toc.txt" 2>"${WORK_DIR}/toc.err"; then
  log "validation stderr: $(cat "${WORK_DIR}/toc.err")"
  fail "Dump failed validation and was NOT uploaded"
fi

TOC_ENTRIES="$(grep -c '^;' "${WORK_DIR}/toc.txt" || true)"
log "dump validated: ${TOC_ENTRIES} archive entries"

# Guard against a truncated dump: a table list with no pupils table means something
# went wrong even though the archive parsed.
if ! grep -q 'TABLE.*pupils' "${WORK_DIR}/toc.txt"; then
  fail "Dump contains no pupils table. Refusing to upload."
fi

# --- 4. encrypt and upload --------------------------------------------------
log "uploading to ${CRYPT_REMOTE}:"
if ! timeout "$RCLONE_TIMEOUT" \
      rclone copyto "$LOCAL_PATH" "${CRYPT_REMOTE}:${DUMP_NAME}" \
        --timeout 120s --retries 3 --low-level-retries 10 2>"${WORK_DIR}/upload.err"; then
  log "rclone stderr: $(tail -5 "${WORK_DIR}/upload.err")"
  fail "Upload failed"
fi
log "upload complete"

# Confirm the object landed and is readable through the crypt remote. Reading it
# back is the only way to know the passphrase still works and the object is intact.
if ! timeout 120 rclone cat "${CRYPT_REMOTE}:${DUMP_NAME}" >/dev/null 2>&1; then
  fail "Uploaded object is not readable through the crypt remote"
fi

REMOTE_BYTES="$(timeout 60 rclone size "${CRYPT_REMOTE}:${DUMP_NAME}" --json 2>/dev/null \
  | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p' | head -1)"
log "verified on Drive: ${REMOTE_BYTES:-unknown} bytes"

# --- 5. retention -----------------------------------------------------------
# Tiered pruning. Inside the recent window every hourly dump is kept; beyond it,
# one representative per day / week / month is kept so history survives without
# filling the quota.
#
# Deliberately pure bash + coreutils. An earlier draft used python3 for the date
# grouping; a minimal container need not have python installed, and a backup job
# should not gain a dependency just to prune files.
#
# Backup filenames are `PREFIX-YYYYmmdd-HHMMSS.dump`, which sort lexicographically
# in time order, so no metadata (and no lsjson) is required.
log "applying retention"

prune_tier() {
  # prune_tier <day|week|month> <min_age_days> <label>
  #
  # Only files OLDER than min_age_days are considered. This is essential: if the
  # coarse tiers ran over the whole set they would collapse recent history too,
  # because the monthly tier would keep only one file per month and destroy the
  # hourly detail underneath it. Each tier is only allowed to thin out material
  # that the previous, finer tier has already finished with.
  local period="$1" min_age_days="$2" label="$3"
  declare -A kept_bucket=()
  local pruned=0 name ts epoch bucket age_seconds cutoff now_epoch

  now_epoch="$(date -u +%s)"
  cutoff=$(( now_epoch - min_age_days * 86400 ))

  # Reverse sort: the first file seen in a bucket is the newest, so it is the keeper.
  while IFS= read -r name; do
    [ -n "$name" ] || continue

    # Strip the prefix and extension, then rebuild an ISO timestamp.
    ts="${name#"${BACKUP_PREFIX}-"}"
    ts="${ts%.dump}"
    # Note: ${ts:8} would expand from offset 8 to the END of the string (bash
    # semantics), not a single character. The length is mandatory here.
    if [ "${#ts}" -ne 15 ] || [ "${ts:8:1}" != "-" ]; then continue; fi

    epoch="$(date -u -d "${ts:0:4}-${ts:4:2}-${ts:6:2} ${ts:9:2}:${ts:11:2}:${ts:13:2}" +%s 2>/dev/null)" \
      || continue

    # Compare absolute epochs. Do NOT compare a duration against an absolute
    # timestamp — that silently disables the whole tier. Skip anything NEWER
    # than this tier's horizon; only older material is eligible for thinning.
    [ "$epoch" -gt "$cutoff" ] && continue

    case "$period" in
      day)   bucket="$(( epoch / 86400 ))" ;;              # UTC day
      week)  bucket="$(( epoch / 604800 ))" ;;             # 7-day block
      month) bucket="${ts:0:4}-${ts:4:2}" ;;               # YYYYMM
      *)     continue ;;
    esac
    [ -n "$bucket" ] || continue

    if [ -z "${kept_bucket[$bucket]:-}" ]; then
      kept_bucket[$bucket]="$name"
    else
      if rclone deletefile "${CRYPT_REMOTE}:${name}" >/dev/null 2>&1; then
        pruned=$((pruned + 1))
      fi
    fi
  done < <(rclone lsf "${CRYPT_REMOTE}:" --include "${BACKUP_PREFIX}-*.dump" \
             --sort-by name 2>/dev/null | sort -r)

  [ "$pruned" -gt 0 ] && log "  ${label} (older than ${min_age_days}d): pruned ${pruned} file(s)"
  return 0
}

# Applied finest-tier-first, each only over material the finer tiers have finished
# with. Hourly detail is therefore preserved for the recent window.
prune_tier day   "$KEEP_HOURS_DAYS"  "daily"
prune_tier week  "$KEEP_DAILY_DAYS"  "weekly"
prune_tier month "$KEEP_WEEKLY_WEEKS" "monthly"

# Beyond the monthly horizon, keep nothing at all.
dropped="$(rclone delete "${CRYPT_REMOTE}:" \
             --min-age "$(( KEEP_WEEKLY_WEEKS * 7 ))d" \
             --include "${BACKUP_PREFIX}-*.dump" 2>/dev/null || echo 0)"
[ "${dropped:-0}" -gt 0 ] 2>/dev/null && \
  log "  beyond $(( KEEP_WEEKLY_WEEKS * 7 ))d: dropped ${dropped} file(s)"

# --- 6. integrity -----------------------------------------------------------
# cryptcheck reads and authenticates stored objects. Run after retention so a
# corrupted upload is caught in the same cycle.
if timeout 600 rclone cryptcheck "${CRYPT_REMOTE}:" >"${WORK_DIR}/cryptcheck.log" 2>&1; then
  log "cryptcheck passed"
else
  log "cryptcheck reported problems:"
  tail -10 "${WORK_DIR}/cryptcheck.log" >&2
  fail "Integrity check failed"
fi

# --- 7. report --------------------------------------------------------------
TOTAL="$(rclone size "${CRYPT_REMOTE}:" --json 2>/dev/null \
  | sed -n 's/.*"count":\([0-9]*\).*/\1/p' | head -1)"
ELAPSED=$(( $(date +%s) - START_EPOCH ))
log "done in ${ELAPSED}s | ${DUMP_NAME} | ${TOTAL:-?} file(s) retained"
log "${LOG_PREFIX} completed successfully"