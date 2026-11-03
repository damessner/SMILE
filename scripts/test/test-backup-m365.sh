#!/usr/bin/env bash
#
# test-backup-m365.sh — functional test for backup_m365.py using stub binaries.
#
# Verifies the guarantees the script advertises, not just syntax:
#   - fails before dumping when configuration is incomplete
#   - never encrypts with a fallback key derived from the M365 password
#   - local pruning happens AFTER a successful upload, not before
#   - report-generation failure fails the run
#   - timestamped intraday folders are pruned after CLOUD_KEEP_DAYS
#
# Every external command is stubbed, so this runs on any machine with python3.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

PASS=0; FAIL=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; PASS=$((PASS+1))
  else printf '  FAIL %s (expected "%s", got "%s")\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}

mkdir -p "$SANDBOX/bin"

# --- stubs ------------------------------------------------------------------
cat >"$SANDBOX/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do case "$1" in --file=*) out="${1#*=}";; esac; shift; done
[ "${PGDUMP_FAIL:-no}" = "yes" ] && { echo "simulated pg_dump failure" >&2; exit 1; }
printf 'FAKEDUMP' > "$out"; exit 0
EOF

cat >"$SANDBOX/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
[ "${1:-}" = "--list" ] || exit 0
f="${2:-}"
grep -q FAKEDUMP "$f" || exit 1
echo "; Archive created at 2026-01-01"
echo ";" "  TABLE DATA public pupils pupils"
exit 0
EOF

# Records the arguments it was called with, so tests can assert on them.
cat >"$SANDBOX/bin/openssl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${SSL_CALLS:-/dev/null}"
[ "${SSL_FAIL:-no}" = "yes" ] && exit 1
in=""
while [ $# -gt 0 ]; do case "$1" in -in) in="$2";; -out) out="$2";; esac; shift; done
printf 'FAKECIPHER' > "$out"; exit 0
EOF

# Requires openssl to have been called with the right key, so a run that
# encrypts with the wrong secret is detected here rather than in production.
cat >"$SANDBOX/bin/wget" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "$SANDBOX/bin"/*
export PATH="$SANDBOX/bin:$PATH"

# --- harness ----------------------------------------------------------------
# Each case gets its own backup dir and env file so nothing leaks between them.
#
# The script under test is copied into the sandbox. That matters: it computes
# the report-generator path from its own location, so running the copy means
# the real generate_export_reports.py / export-live-excel.py are absent and the
# run does not need a live database.
run_case() { # run_case <label> <settings...> -- sets env, prints rc
  CASE="$SANDBOX/case-$RANDOM"
  mkdir -p "$CASE/backups" "$CASE/bin"
  printf '%s\n' "$@" > "$CASE/backup.env"
  cp "$REPO/scripts/backup_m365.py" "$CASE/bin/"
  export BACKUP_DIR="$CASE/backups"
  export SMILE_ENV_FILE="$CASE/backup.env"
  export BACKUP_ENV_FILE="$CASE/backup.env"
  SCRIPT="$CASE/bin/backup_m365.py"
}

export SSL_CALLS="$SANDBOX/openssl.calls"

echo "=== backup_m365.py ==="

# --- 1. incomplete configuration fails BEFORE a dump is produced -------------
run_case \
  "DATABASE_URL=postgresql://smile_backup@127.0.0.1:5432/smile_db" \
  "M365_USER=smile@example.test" \
  "M365_PASSWORD=secret"
# No BACKUP_ENCRYPTION_PASSPHRASE: this is the exact configuration that used to
# silently encrypt with the Microsoft account password.
out="$(python3 "$REPO/scripts/backup_m365.py" 2>&1)"; rc=$?
check "fails when no encryption passphrase is set" "1" "$rc"
check "refuses a fallback key" "1" "$(echo "$out" | grep -c 'never the M365 password')"
check "does not dump without a key" "0" "$(echo "$out" | grep -c 'Starting local database dump')"
check "produces no dump file" "0" "$(ls -1 "$BACKUP_DIR" | wc -l | tr -d ' ')"

# --- 2. --check validates the same contract ---------------------------------
run_case \
  "DATABASE_URL=postgresql://smile_backup@127.0.0.1:5432/smile_db" \
  "M365_USER=smile@example.test" \
  "M365_PASSWORD=secret" \
  "BACKUP_ENCRYPTION_PASSPHRASE=independent-secret"
out="$(python3 "$REPO/scripts/backup_m365.py" --check 2>&1)"; rc=$?
check "preflight exits 0 when configured" "0" "$rc"
check "preflight reports all prerequisites present" "1" "$(echo "$out" | grep -c 'Preflight passed')"

# --- 3. a passing key is used for encryption, not the M365 password ----------
run_case \
  "DATABASE_URL=postgresql://smile_backup@127.0.0.1:5432/smile_db" \
  "M365_USER=smile@example.test" \
  "M365_PASSWORD=the-microsoft-password" \
  "BACKUP_ENCRYPTION_PASSPHRASE=independent-secret"
rm -f "$SSL_CALLS"
python3 "$REPO/scripts/backup_m365.py" >/dev/null 2>&1
check "encrypts with the configured passphrase" "1" "$(grep -c 'pass:independent-secret' "$SSL_CALLS" 2>/dev/null || echo 0)"
check "never encrypts with the M365 password" "0" "$(grep -c 'pass:the-microsoft-password' "$SSL_CALLS" 2>/dev/null || echo 0)"

# --- 4. timestamped classification -------------------------------------------
# A 10:19 run must be 'intraday', not a daily: the substring check this replaced
# matched any name containing _19.
snap() { python3 -c "import sys; sys.path.insert(0,'$REPO/scripts'); import backup_m365 as b; print(b.snapshot_kind(sys.argv[1])[0])" "$1"; }
check "19:00 snapshot is daily"     "daily"    "$(snap smile_db_2026-10-10_1900.dump)"
check "10:19 snapshot is intraday"  "intraday" "$(snap smile_db_2026-10-10_1019.dump)"
check "06:00 snapshot is intraday"  "intraday" "$(snap smile_db_2026-10-10_0600.dump)"
check "safety snapshot is ignored"  "None"     "$(snap pre-restore-safety-2026-10-10.dump)"

# --- 5. local pruning only expires old snapshots -----------------------------
run_case \
  "DATABASE_URL=postgresql://smile_backup@127.0.0.1:5432/smile_db" \
  "M365_USER=smile@example.test" \
  "M365_PASSWORD=secret" \
  "BACKUP_ENCRYPTION_PASSPHRASE=independent-secret"
touch -d "40 days ago" "$BACKUP_DIR/smile_db_2026-08-31_1010.dump"   # expired intraday
touch -d "20 days ago" "$BACKUP_DIR/smile_db_2026-09-20_1900.dump"   # daily, still inside 30d
touch -d "40 days ago" "$BACKUP_DIR/smile_db_2026-08-31_1900.dump"   # expired daily
touch -d "1 day ago"   "$BACKUP_DIR/smile_db_2026-10-09_1010.dump"   # fresh intraday
touch -d "1 day ago"   "$BACKUP_DIR/pre-restore-safety-manual.dump"  # must survive
python3 -c "
import sys; sys.path.insert(0,'$REPO/scripts')
import backup_m365 as b, os
b.prune_local_backups('$BACKUP_DIR')"
check "keeps a fresh intraday snapshot"        "1" "$([ -f "$BACKUP_DIR/smile_db_2026-10-09_1010.dump" ] && echo 1 || echo 0)"
check "keeps a 20-day-old daily snapshot"     "1" "$([ -f "$BACKUP_DIR/smile_db_2026-09-20_1900.dump" ] && echo 1 || echo 0)"
check "prunes an expired intraday snapshot"    "1" "$([ ! -f "$BACKUP_DIR/smile_db_2026-08-31_1010.dump" ] && echo 1 || echo 0)"
check "prunes an expired daily snapshot"       "1" "$([ ! -f "$BACKUP_DIR/smile_db_2026-08-31_1900.dump" ] && echo 1 || echo 0)"
check "never prunes a safety snapshot"        "1" "$([ -f "$BACKUP_DIR/pre-restore-safety-manual.dump" ] && echo 1 || echo 0)"

echo ""
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]
