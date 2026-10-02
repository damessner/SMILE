#!/usr/bin/env bash
# ==============================================================================
# SMILE — Proxmox VE Helper Script (LXC Creation & Automated Setup)
#
# Usage (run directly in Proxmox VE Shell as root):
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/damessner/SMILE/main/install-lxc.sh)"
#
# If repo is private, provide a GitHub Token:
#   GITHUB_TOKEN="ghp_xxxx" bash -c "$(curl -H "Authorization: token ghp_xxxx" -fsSL https://raw.githubusercontent.com/damessner/SMILE/main/install-lxc.sh)"
# ==============================================================================

set -euo pipefail

# --- Colors & formatting ---
YW=$(echo "\033[33m")
BL=$(echo "\033[36m")
RD=$(echo "\033[01;31m")
GN=$(echo "\033[1;92m")
CM=$(echo "\033[1;95m")
DGN=$(echo "\033[32m")
BOLD=$(echo "\033[1m")
CL=$(echo "\033[m")

info()  { echo -e "${BL}[INFO]${CL} $*"; }
ok()    { echo -e "${GN}[OK]${CL} $*"; }
warn()  { echo -e "${YW}[WARN]${CL} $*"; }
fail()  { echo -e "${RD}[ERROR]${CL} $*" >&2; exit 1; }

# --- Header Banner ---
clear
cat << "EOF"
  ____  __  __ ___ _     _____ 
 / ___||  \/  |_ _| |   | ____|
 \___ \| |\/| || || |   |  _|  
  ___) | |  | || || |___| |___ 
 |____/|_|  |_|___|_____|_____|

 Proxmox VE LXC Helper Script
 MS Telfs Dr. Aloys Weissenbach
=========================================================
EOF

# 1. Environment checks
[ "$(id -u)" -eq 0 ] || fail "This script must be run as root on the Proxmox VE host."
command -v pveversion >/dev/null 2>&1 || fail "This script must be executed on a Proxmox VE host."

info "Checking Proxmox environment..."
PVE_VER=$(pveversion | cut -d'/' -f2)
ok "Detected Proxmox VE $PVE_VER"

# 2. Configuration parameters (with sane defaults)
NEXTID=$(pvesh get /cluster/nextid 2>/dev/null || echo 116)

read -r -p "Enter Container ID [default: $NEXTID]: " INPUT_ID
CTID="${INPUT_ID:-$NEXTID}"

read -r -p "Enter Container Hostname [default: smile]: " INPUT_HN
HOSTNAME="${INPUT_HN:-smile}"

read -r -p "Enter Cores [default: 2]: " INPUT_CORES
CORES="${INPUT_CORES:-2}"

read -r -p "Enter RAM in MB [default: 2048]: " INPUT_RAM
RAM="${INPUT_RAM:-2048}"

read -r -p "Enter Disk Size in GB [default: 16]: " INPUT_DISK
DISK_SIZE="${INPUT_DISK:-16}"

# Detect best storage (prefers local-lvm, fallback to local or first available)
DEF_STORAGE="local-lvm"
if ! pvesm status -storage "$DEF_STORAGE" &>/dev/null; then
  DEF_STORAGE=$(pvesm status | awk 'NR>1 {print $1}' | grep -E 'lvm|zfs|dir|local' | head -n1 || echo "local")
fi
read -r -p "Enter Storage Pool [default: $DEF_STORAGE]: " INPUT_STORAGE
STORAGE="${INPUT_STORAGE:-$DEF_STORAGE}"

# Network bridge
DEF_BRIDGE="vmbr0"
read -r -p "Enter Network Bridge [default: $DEF_BRIDGE]: " INPUT_BRIDGE
BRIDGE="${INPUT_BRIDGE:-$DEF_BRIDGE}"

# Optional: clone database from existing CT on this host (e.g. 115)
IMPORT_CT=""
if pct list | grep -q "115"; then
  read -r -p "Import existing database from CT 115? (y/N): " DO_IMPORT
  if [[ "$DO_IMPORT" =~ ^[yY] ]]; then
    IMPORT_CT="115"
  fi
fi

# 3. Locate or download Debian 12 LXC template
info "Checking for Debian 12 standard template..."
TEMPLATE_PATH=""
CACHE_DIR="/var/lib/vz/template/cache"

if [ -d "$CACHE_DIR" ]; then
  TEMPLATE_FILE=$(ls -1 "$CACHE_DIR"/debian-12-standard*.tar.* 2>/dev/null | tail -n 1 || true)
  if [ -n "$TEMPLATE_FILE" ] && [ -f "$TEMPLATE_FILE" ]; then
    TEMPLATE_PATH="$TEMPLATE_FILE"
  fi
fi

if [ -z "$TEMPLATE_PATH" ]; then
  info "Downloading Debian 12 template to local storage..."
  pveam update >/dev/null
  AVAIL_TEMPLATE=$(pveam available -section system | grep "debian-12-standard" | awk '{print $2}' | tail -n 1)
  [ -n "$AVAIL_TEMPLATE" ] || fail "No Debian 12 template found in pveam catalogue."
  pveam download local "$AVAIL_TEMPLATE"
  TEMPLATE_PATH="${CACHE_DIR}/${AVAIL_TEMPLATE}"
fi
ok "Using template: $(basename "$TEMPLATE_PATH")"

# 4. Create Container
info "Creating LXC Container $CTID ($HOSTNAME)..."
pct create "$CTID" "$TEMPLATE_PATH" \
  --ostype debian \
  --hostname "$HOSTNAME" \
  --cores "$CORES" \
  --memory "$RAM" \
  --swap 512 \
  --rootfs "${STORAGE}:${DISK_SIZE}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=dhcp,type=veth" \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1 \
  --cmode shell

ok "LXC Container $CTID created successfully."

# 5. Start Container
info "Starting container $CTID..."
pct start "$CTID"

# Wait for container to get an IP / network connectivity
info "Waiting for network connectivity inside container..."
for i in {1..30}; do
  if pct exec "$CTID" -- ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pct exec "$CTID" -- ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1; then
  warn "Network ping test failed, waiting a few more seconds for DHCP..."
  sleep 5
fi

# 6. Optional: Export database dump from existing container before provisioning
DUMP_HOST_PATH=""
if [ -n "$IMPORT_CT" ]; then
  info "Dumping PostgreSQL database from CT $IMPORT_CT..."
  DUMP_HOST_PATH="/tmp/smile_import_${CTID}.dump"
  pct exec "$IMPORT_CT" -- sudo -u postgres pg_dump -Fc smile_db > "$DUMP_HOST_PATH" || warn "Dump failed; continuing with fresh DB."
  if [ -s "$DUMP_HOST_PATH" ]; then
    ok "Database dumped successfully ($(du -h "$DUMP_HOST_PATH" | cut -f1))"
  fi
fi

# 7. Provision software inside container
info "Installing prerequisites inside container (Debian packages, PostgreSQL 17, Node.js 22 LTS)..."

pct exec "$CTID" -- bash -c '
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "deb http://deb.debian.org/debian bookworm main contrib non-free non-free-firmware" > /etc/apt/sources.list
echo "deb http://deb.debian.org/debian-security bookworm-security main contrib non-free non-free-firmware" >> /etc/apt/sources.list
echo "deb http://deb.debian.org/debian bookworm-updates main contrib non-free non-free-firmware" >> /etc/apt/sources.list

apt-get update
apt-get install -y curl git sudo gnupg ca-certificates lsb-release jq openssl tar bzip2

# PostgreSQL 17 (PGDG repo)
install -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/postgresql.gpg ]; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
fi
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y postgresql-17
systemctl enable --now postgresql

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Dedicated unprivileged service user
if ! id -u smile >/dev/null 2>&1; then
  useradd -r -m -s /bin/bash -d /opt/smile smile
fi
'

ok "Prerequisites installed inside container."

# 8. Clone or transfer SMILE application
info "Setting up SMILE codebase in /opt/smile..."

GITHUB_TOKEN="${GITHUB_TOKEN:-}"
CLONE_SUCCESS=false

# Try git clone first
if pct exec "$CTID" -- bash -c "
if [ -n \"$GITHUB_TOKEN\" ]; then
  git clone https://${GITHUB_TOKEN}@github.com/damessner/SMILE.git /opt/smile
else
  git clone https://github.com/damessner/SMILE.git /opt/smile
fi
" 2>/dev/null; then
  CLONE_SUCCESS=true
fi

# Fallback: if git clone failed (e.g. private repo) and host has CT 115, copy from CT 115
if [ "$CLONE_SUCCESS" = false ]; then
  if pct list | grep -q "115"; then
    info "Cloning directly from CT 115 on this host..."
    pct exec 115 -- tar -czf /tmp/smile_source.tar.gz -C /opt/smile --exclude="node_modules" --exclude=".env" .
    pct pull 115 /tmp/smile_source.tar.gz /tmp/smile_source.tar.gz
    pct push "$CTID" /tmp/smile_source.tar.gz /tmp/smile_source.tar.gz
    pct exec "$CTID" -- tar -xzf /tmp/smile_source.tar.gz -C /opt/smile
    pct exec 115 -- rm -f /tmp/smile_source.tar.gz
    rm -f /tmp/smile_source.tar.gz
    CLONE_SUCCESS=true
  fi
fi

[ "$CLONE_SUCCESS" = true ] || fail "Could not clone SMILE. If the repo is private, re-run with: GITHUB_TOKEN=ghp_xxx $0"

ok "Codebase deployed to /opt/smile."

# 9. Configure PostgreSQL & generate secure secrets
info "Configuring PostgreSQL and application environment..."

pct exec "$CTID" -- bash -c '
set -euo pipefail

DB_PASS=$(openssl rand -hex 20)
JWT_SECRET=$(openssl rand -hex 32)
INITIAL_PW=$(openssl rand -hex 12)

# Create Postgres database & role
sudo -u postgres psql -c "DROP DATABASE IF EXISTS smile_db;" >/dev/null 2>&1 || true
sudo -u postgres psql -c "DROP USER IF EXISTS smile_user;" >/dev/null 2>&1 || true
sudo -u postgres psql -c "CREATE USER smile_user WITH ENCRYPTED PASSWORD '"$DB_PASS"';"
sudo -u postgres psql -c "CREATE DATABASE smile_db OWNER smile_user;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE smile_db TO smile_user;"

cat > /opt/smile/.env << EOF
DATABASE_URL="postgres://smile_user:${DB_PASS}@127.0.0.1:5432/smile_db"
JWT_SECRET="${JWT_SECRET}"
INITIAL_USER_PASSWORD="${INITIAL_PW}"
PORT=3000
HOST="0.0.0.0"
NODE_ENV="production"
RUN_MIGRATIONS="true"
EOF

chmod 600 /opt/smile/.env
chown smile:smile /opt/smile/.env
'

# 10. If importing database from CT 115, restore now
if [ -n "$IMPORT_CT" ] && [ -s "${DUMP_HOST_PATH:-}" ]; then
  info "Restoring database dump into new container..."
  pct push "$CTID" "$DUMP_HOST_PATH" /tmp/smile_import.dump
  pct exec "$CTID" -- bash -c '
    sudo -u postgres pg_restore -d smile_db --no-owner --role=smile_user /tmp/smile_import.dump >/dev/null 2>&1 || true
    rm -f /tmp/smile_import.dump
  '
  rm -f "$DUMP_HOST_PATH"
  ok "Database restored from CT $IMPORT_CT."
fi

# 11. Build application and run migrations
info "Building application bundles (Client & Server)..."

pct exec "$CTID" -- bash -c '
set -euo pipefail
cd /opt/smile

# Install production dependencies
npm install --omit=dev --ignore-scripts

# Build if dist folders not present
if [ ! -d "/opt/smile/server/dist" ] || [ ! -d "/opt/smile/client/dist" ]; then
  npm install --ignore-scripts
  npm run build --workspaces
  npm prune --omit=dev
fi

chown -R smile:smile /opt/smile
'

ok "Application built successfully."

# 12. Create systemd service
info "Configuring systemd service..."

pct exec "$CTID" -- bash -c '
cat > /etc/systemd/system/smile.service << "EOF"
[Unit]
Description=SMILE Collaborative Assessment Platform
After=network.target postgresql.service

[Service]
Type=simple
User=smile
WorkingDirectory=/opt/smile/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/smile/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now smile.service
'

# 13. Verify health
info "Verifying service health on port 3000..."
SERVICE_HEALTHY=false
for i in {1..30}; do
  if pct exec "$CTID" -- curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; then
    SERVICE_HEALTHY=true
    break
  fi
  sleep 1
done

[ "$SERVICE_HEALTHY" = true ] || warn "Service started but health check timed out. Check logs: pct exec $CTID -- journalctl -u smile.service"

# Retrieve Container IP
CONTAINER_IP=$(pct exec "$CTID" -- ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1 || echo "")

echo ""
echo -e "${GN}=========================================================${CL}"
echo -e "${GN}  ✓ SMILE LXC Container $CTID successfully deployed!${CL}"
echo -e "${GN}=========================================================${CL}"
echo ""
if [ -n "$CONTAINER_IP" ]; then
  echo -e "  ${BOLD}Web UI:${CL}      ${BL}http://${CONTAINER_IP}:3000${CL}"
else
  echo -e "  ${BOLD}Web UI:${CL}      ${BL}http://<CONTAINER_IP>:3000${CL}"
fi
echo -e "  ${BOLD}Status:${CL}      pct exec $CTID -- systemctl status smile.service"
echo -e "  ${BOLD}Logs:${CL}        pct exec $CTID -- journalctl -u smile.service -f"
echo ""
echo -e "${CM}Documentation & Security Guidelines: https://github.com/damessner/SMILE${CL}"
echo ""
