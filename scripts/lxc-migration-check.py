#!/usr/bin/env python3
"""Determine precisely whether migrations have been applied, and whether
re-running the migration would be a no-op or would fail."""
import os, sys, paramiko
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

def run(label, inner, timeout=180):
    print(f'\n=== {label} ===')
    cmd = f'pct exec {CID} -- bash -c ' + repr(inner).replace('"', '\\"')
    # build with a heredoc to avoid quoting hell
    script = f"""set -e
export DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"')
export PGCONNECT_TIMEOUT=5
export LC_ALL=C
{inner}
"""
    b64 = __import__('base64').b64encode(script.encode()).decode()
    cmd = f"pct exec {CID} -- bash -c \"echo {b64} | base64 -d | bash\""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print(out.strip())
    if rc != 0 and err.strip():
        print('[stderr]', err.strip()[:1500])
    print(f'[exit {rc}]')

try:
    run('A. find ANY drizzle migration table, in any schema',
        '''psql "$DATABASE_URL" -tAc "
          SELECT table_schema||'.'||table_name FROM information_schema.tables
           WHERE table_name LIKE '%drizzle%' OR table_name LIKE '%migration%'
           ORDER BY 1" 2>&1''')

    run('B. count tables in public (expected 17 after migration)',
        '''psql "$DATABASE_URL" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>&1''')

    run('C. the four new unique indexes from the migration',
        '''psql "$DATABASE_URL" -tAc "
          SELECT indexname FROM pg_indexes
           WHERE schemaname='public' AND indexname IN (
             'evaluations_round_pupil_class_subject_uidx',
             'evaluation_items_evaluation_item_uidx',
             'final_ranks_round_pupil_uidx',
             'timeout_escalations_pupil_milestone_uidx')
           ORDER BY 1" 2>&1''')

    run('D. columns that only the new schema defines',
        '''psql "$DATABASE_URL" -tAc "
          SELECT table_name||'.'||column_name FROM information_schema.columns
           WHERE table_schema='public' AND (
             (table_name='users'    AND column_name='must_change_password') OR
             (table_name='evaluations' AND column_name='is_submitted')    OR
             (table_name='final_ranks'  AND column_name='votes_yes'))
           ORDER BY 1" 2>&1''')

    run('E. RUN_MIGRATIONS value in .env (decides if migrate() runs on boot)',
        '''grep -E '^RUN_MIGRATIONS=' /opt/smile/.env || echo "RUN_MIGRATIONS not set -> defaults to running migrations"''')

    run('F. is the container running as root? (file ownership check)',
        '''ls -ld /opt/smile; id -un''')
finally:
    ssh.close(); print('\n[done]')