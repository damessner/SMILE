#!/usr/bin/env bash
#
# setup-https.sh — install Caddy on the SMILE LXC and enable the internal HTTPS
# listener for https://172.16.1.11 and https://smile.schule.intern.
#
# The application keeps listening on :3000 during the transition. The HTTPS
# listener is additional, not a replacement.
#
# Run as root inside the SMILE container:
#   bash /opt/smile/scripts/https/setup-https.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CADDYFILE_SOURCE="${SCRIPT_DIR}/Caddyfile"
CADDYFILE_TARGET="/etc/caddy/Caddyfile"
CA_PUBLIC_COPY="/opt/smile-shared/smile-internal-ca.crt"

log() { printf '[smile-https] %s\n' "$*"; }
fail() { printf '[smile-https] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root"
[ -f "$CADDYFILE_SOURCE" ] || fail "Caddyfile not found at $CADDYFILE_SOURCE"

if ! command -v caddy >/dev/null 2>&1; then
  log "installing Caddy from the official repository"
  apt-get update
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg

  install -d -m 0755 /usr/share/keyrings
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

install -d -m 0755 /etc/caddy
if [ -f "$CADDYFILE_TARGET" ] && ! cmp -s "$CADDYFILE_SOURCE" "$CADDYFILE_TARGET"; then
  backup="/etc/caddy/Caddyfile.bak.$(date -u +%Y%m%d-%H%M%S)"
  cp -a "$CADDYFILE_TARGET" "$backup"
  log "existing Caddyfile backed up to $backup"
fi
install -m 0644 "$CADDYFILE_SOURCE" "$CADDYFILE_TARGET"

caddy validate --config "$CADDYFILE_TARGET" --adapter caddyfile
systemctl enable caddy
systemctl restart caddy

# Wait for the HTTPS listener to answer. -k is intentional here: the local CA
# root is not yet installed on this shell's trust store, but the service must be
# reachable before we export it.
for _ in $(seq 1 30); do
  if curl -skf --max-time 2 https://172.16.1.11/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
curl -skf --max-time 5 https://172.16.1.11/health >/dev/null \
  || fail "Caddy is running but /health is not reachable over HTTPS"

CA_ROOT="$(find /var/lib/caddy -type f -name root.crt -path '*pki/authorities/local/*' 2>/dev/null | head -n 1 || true)"
[ -n "$CA_ROOT" ] || fail "Caddy internal CA root certificate not found"
install -d -m 0755 /opt/smile-shared
install -m 0644 "$CA_ROOT" "$CA_PUBLIC_COPY"

# Ready-to-upload Apple profile: root CA + SMILE Web Clip. MDM/Configurator
# installation trusts the certificate automatically; manual installs still need
# the Certificate Trust Settings step on iOS/iPadOS.
if [ -f "$SCRIPT_DIR/make-apple-profile.py" ]; then
  python3 "$SCRIPT_DIR/make-apple-profile.py" \
    "$CA_ROOT" /opt/smile-shared/smile-internal-ca.mobileconfig
fi

# HTTPS requests carry an https:// Origin while SMILE is still on HTTP behind
# Caddy. Keep TRUST_PROXY=false (direct port 3000 must not trust spoofed
# X-Forwarded-* headers) and allow the two HTTPS origins explicitly instead.
if [ -f /opt/smile-shared/.env ] && ! grep -q '^CORS_ALLOWED_ORIGINS=' /opt/smile-shared/.env; then
  printf '\nCORS_ALLOWED_ORIGINS="https://172.16.1.11,https://smile.schule.intern"\n' >> /opt/smile-shared/.env
  systemctl restart smile.service
  log "added HTTPS origins to CORS_ALLOWED_ORIGINS and restarted smile.service"
fi

log "HTTPS is active: https://172.16.1.11 and https://smile.schule.intern"
log "Caddy CA root: $CA_ROOT"
log "Public copy for device installation: $CA_PUBLIC_COPY"
log "Port 3000 remains reachable during the transition."
