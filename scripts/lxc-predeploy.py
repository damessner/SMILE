#!/usr/bin/env python3
"""
Pre-deploy verification + backup for LXC 115.

Steps (in order):
  1. Read migration state from the live database
  2. Check whether the container can reach npm (deploy runs `npm install`)
  3. Take a verified pg_dump of smile_db OUTSIDE /opt/smile
  4. Snapshot the current /opt/smile so a rollback is possible
Nothing is changed beyond creating backups.
"""
import os
import sys
import time
import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = os.environ.get('PROXMOX_HOST', '172.16.1.54')
USER = os.environ.get('PROXMOX_USER', 'root')
PASSWORD = os.environ.get('PROXMOX_PASSWORD')
CID = os.environ.get('LXC_CONTAINER_ID', '115')
STAMP = time.strftime('%Y%m%d-%H%M%S')

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

def run(label, cmd, timeout=180):
    print(f'\n=== {label} ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if out:
        print(out)
    if err:
        print('[stderr]', err[:2000])
    print(f'[exit {rc}]')
    return rc, out

# Helper injected into the container: load DATABASE_URL from .env
ENV = """export $(grep -E '^(DATABASE_URL|PGPASSWORD)=' /opt/smile/.env | sed 's/^/export /' | sed 's/export export/export/' | xargs -0 2>/dev/null) 2>/dev/null; \
DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"') ; export DATABASE_URL ;"""

try:
    run('1. migration state',
        f"""pct exec {CID} -- bash -c '
          export PGCONNECT_TIMEOUT=5
          export DATABASE_URL=$(grep -E "^DATABASE_URL=" /opt/smile/.env | cut -d= -f2- | tr -d "\\"")
          if [ -z "$DATABASE_URL" ]; then echo "cannot read DATABASE_URL"; exit 1; fi
          psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='"'"'public'"'"' AND tablename='"'"'__drizzle_migrations'"'"'" 2>&1 | tail -1
          echo "--- applied migrations ---"
          psql "$DATABASE_URL" -tAc "SELECT name, created_at FROM __drizzle_migrations ORDER BY id" 2>&1 | tail -5
        '""")

    run('2. migration files shipped locally',
        f'pct exec {CID} -- bash -c "ls -la /opt/smile/server/drizzle/ 2>&1 | head"')

    run('3. npm registry reachable from container? (deploy runs npm install)',
        f"""pct exec {CID} -- bash -c '
          timeout 20 npm ping 2>&1 | tail -3
          echo "curl-exit=$(timeout 15 curl -sS -o /dev/null -w "%{{http_code}}" https://registry.npmjs.org/ 2>&1)"
        '""")

    run('4. duplicate check for the new UNIQUE indexes (blocks migration if violated)',
        f"""pct exec {CID} -- bash -c '
          export DATABASE_URL=$(grep -E "^DATABASE_URL=" /opt/smile/.env | cut -d= -f2- | tr -d "\\"")
          psql "$DATABASE_URL" -tA -F"|" 2>&1 <<'"'"'SQL'"'"'
SELECT '"'"'evaluations_dup'"'"'::text, count(*) FROM (SELECT 1 FROM evaluations GROUP BY round_id,pupil_id,class_id,subject_code HAVING count(*)>1) t
UNION ALL SELECT '"'"'eval_items_dup'"'"', count(*) FROM (SELECT 1 FROM evaluation_items GROUP BY evaluation_id,item_key HAVING count(*)>1) t
UNION ALL SELECT '"'"'final_ranks_dup'"'"', count(*) FROM (SELECT 1 FROM final_ranks GROUP BY round_id,pupil_id HAVING count(*)>1) t
UNION ALL SELECT '"'"'escalations_dup'"'"', count(*) FROM (SELECT 1 FROM timeout_escalations GROUP BY pupil_id,milestone_count HAVING count(*)>1) t;
SQL
        '""")

    # --- Backups -------------------------------------------------------
    run('5. take pg_dump backup',
        f"""pct exec {CID} -- bash -c '
          set -e
          export DATABASE_URL=$(grep -E "^DATABASE_URL=" /opt/smile/.env | cut -d= -f2- | tr -d "\\"")
          mkdir -p /var/backups/smile
          f=/var/backups/smile/smile_db-{STAMP}.dump
          pg_dump "$DATABASE_URL" -Fc -f "$f"
          pg_restore --list "$f" > /dev/null && echo "  dump VALID"
          ls -la "$f"
        '""")

    run('6. snapshot /opt/smile for rollback',
        f"""pct exec {CID} -- bash -c '
          mkdir -p /var/backups/smile
          tar czf /var/backups/smile/opt-smile-{STAMP}.tar.gz \\
            -C /opt smile/package.json smile/package-lock.json smile/server smile/client/dist 2>/dev/null
          ls -la /var/backups/smile/
        '""")

finally:
    ssh.close()
    print('\n[pre-deploy verification and backup complete]')