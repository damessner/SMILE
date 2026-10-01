#!/usr/bin/env bash
# Functional test for restore-from-gdrive.sh and restore-drill.sh.
#
# The property that matters most: the script must refuse to touch the live
# database without --force. Everything else is convenience; that gate is safety.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; PASS=$((PASS+1))
  else printf '  FAIL %s (expected "%s", got "%s")\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}
contains() { echo "$2" | grep -qF "$3" && echo yes || echo no; }

mkdir -p "$SANDBOX/bin" "$SANDBOX/remote" "$SANDBOX/state"

cat >"$SANDBOX/bin/rclone" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  lsf) ls -1 "$REPO_REMOTE/" 2>/dev/null || true ;;
  copyto)
    # Used in both directions: backup uploads ($2 local -> $3 remote),
    # restore downloads ($2 remote -> $3 local). Detect which by the colon.
    case "$2" in
      *:*) src="$REPO_REMOTE/${2#*:}"; [ -f "$src" ] || exit 1; cp "$src" "$3" ;;
      *)   dst="$REPO_REMOTE/${3#*:}";  [ -f "$2" ]  || exit 1; cp "$2" "$dst" ;;
    esac
    exit 0 ;;
  size) [ "${3:-}" = "--json" ] && echo '{"bytes":4242,"count":2}'; exit 0 ;;
  cryptcheck) exit 0 ;;
esac
exit 0
STUB

# pg_restore must accept --list only for a valid archive.
cat >"$SANDBOX/bin/pg_restore" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--list" ]; then
  grep -q FAKEDUMP "${2:-}" || { echo "not a pg_dump archive" >&2; exit 1; }
  echo ";"; echo "; TABLE DATA public pupils pupils"; exit 0
fi
echo "RESTORED into ${*}" >> "$PSQL_LOG"
exit "${PGRESTORE_FAIL:-0}"
STUB

cat >"$SANDBOX/bin/psql" <<'STUB'
#!/usr/bin/env bash
q=""
while [ $# -gt 0 ]; do case "$1" in --command=*) q="${1#*=}";; esac; shift; done
case "$q" in
  *pupils*)          echo "${FAKE_PUPILS:-326}" ;;
  *school_classes*)  echo 16 ;;
  *teachers*)        echo 45 ;;
  *users*)           echo 46 ;;
  *behavior_cards*)  echo "${FAKE_CARDS:-5}" ;;
  *audit_logs*)      echo 31 ;;
  "")                echo "" ;;
  *)                 echo "" ;;
esac
STUB

cat >"$SANDBOX/bin/createdb" <<'STUB'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case "$1" in -*) ;; *) echo "$1" >> "$DB_LOG";; esac; shift; done
STUB
cat >"$SANDBOX/bin/dropdb" <<'STUB'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case "$1" in -*) ;; *) echo "DROP $1" >> "$DB_LOG";; esac; shift; done
STUB

chmod +x "$SANDBOX/bin"/*
export REPO_REMOTE="$SANDBOX/remote"
export PATH="$SANDBOX/bin:$PATH"
export PSQL_LOG="$SANDBOX/state/psql.log"
export DB_LOG="$SANDBOX/state/db.log"
: >"$PSQL_LOG"; : >"$DB_LOG"

# Seed two plausible backups.
printf 'FAKEDUMP' >"$SANDBOX/remote/smile-20260101-000000.dump"
printf 'FAKEDUMP' >"$SANDBOX/remote/smile-20260102-000000.dump"

S="$REPO/scripts/restore-from-gdrive.sh"
export CRYPT_REMOTE="gdrive-crypt"
export DB_NAME="smile_db" SCRATCH_DB="smile_restore_test"

echo "=== restore-from-gdrive.sh ==="

out="$(bash "$S" --list 2>&1)"; rc=$?
check "--list exits 0" "0" "$rc"
check "--list shows both backups" "yes" "$(contains x "$out" "smile-20260101-000000.dump")"

# --- dry run writes nothing -------------------------------------------------
: >"$DB_LOG"; : >"$PSQL_LOG"
out="$(bash "$S" --latest --dry-run 2>&1)"; rc=$?
check "--dry-run exits 0" "0" "$rc"
check "--dry-run says nothing was written" "yes" "$(contains x "$out" "nothing was written")"
check "--dry-run created no database" "0" "$(grep -c . "$DB_LOG")"
check "--dry-run ran no restore" "0" "$(grep -c . "$PSQL_LOG")"

# --- path traversal is refused ---------------------------------------------
out="$(bash "$S" --file "../../etc/passwd" 2>&1)"; rc=$?
check "rejects path traversal in --file" "1" "$rc"
check "explains the refusal" "yes" "$(contains x "$out" "Refusing a path")"

# --- missing file -----------------------------------------------------------
out="$(bash "$S" --file "no-such-backup.dump" 2>&1)"; rc=$?
check "fails on a missing backup" "1" "$rc"

# --- the critical gate: refuse to clobber the live DB ----------------------
: >"$DB_LOG"; : >"$PSQL_LOG"
out="$(bash "$S" --latest --target "$DB_NAME" 2>&1)"; rc=$?
check "refuses to overwrite live DB without --force" "1" "$rc"
check "says so explicitly" "yes" "$(contains x "$out" "Refusing to overwrite")"
check "dropped nothing" "0" "$(grep -c 'DROP smile_db' "$DB_LOG")"
check "ran no restore" "0" "$(grep -c . "$PSQL_LOG")"

# --- happy path into scratch ----------------------------------------------
: >"$DB_LOG"; : >"$PSQL_LOG"
out="$(bash "$S" --latest 2>&1)"; rc=$?
check "scratch restore exits 0" "0" "$rc"
check "targets the scratch DB by default" "yes" "$(contains x "$out" "smile_restore_test")"
check "live DB never dropped" "0" "$(grep -c 'DROP smile_db' "$DB_LOG")"
check "reports RESTORE OK" "yes" "$(contains x "$out" "RESTORE OK")"
check "selected the newest backup" "yes" "$(contains x "$out" "smile-20260102-000000.dump")"

# --- a restore that yields zero pupils must be treated as failure ----------
: >"$DB_LOG"; : >"$PSQL_LOG"
out="$(FAKE_PUPILS=0 bash "$S" --latest 2>&1)"; rc=$?
check "fails when restored DB has no pupils" "1" "$rc"
check "says the restore FAILED" "yes" "$(contains x "$out" "no pupils")"

# --- corrupt archive --------------------------------------------------------
printf 'GARBAGE' >"$SANDBOX/remote/smile-20260103-000000.dump"
out="$(bash "$S" --latest 2>&1)"; rc=$?
check "rejects a corrupt archive" "1" "$rc"
check "mentions corruption" "yes" "$(contains x "$out" "corrupt")"

echo ""
echo "=== restore-drill.sh ==="
rm -f "$SANDBOX/remote/smile-20260103-000000.dump"
: >"$DB_LOG"; : >"$PSQL_LOG"
out="$(bash "$REPO/scripts/restore-drill.sh" 2>&1)"; rc=$?
check "drill passes on a good backup" "0" "$rc"
check "reports PASSED" "yes" "$(contains x "$out" "PASSED")"
check "drill never touches live DB" "0" "$(grep -c 'DROP smile_db' "$DB_LOG")"
check "drill drops its own scratch DB" "yes" "$(contains x "$(cat "$DB_LOG")" "smile_restore_drill")"

# drill fails loudly on an implausibly small restore
: >"$DB_LOG"; : >"$PSQL_LOG"
out="$(FAKE_PUPILS=3 bash "$REPO/scripts/restore-drill.sh" 2>&1)"; rc=$?
check "drill fails on a suspiciously small restore" "1" "$rc"
check "explains it looks partial" "yes" "$(contains x "$out" "partial restore")"

echo ""
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]