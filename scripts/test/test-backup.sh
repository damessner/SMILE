#!/usr/bin/env bash
# Functional test for backup-to-gdrive.sh using stub binaries.
# Verifies the ordering guarantees and failure handling, not just syntax.
set -uo pipefail

# This file lives at <repo>/scripts/test/, so the repo root is two levels up.
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

PASS=0; FAIL=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; PASS=$((PASS+1))
  else printf '  FAIL %s (expected "%s", got "%s")\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}

mkdir -p "$SANDBOX/bin" "$SANDBOX/remote"

# --- stubs -----------------------------------------------------------------
cat >"$SANDBOX/bin/rclone" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  lsd)   [ "${RCLONE_REACHABLE:-yes}" = "yes" ] || exit 1; exit 0 ;;
  copyto)
    dest="${3#*:}"; dir="$(dirname "$dest")"
    mkdir -p "${REPO_REMOTE}/${dir}"
    cp "$2" "${REPO_REMOTE}/${dir}/$(basename "$dest")"; exit 0 ;;
  cat)   exit "${RCLONE_CAT_FAIL:-0}" ;;
  size)
    # emit json-ish line the script seds
    if [ "$3" = "--json" ]; then echo '{"bytes":12345,"count":1}'; exit 0; fi ;;
  lsf)
    ls -1 "${REPO_REMOTE}/" 2>/dev/null | grep '^smile-' || exit 0 ;;
  lsjson) echo '[{"Name":"smile-20260101-000000.dump","ModTime":"2026-01-01T00:00:00.000Z"}]'; exit 0 ;;
  delete) exit 0 ;;
  deletefile) exit 0 ;;
  cryptcheck) exit "${RCLONE_CRYPTCHECK_FAIL:-0}" ;;
esac
exit 0
EOF

cat >"$SANDBOX/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do case "$1" in --file=*) out="${1#*=}";; esac; shift; done
[ "${PGDUMP_FAIL:-no}" = "yes" ] && { echo "simulated pg_dump failure" >&2; exit 1; }
printf 'FAKEDUMP' > "$out"
exit 0
EOF

cat >"$SANDBOX/bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "--list" ]; then
  f="${2:-}"
  grep -q FAKEDUMP "$f" || exit 1
  echo "; Archive created at 2026-01-01"
  echo ";" "  TABLE DATA public pupils pupils"
  exit 0
fi
exit 0
EOF

export REPO_REMOTE="$SANDBOX/remote"
export PATH="$SANDBOX/bin:$PATH"

# Stubs must be executable or the script under test gets 127 (command not found).
chmod +x "$SANDBOX/bin"/*

echo "=== backup-to-gdrive.sh ==="

# --- happy path -------------------------------------------------------------
out="$(cd "$SANDBOX" && bash "$REPO/scripts/backup-to-gdrive.sh" 2>&1)"; rc=$?
check "exits 0 on success" "0" "$rc"
check "dump validated before upload" "1" "$(echo "$out" | grep -c 'dump validated')"
check "reports upload complete" "1" "$(echo "$out" | grep -c 'upload complete')"
check "runs cryptcheck" "1" "$(echo "$out" | grep -c 'cryptcheck')"
check "one file landed in remote" "1" "$(ls -1 "$SANDBOX/remote" | wc -l | tr -d ' ')"

# --- unreachable destination: must NOT produce a dump -----------------------
rm -f "$SANDBOX/remote"/*
out="$(cd "$SANDBOX" && RCLONE_REACHABLE=no bash "$REPO/scripts/backup-to-gdrive.sh" 2>&1)"; rc=$?
check "fails when Drive unreachable" "1" "$rc"
check "checks reachability before dumping" "0" "$(echo "$out" | grep -c 'dumping ')"
check "explains it skipped the dump" "1" "$(echo "$out" | grep -c 'Skipping dump')"

# --- corrupt dump must not be uploaded -------------------------------------
out="$(cd "$SANDBOX" && PGDUMP_FAIL=yes bash "$REPO/scripts/backup-to-gdrive.sh" 2>&1)"; rc=$?
check "fails when pg_dump fails" "1" "$rc"
check "does not claim upload on failure" "0" "$(echo "$out" | grep -c 'upload complete')"

# --- unreadable remote object is a failure ---------------------------------
rm -f "$SANDBOX/remote"/*
out="$(cd "$SANDBOX" && RCLONE_CAT_FAIL=1 bash "$REPO/scripts/backup-to-gdrive.sh" 2>&1)"; rc=$?
check "fails when object is unreadable" "1" "$rc"
check "names the readback check" "1" "$(echo "$out" | grep -c 'not readable')"

# --- integrity failure ------------------------------------------------------
rm -f "$SANDBOX/remote"/*
out="$(cd "$SANDBOX" && RCLONE_CRYPTCHECK_FAIL=1 bash "$REPO/scripts/backup-to-gdrive.sh" 2>&1)"; rc=$?
check "fails when cryptcheck fails" "1" "$rc"
check "surfaces cryptcheck output" "1" "$(echo "$out" | grep -c 'Integrity check failed')"

echo ""
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]