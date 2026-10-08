#!/usr/bin/env python3
"""
Run docs/PREFLIGHT-admin-actor.sql against LXC 115 database.
Read-only inspection: changes nothing.
"""
import os
import sys
import base64

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

try:
    sql_path = os.path.join(os.path.dirname(__file__), '..', 'docs', 'PREFLIGHT-admin-actor.sql')
    with open(sql_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()

    script = f"""set -e
export DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"')
export PGCONNECT_TIMEOUT=5
export LC_ALL=C
psql "$DATABASE_URL" << 'SQL_PREFLIGHT_EOF'
{sql_content}
SQL_PREFLIGHT_EOF
"""
    b64 = base64.b64encode(script.encode('utf-8')).decode('ascii')
    cmd = f'pct exec {CID} -- bash -c "echo {b64} | base64 -d | bash"'
    
    print('=== Executing PREFLIGHT-admin-actor.sql on LXC 115 ===\n')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=60)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    
    if out.strip():
        print(out.strip())
    if rc != 0 and err.strip():
        print('[stderr]', err.strip())
    print(f'\n[preflight exit code: {rc}]')

finally:
    ssh.close()
