#!/usr/bin/env bash
# Runs every bash test suite in this directory.
# Usage: bash scripts/test/run-all.sh
set -uo pipefail

cd "$(dirname "$0")" || exit 1

TOTAL_PASS=0
TOTAL_FAIL=0
SUITES=0
FAILED_SUITES=""

for suite in test-*.sh; do
  [ -e "$suite" ] || continue
  SUITES=$((SUITES + 1))
  echo ""
  echo "=============================================================="
  echo "  $suite"
  echo "=============================================================="
  out="$(bash "$suite" 2>&1)"
  echo "$out"
  p="$(echo "$out" | sed -n 's/^passed: \([0-9]*\).*/\1/p' | tail -1)"
  f="$(echo "$out" | sed -n 's/.*failed: \([0-9]*\)$/\1/p' | tail -1)"
  p="${p:-0}"; f="${f:-0}"
  TOTAL_PASS=$((TOTAL_PASS + p))
  TOTAL_FAIL=$((TOTAL_FAIL + f))
  [ "$f" -eq 0 ] || FAILED_SUITES="$FAILED_SUITES $suite"
done

echo ""
echo "=============================================================="
echo "  $SUITES suite(s): $TOTAL_PASS passed, $TOTAL_FAIL failed"
if [ -n "$FAILED_SUITES" ]; then
  echo "  FAILED:$FAILED_SUITES"
  exit 1
fi
echo "  all green"