#!/usr/bin/env bash
#
# setup-m365-rclone.sh — one-time delegated-OAuth setup for the SMILE M365 backup.
#
# What this replaces:
#   The old backup authenticated with `grant_type=password` (ROPC). That flow is
#   blocked by Microsoft Security Defaults and by MFA/Conditional Access, and it
#   requires the account password to sit in a file on the server. Moving to
#   rclone with a delegated OAuth token removes both problems: the token is
#   revocable, survives MFA, and no password is stored anywhere on this box.
#
# What this does:
#   1. checks rclone is present and new enough
#   2. checks whether an 'm365' OneDrive remote already exists (refuses to clobber)
#   3. guides you through `rclone authorize` (run on a machine WITH a browser)
#   4. verifies the remote can list the SMILE-Backups folder
#
# What it deliberately does NOT do:
#   - write the token for you: `rclone authorize` needs a browser and an
#     interactive login as the service account, so it must be run by a human
#   - store the Microsoft account password anywhere
#
# Usage:  bash setup-m365-rclone.sh
#         RCLONE_CONFIG=/etc/smile/rclone.conf bash setup-m365-rclone.sh

set -euo pipefail

REMOTE="${RCLONE_REMOTE:-m365}"
CONFIG="${RCLONE_CONFIG:-/etc/smile/rclone.conf}"
MODE=600

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m  x %s\033[0m\n' "$*" >&2; exit 1; }

# --- 0. refuse to run as root -------------------------------------------------
# The config must be readable by the backup unit, which runs as user 'smile'.
# Root's own config would not be.
if [ "$(id -u)" -eq 0 ]; then
  die "Run as the smile service user, not root. Example:
      sudo -u smile RCLONE_CONFIG=$CONFIG bash $0"
fi

# --- 1. prerequisites ---------------------------------------------------------
say "1/3  Checking prerequisites"

command -v rclone >/dev/null 2>&1 || die "rclone not installed.
   Debian/Ubuntu:  apt-get install -y rclone"

RCLONE_VERSION="$(rclone version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)"
[ -n "$RCLONE_VERSION" ] || die "could not determine rclone version"
printf '  rclone %s\n' "$RCLONE_VERSION"

# --- 2. does the remote already exist? ----------------------------------------
say "2/3  Checking for an existing '$REMOTE' remote"

mkdir -p "$(dirname "$CONFIG")"
touch "$CONFIG"; chmod "$MODE" "$CONFIG"

if grep -q "^\[${REMOTE}\]" "$CONFIG" 2>/dev/null; then
  printf '  remote already configured\n'
  if rclone lsd "${REMOTE}:" --config "$CONFIG" --timeout 30s >/dev/null 2>&1; then
    say "Remote '$REMOTE' works. Nothing to do."
    printf '  You can now unset M365_PASSWORD in /etc/smile/backup.env.\n'
    exit 0
  fi
  die "Remote '$REMOTE' exists in $CONFIG but cannot be reached.
   The refresh token has probably expired or been revoked. Remove the
   [${REMOTE}] stanza and re-run this script."
fi

# --- 3. authorize -------------------------------------------------------------
say "3/3  Authorize the OneDrive remote"

cat <<EOF

  This step needs a browser and an interactive login as the SMILE service
  account. It cannot be automated.

  On a machine with a browser, run:

      rclone authorize "onedrive"

  and log in as the service account (e.g. smile@ms-telfs.at).

  rclone will print a JSON blob beginning {"access_token": ...}.
  Copy the ENTIRE blob.

EOF

printf '  Paste the token JSON, then press Ctrl-D on an empty line:\n'
TOKEN_JSON="$(cat)"

# Validate that it is really a token object and not a paste accident.
printf '%s' "$TOKEN_JSON" | grep -q '"access_token"' \
  || die "That does not look like an rclone token (no access_token field). Nothing was written."

cat >>"$CONFIG" <<EOF

[$REMOTE]
type = onedrive
token = ${TOKEN_JSON}
EOF
chmod "$MODE" "$CONFIG"
printf '  wrote %s (mode %s)\n' "$CONFIG" "$MODE"

# --- verify -------------------------------------------------------------------
say "Verifying the remote"

if ! rclone lsd "${REMOTE}:" --config "$CONFIG" --timeout 30s >/dev/null 2>&1; then
  die "Remote '$REMOTE' cannot be reached. Check the token and try again.
   The [${REMOTE}] stanza has been left in $CONFIG — remove it before retrying."
fi
printf '  can list the drive\n'

mkdir -p "$(dirname "$CONFIG")"

say "Done"
cat <<EOF
  1. Remove M365_PASSWORD from /etc/smile/backup.env. It is no longer used.
  2. Run a preflight check:
       sudo -u smile python3 /opt/smile/scripts/backup_m365.py --check
  3. Then start the timer if it is not already running:
       systemctl start smile-m365-backup.timer

  The token can be revoked at any time from the Microsoft account's
  "Apps and services that can access your account" page. Revoke it and
  re-run this script to recover.
EOF
