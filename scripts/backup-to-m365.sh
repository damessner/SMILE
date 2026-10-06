#!/usr/bin/env bash
#
# backup-to-m365.sh — Automated Microsoft 365 / OneDrive / SharePoint Backup for SMILE
#
set -euo pipefail

BACKUP_DIR="/var/backups/smile"
REMOTE_NAME="m365"
REMOTE_FOLDER="SMILE-Backups"
RETENTION_DAYS=14
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/smile_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# 1. PostgreSQL Database Dump
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting PostgreSQL backup..."
if [ -f "/opt/smile/.env" ]; then
    DB_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
else
    DB_URL="${DATABASE_URL:-postgres://smile_user:8JG1V6S28pQl6NZYqLjuHQ1d7hIeWY5h@127.0.0.1:5432/smile_db}"
fi

pg_dump "${DB_URL}" | gzip > "${BACKUP_FILE}"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Database dumped to ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"


# 2. Generate Live Excel Overview
EXCEL_FILE="${BACKUP_DIR}/SMILE_Aktuelle_Gesamtuebersicht.xlsx"
if [ -f "/opt/smile/scripts/export-live-excel.py" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Generating live Excel overview..."
    python3 /opt/smile/scripts/export-live-excel.py "${EXCEL_FILE}" || {
        echo "[WARNING] Excel export failed, continuing with SQL backup."
    }
fi

# 3. Upload to Microsoft 365 via rclone
if command -v rclone >/dev/null 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Uploading to ${REMOTE_NAME}:${REMOTE_FOLDER}..."
    rclone copy "${BACKUP_FILE}" "${REMOTE_NAME}:${REMOTE_FOLDER}/daily-snapshots/" --quiet || {
        echo "[WARNING] rclone upload failed, check rclone configuration."
    }

    # Also keep a pointer to latest
    rclone copyto "${BACKUP_FILE}" "${REMOTE_NAME}:${REMOTE_FOLDER}/smile_latest_backup.sql.gz" --quiet || true

    # Upload Live Excel overview
    if [ -f "${EXCEL_FILE}" ]; then
        rclone copyto "${EXCEL_FILE}" "${REMOTE_NAME}:${REMOTE_FOLDER}/SMILE_Aktuelle_Gesamtuebersicht.xlsx" --quiet || true
    fi

    # Clean up backups older than retention days in cloud
    rclone delete --min-age "${RETENTION_DAYS}d" "${REMOTE_NAME}:${REMOTE_FOLDER}/daily-snapshots/" --quiet || true
else
    echo "[WARNING] rclone not found, backup stored locally only."
fi

# 3. Local Cleanup
find "${BACKUP_DIR}" -type f -name "smile_backup_*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup completed successfully."
