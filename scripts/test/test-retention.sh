#!/usr/bin/env bash
# Functional test for the tiered retention logic in backup-to-gdrive.sh.
#
# The properties that matter:
#   1. Recent hourly backups are NEVER pruned.
#   2. Older material is thinned to one representative per day/week/month.
#   3. The NEWEST file in each bucket always survives.
#   4. Files that do not match the naming convention are left alone.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then printf '  ok   %s\n' "$1"; PASS=$((PASS+1))
  else printf '  FAIL %s (expected "%s", got "%s")\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); fi
}
survives() { [ -f "$SANDBOX/remote/$1" ] && echo yes || echo no; }

mkdir -p "$SANDBOX/bin" "$SANDBOX/remote"

# Stub rclone that mutates the fake remote so pruning is observable.
# `delete` is a no-op because --min-age semantics are rclone's job, not ours;
# the age gating under test is implemented in prune_tier itself.
cat >"$SANDBOX/bin/rclone" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  lsd) exit 0 ;;
  copyto) cp "$2" "$REPO_REMOTE/$(basename "${3#*:}")"; exit 0 ;;
  cat|size|cryptcheck) exit 0 ;;
  size) exit 0 ;;
  lsf) ls -1 "$REPO_REMOTE/" 2>/dev/null | grep '^smile-' || true ;;
  lsjson) echo '[]' ;;
  # deletefile takes only the target as $2 (unlike copyto, which also has $3).
  deletefile)
    [ -f "$REPO_REMOTE/${2#*:}" ] || exit 1
    rm -f "$REPO_REMOTE/${2#*:}"; exit 0 ;;
  delete) exit 0 ;;
esac
exit 0
STUB
cat >"$SANDBOX/bin/pg_dump" <<'STUB'
#!/usr/bin/env bash
out=""; while [ $# -gt 0 ]; do case "$1" in --file=*) out="${1#*=}";; esac; shift; done
printf 'FAKEDUMP' > "$out"
STUB
cat >"$SANDBOX/bin/pg_restore" <<'STUB'
#!/usr/bin/env bash
if [ "${1:-}" = "--list" ]; then echo ";"; echo "; TABLE DATA public pupils pupils"; fi
STUB
chmod +x "$SANDBOX/bin"/*

export REPO_REMOTE="$SANDBOX/remote"
export PATH="$SANDBOX/bin:$PATH"

# --- seed: 6 days of 4 dumps/day, relative to today -------------------------
# recent_days=1,2 stay hourly; days 5-10 are old enough for the daily tier.
day_stamp() { date -u -d "$1 days ago" +%Y%m%d; }
for back in 0 1 2 5 8 10; do
  d="$(day_stamp "$back")"
  for hh in 00 06 12 18; do
    : >"$SANDBOX/remote/smile-${d}-${hh}0000.dump"
  done
done
TODAY="$(day_stamp 0)"

echo "  seeded $(ls -1 "$SANDBOX/remote" | wc -l | tr -d ' ') backups"
(cd "$SANDBOX" && bash "$REPO/scripts/backup-to-gdrive.sh" >"$SANDBOX/run.log" 2>&1)

echo "  --- retention decisions ---"
sed -n 's/^.*applying retention.*$/&/p' "$SANDBOX/run.log" | sed 's/^/    /'
grep -E "pruned|dropped" "$SANDBOX/run.log" | sed 's/^/    /'

# --- property 1: recent hourly backups survive untouched --------------------
for hh in 00 06 12 18; do
  check "today's ${hh}00 backup kept" "yes" "$(survives "smile-${TODAY}-${hh}0000.dump")"
done
check "yesterday's 1800 backup kept" "yes" "$(survives "smile-$(day_stamp 1)-180000.dump")"

# --- property 3: newest per bucket survives for the older days --------------
check "newest of day -5 survives" "yes" "$(survives "smile-$(day_stamp 5)-180000.dump")"
check "newest of day -8 survives" "yes" "$(survives "smile-$(day_stamp 8)-180000.dump")"
check "newest of day -10 survives" "yes" "$(survives "smile-$(day_stamp 10)-180000.dump")"

# --- property 2: older siblings within a day were thinned -------------------
check "oldest of day -5 pruned" "no" "$(survives "smile-$(day_stamp 5)-000000.dump")"
check "middle of day -8 pruned" "no" "$(survives "smile-$(day_stamp 8)-060000.dump")"

# --- property 4: unrelated files untouched ----------------------------------
: >"$SANDBOX/remote/smile-not-a-timestamp.dump"
: >"$SANDBOX/remote/README.txt"
(cd "$SANDBOX" && bash "$REPO/scripts/backup-to-gdrive.sh" >/dev/null 2>&1)
check "malformed backup name left alone" "yes" "$(survives "smile-not-a-timestamp.dump")"
check "unrelated file untouched" "yes" "$(survives "README.txt")"

echo ""
echo "  final contents:"
ls -1 "$SANDBOX/remote" | sed 's/^/    /'
echo ""
echo "passed: $PASS   failed: $FAIL"
[ "$FAIL" -eq 0 ]