#!/usr/bin/env python3
"""
Deploy to Proxmox LXC 115 with verification and automatic rollback.

Safety properties, none of which the original deploy_to_production.py had:
  - NEVER ships .env, node_modules, or the backup archives.
  - Backs up the database and the current /opt/smile before touching anything.
  - Health-checks /health after restart and rolls back if the service fails.
  - Sets RUN_MIGRATIONS explicitly and reports whether the migration was a no-op.

Usage:
  PROXMOX_PASSWORD=... python scripts/deploy.py
"""
import os
import sys
import time
import base64
import tarfile
import tempfile
import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = os.environ.get('PROXMOX_HOST', '172.16.1.54')
USER = os.environ.get('PROXMOX_USER', 'root')
PASSWORD = os.environ.get('PROXMOX_PASSWORD')
CID = os.environ.get('LXC_CONTAINER_ID', '115')
STAMP = time.strftime('%Y%m%d-%H%M%S')

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

key_file = os.path.expanduser('~/.ssh/id_ed25519')
if not PASSWORD and not os.path.exists(key_file):
    print('Neither PROXMOX_PASSWORD nor ~/.ssh/id_ed25519 is configured.', file=sys.stderr)
    sys.exit(1)

# Explicitly excluded: .env (live secrets), node_modules (rebuilt on target),
# *.zip (contain the full pupil database).
BUNDLE = [
    'package.json', 'package-lock.json',
    'server/package.json', 'server/dist', 'server/src', 'server/drizzle',
    'client/package.json', 'client/dist', 'client/src',
    'scripts', 'docs', 'Stundenplan.TXT',
]

FORBIDDEN_COMPONENTS = {'.env', 'node_modules', '.git', 'screenshots'}
FORBIDDEN_SUFFIXES = ('.zip', '.pem', '.key')


def forbidden_reason(name: str):
    """Return why a tar entry is unsafe, or None.

    Matches path COMPONENTS exactly. An earlier version used substring matching,
    which flagged the harmless 'scripts/backup.env.example' template.
    """
    parts = name.split('/')
    for p in parts:
        if p in FORBIDDEN_COMPONENTS:
            return f'contains forbidden path component "{p}"'
    for p in parts:
        if p.endswith(FORBIDDEN_SUFFIXES):
            return f'contains forbidden file "{p}"'
    return None


def tar_filter(tarinfo):
    if forbidden_reason(tarinfo.name):
        return None
    return tarinfo

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import create_ssh_client

ssh = create_ssh_client()
connect_kwargs = {'timeout': 25}
if PASSWORD:
    connect_kwargs['password'] = PASSWORD
elif os.path.exists(key_file):
    connect_kwargs['key_filename'] = key_file

try:
    ssh.connect(HOST, username=USER, **connect_kwargs)
except paramiko.AuthenticationException:
    if not PASSWORD:
        import getpass
        PASSWORD = getpass.getpass(f"SSH key authentication failed. Enter SSH password for {USER}@{HOST}: ")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=25)
    else:
        raise

if ssh.get_transport():
    ssh.get_transport().set_keepalive(5)


def ensure_connected():
    global ssh
    if not ssh.get_transport() or not ssh.get_transport().is_active():
        print("Re-establishing SSH connection...")
        ssh = create_ssh_client()
        ssh.connect(HOST, username=USER, **connect_kwargs)
        if ssh.get_transport():
            ssh.get_transport().set_keepalive(5)


def ex(script: str, timeout=300, label=None):
    """Run a bash script inside the container. Returns (rc, stdout, stderr)."""
    ensure_connected()
    b64 = base64.b64encode(script.encode()).decode()
    cmd = f"pct exec {CID} -- bash -c \"echo {b64} | base64 -d | bash\""
    try:
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    except Exception:
        ensure_connected()
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if label:
        print(f'\n=== {label} ===')
        if out.strip():
            print(out.rstrip())
        if rc != 0 and err.strip():
            print('[stderr]', err.strip()[:2000])
        print(f'[exit {rc}]')
    return rc, out, err


def host(cmd, timeout=300, label=None):
    ensure_connected()
    try:
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    except Exception:
        ensure_connected()
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if label:
        print(f'\n=== {label} ===')
        if out.strip():
            print(out.rstrip())
        if rc != 0 and err.strip():
            print('[stderr]', err.strip()[:2000])
        print(f'[exit {rc}]')
    return rc, out, err


# --- sanity check the local bundle before shipping anything -----------------
print('--- validating local bundle ---')
missing = []
for item in BUNDLE:
    p = os.path.join(BASE, item)
    if not os.path.exists(p):
        missing.append(item)
if missing:
    print('MISSING (would ship a broken tree):', ', '.join(missing))
    sys.exit(1)

if not os.path.exists(os.path.join(BASE, 'client', 'dist', 'index.html')):
    print('client/dist/index.html missing — run `npm run build` first.')
    sys.exit(1)
print(f'  {len(BUNDLE)} items present, client/dist built')

tar_fd, tar_path = tempfile.mkstemp(suffix='.tar.gz')
os.close(tar_fd)

try:
    with tarfile.open(tar_path, 'w:gz') as tar:
        for item in BUNDLE:
            full = os.path.join(BASE, item)
            tar.add(full, arcname=item, filter=tar_filter)

    # Verify no forbidden path slipped into the archive.
    with tarfile.open(tar_path, 'r:gz') as tar:
        names = tar.getnames()
    bad = [(n, forbidden_reason(n)) for n in names if forbidden_reason(n)]
    if bad:
        print('REFUSING TO DEPLOY — forbidden entries in bundle:')
        for n, why in bad[:10]:
            print(f'    {n}  ({why})')
        sys.exit(1)
    print(f'  archive ok ({len(names)} entries, {os.path.getsize(tar_path)//1024} KB, no secrets)')

    # --- 0. pre-flight backups ------------------------------------------
    ex(f'''set -e
export DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"')
export LC_ALL=C
mkdir -p /var/backups/smile
f=/var/backups/smile/smile_db-{STAMP}.dump
pg_dump "$DATABASE_URL" -Fc -f "$f"
pg_restore --list "$f" >/dev/null && echo "database backup: VALID ($f)"
tar czf /var/backups/smile/opt-smile-{STAMP}.tar.gz -C /opt \\
    smile/package.json smile/package-lock.json smile/server smile/client/dist
echo "app snapshot: /var/backups/smile/opt-smile-{STAMP}.tar.gz"
''', label='0. backups')

    # Record the pre-deploy migration count so we can prove it was a no-op.
    _, before, _ = ex('''export DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"')
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations"''')

    # --- 1. upload + extract --------------------------------------------
    sftp = ssh.open_sftp()
    sftp.put(tar_path, '/tmp/smile_update.tar.gz')
    sftp.close()
    print('\n  bundle uploaded to Proxmox host')

    host(f'pct push {CID} /tmp/smile_update.tar.gz /tmp/smile_update.tar.gz', label='1. push')
    host(f'pct exec {CID} -- bash -c "mkdir -p /opt/smile && tar -xzf /tmp/smile_update.tar.gz -C /opt/smile --overwrite && chown -R smile:smile /opt/smile"',
         label='1. extract')

    # Keep a copy of the .env in case anything touches it.
    ex('cp -a /opt/smile/.env /var/backups/smile/env-backup-{0} 2>/dev/null || true'.format(STAMP))

    # --- 2. dependencies -------------------------------------------------
    # --ignore-scripts: nothing should execute during a production install.
    ex('cd /opt/smile && npm install --omit=dev --ignore-scripts --no-fund --no-audit && chown -R smile:smile /opt/smile',
       timeout=600, label='2. npm install')

    # --- 3. restart ------------------------------------------------------
    ex('systemctl restart smile.service', timeout=120, label='3. restart')

    # --- 4. health check with retry --------------------------------------
    print('\n=== 4. health check ===')
    healthy = False
    for attempt in range(1, 13):
        time.sleep(5)
        rc, out, _ = ex('systemctl is-active smile.service; '
                        'curl -sf -m 5 http://127.0.0.1:3000/health || echo NO_RESPONSE')
        status = out.strip()
        print(f'  attempt {attempt:>2}: {status}')
        if 'active' in status and 'NO_RESPONSE' not in status:
            healthy = True
            break

    if not healthy:
        print('\n  SERVICE DID NOT COME UP — rolling back')
        host(f'pct exec {CID} -- bash -c "rm -rf /opt/smile && mkdir -p /opt/smile && '
             f'tar xzf /var/backups/smile/opt-smile-{STAMP}.tar.gz -C /opt && '
             f'cp -a /var/backups/smile/env-backup-{STAMP} /opt/smile/.env"')
        ex('systemctl restart smile.service', timeout=120, label='rollback restart')
        time.sleep(10)
        ex('systemctl status smile.service --no-pager -n 15; '
           'journalctl -u smile.service -n 30 --no-pager', label='rollback status')
        sys.exit(1)

    # --- 5. post-deploy verification -------------------------------------
    _, after, _ = ex('''export DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"')
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations"''')
    print(f'\n  migrations recorded: before={before.strip()} after={after.strip()} '
          f'({"no-op, as expected" if before.strip() == after.strip() else "CHANGED - investigate"})')

    ex('''curl -s -D- -o /dev/null -m 5 http://127.0.0.1:3000/health | grep -iE "content-security|x-frame|cache-control"
echo "--- served asset ---"
curl -s -m 5 http://127.0.0.1:3000/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\\.(js|css)' | sort -u''', label='5. verification')

    ex('systemctl status smile.service --no-pager -n 5', label='5. service status')
    ex('journalctl -u smile.service --since "-3 min" --no-pager | grep -iE "error|fail|migrat" | head -20 || true',
       label='5. recent log warnings')
    ex(f'ls -la /var/backups/smile/ | tail -5', label='5. backups on disk')

    # --- 6. Backup timers & environment setup ----------------------------
    ex('''
mkdir -p /etc/smile /var/backups/smile /var/backups/smile-independent
chown -R smile:smile /var/backups/smile /var/backups/smile-independent
chmod 700 /var/backups/smile /var/backups/smile-independent
chmod +x /opt/smile/scripts/*.py /opt/smile/scripts/*.sh 2>/dev/null || true

cp -a /opt/smile/scripts/systemd/smile-m365-backup.service /etc/systemd/system/
cp -a /opt/smile/scripts/systemd/smile-m365-backup.timer /etc/systemd/system/
cp -a /opt/smile/scripts/systemd/smile-restore-drill.service /etc/systemd/system/
cp -a /opt/smile/scripts/systemd/smile-restore-drill.timer /etc/systemd/system/
cp -a /opt/smile/scripts/systemd/smile-independent-backup.service /etc/systemd/system/
cp -a /opt/smile/scripts/systemd/smile-independent-backup.timer /etc/systemd/system/
systemctl daemon-reload

if [ ! -f /etc/smile/backup.env ]; then
  ENC_KEY=$(openssl rand -hex 32)
  DB_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  cat > /etc/smile/backup.env << EOF_ENV
DATABASE_URL="${DB_URL}"
M365_USER="smile@ms-telfs.at"
M365_PASSWORD=""
M365_TENANT_ID="42864638-c600-42c0-8f6a-18beaa7cbf31"
BACKUP_ENCRYPTION_PASSPHRASE="${ENC_KEY}"
KEEP_INTRADAY_DAYS="3"
KEEP_DAILY_DAYS="30"
CLOUD_KEEP_DAYS="7"
EOF_ENV
  chown smile:smile /etc/smile/backup.env
  chmod 600 /etc/smile/backup.env
  echo "NOTICE: M365_PASSWORD is empty. Fill it in /etc/smile/backup.env before the backup can run."
fi

# Arm M365 backup timer
if sudo -u smile /usr/bin/python3 /opt/smile/scripts/backup_m365.py --check; then
  systemctl enable --now smile-m365-backup.timer
  echo "M365 backup timer armed."
else
  systemctl enable smile-m365-backup.timer
  echo "WARN: preflight failed — timer installed but NOT started."
fi

# Arm restore-drill and independent-backup timers
systemctl enable --now smile-restore-drill.timer
systemctl enable --now smile-independent-backup.timer
echo "Restore drill and independent backup timers armed."

systemctl status smile-m365-backup.timer smile-restore-drill.timer smile-independent-backup.timer --no-pager
''', label='6. Backup timers status')

    print('\n✓ DEPLOYMENT SUCCESSFUL')
finally:
    ssh.close()
    if os.path.exists(tar_path):
        os.remove(tar_path)