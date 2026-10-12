#!/usr/bin/env python3
"""
Read-only inspection of LXC 115 before deploying.

Deliberately does not modify anything: this script only reports.
The password is read from the environment and never written to disk.
"""
import os
import sys
import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = os.environ.get('PROXMOX_HOST', '172.16.1.54')
USER = os.environ.get('PROXMOX_USER', 'root')
PASSWORD = os.environ.get('PROXMOX_PASSWORD')
CID = os.environ.get('LXC_CONTAINER_ID', '115')

key_file = os.path.expanduser('~/.ssh/id_ed25519')
if not PASSWORD and not os.path.exists(key_file):
    print('PROXMOX_PASSWORD not set and ~/.ssh/id_ed25519 not found', file=sys.stderr)
    sys.exit(1)

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import create_ssh_client

ssh = create_ssh_client()
connect_kwargs = {'timeout': 20}
if PASSWORD:
    connect_kwargs['password'] = PASSWORD
elif os.path.exists(key_file):
    connect_kwargs['key_filename'] = key_file
ssh.connect(HOST, username=USER, **connect_kwargs)

def run(label, cmd, timeout=60):
    print(f'\n--- {label} ---')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        print(out)
    if err:
        print('[stderr]', err)
    if rc != 0 and not out:
        print(f'[exit {rc}]')
    return rc, out

try:
    run('container status', f'pct status {CID}')
    run('container resources (allocated)', f'pct config {CID} | grep -E "^(cores|memory|swap|rootfs|hostname|ostype)"')
    run('service status', f'pct exec {CID} -- systemctl is-active smile.service')
    run('service uptime / restart time',
        f'pct exec {CID} -- systemctl show smile.service -p ActiveEnterTimestamp -p ExecMainStartTimestamp')
    run('app directory', f'pct exec {CID} -- bash -c "ls -la /opt/smile | head -25"')
    run('deployed .env presence + which keys (values redacted)',
        f"""pct exec {CID} -- bash -c '
          if [ -f /opt/smile/.env ]; then
            echo "  .env exists; keys present:"
            sed -E "s/=.*/=<redacted>/" /opt/smile/.env | sed "s/^/    /"
          else
            echo "  NO .env at /opt/smile/.env"
          fi
        '""")
    run('migrations applied?', f"""pct exec {CID} -- bash -c '
          PGPASSWORD=$(grep -oP "(?<=^PGPASSWORD=).*" /etc/smile/backup.env 2>/dev/null || true)
          if [ -f /opt/smile/.env ]; then
            export $(grep -E "^(DATABASE_URL)" /opt/smile/.env | xargs)
          fi
          psql -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='"'"'public'"'"' AND tablename='"'"'__drizzle_migrations'"'"'" 2>&1 | head -3
        '""")
    run('backup status: are the new backup units installed?',
        f'pct exec {CID} -- bash -c "systemctl list-timers \'smile-*\' --all --no-pager 2>&1 | head -10"')
    run('rclone present?', f'pct exec {CID} -- bash -c "command -v rclone || echo rclone-not-installed"')
    run('disk space on container',
        f'pct exec {CID} -- bash -c "df -h / /opt 2>/dev/null | head -5"')
    run('node + postgres versions in container',
        f'pct exec {CID} -- bash -c "node -v; pg_dump --version 2>/dev/null || echo no-pg-client"')
finally:
    ssh.close()
    print('\n[inspection complete - nothing was modified]')