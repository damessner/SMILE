#!/usr/bin/env python3
"""
Deploy SMILE to Proxmox LXC 115 (host 172.16.1.54) using a release layout.

Remote layout (created by the one-time migration step 1, or by install-lxc.sh on a fresh host):
  /opt/smile                      -> /opt/smile-releases/<stamp>   (symlink = live release)
  /opt/smile-releases/<stamp>/    code + node_modules + VERSION (immutable per release)
  /opt/smile-releases/<stamp>/.env -> /opt/smile-shared/.env       (the only mutable config)
  /opt/smile-shared/.env          secrets, mode 600, owner smile  (outside all releases)
  /var/backups/smile              DB dumps, app snapshots, env copies (outside releases)

Flow:
  local bundle -> pre-flight backups -> one-time layout migration (only if /opt/smile
  is a plain directory) -> upload + extract into a new release -> npm install --omit=dev
  inside the release -> atomic symlink switch -> restart smile.service -> /health check
  -> keep the newest 5 releases.

Failure semantics: any failure BEFORE the symlink switch leaves the live release untouched.
A failure AFTER the switch repoints /opt/smile to the previous release and restarts it.

Bundle: git-tracked files under BUNDLE_TRACKED, plus the built client/dist and server/dist.
Untracked files are never shipped. A dirty tracked tree is refused unless --allow-dirty.
The archive is validated fail-closed (forbidden names, symlinks, required files).

Usage:
  python scripts/deploy.py --dry-run        # local only: build + validate, no SSH
  PROXMOX_PASSWORD=... python scripts/deploy.py
  python scripts/deploy.py --allow-dirty    # ships working-tree content of tracked files
"""
import argparse
import base64
import datetime as dt
import io
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = os.environ.get('PROXMOX_HOST', '172.16.1.54')
USER = os.environ.get('PROXMOX_USER', 'root')
CID = os.environ.get('LXC_CONTAINER_ID', '115')
HEALTH_URL = 'http://127.0.0.1:3000/health'

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

LIVE = '/opt/smile'
RELEASES = '/opt/smile-releases'
SHARED_ENV = '/opt/smile-shared/.env'
KEEP_RELEASES = 5
PREV_RE = re.compile(r'^/opt/smile-releases/\d{8}-\d{6}(-legacy)?$')

# Git-tracked paths that ship. Built output is added from disk (it is gitignored).
BUNDLE_TRACKED = [
    'package.json', 'package-lock.json',
    'server/package.json', 'server/src', 'server/drizzle',
    'client/package.json', 'client/src',
    'scripts', 'docs',
]
BUNDLE_BUILT = ['client/dist', 'server/dist']

# Tracked files that are deliberately not shipped. Keep this list short and explicit.
SHIP_EXCLUDE = {
    'docs/PREFLIGHT-admin-actor.sql': 'operator-run SQL, not needed at runtime (*.sql is forbidden)',
}

REQUIRED_IN_BUNDLE = [
    'VERSION', 'package.json', 'package-lock.json',
    'server/package.json', 'client/package.json',
    'server/dist/index.js', 'client/dist/index.html',
    'server/drizzle/meta/_journal.json',
]

# Fail-closed deny list for the final archive. Matching is by path component / file suffix.
FORBIDDEN_COMPONENTS = {
    '.git', 'node_modules', 'screenshots', 'export', 'tools', 'UntisPlus-main',
    '.pi', '.superpowers', '.freebuff', '.worktrees',
}
FORBIDDEN_FILE_SUFFIXES = (
    '.zip', '.pem', '.key', '.txt', '.docx', '.csv', '.tsv', '.xlsx', '.xls',
    '.dump', '.sql.gz', '.ps1',
)
# Drizzle migrations are runtime code (server/src/index.ts reads server/drizzle).
# Every other *.sql is refused.
SQL_ALLOWED = re.compile(r'^server/drizzle/[^/]+\.sql$')


class DeployError(Exception):
    pass


def forbidden_reason(name):
    """Return why an archive entry must not ship, or None. Fail closed."""
    parts = name.split('/')
    for p in parts:
        if p in FORBIDDEN_COMPONENTS:
            return f'forbidden path component "{p}"'
        if p.lower().startswith('.env'):
            return f'environment file "{p}"'
    base = parts[-1].lower()
    if base.endswith('.sql'):
        return None if SQL_ALLOWED.match(name) else 'SQL file outside server/drizzle migrations'
    for suffix in FORBIDDEN_FILE_SUFFIXES:
        if base.endswith(suffix):
            return f'forbidden file type "{suffix}"'
    return None


# --- local: git + bundle ------------------------------------------------------

def git(*args):
    proc = subprocess.run(['git', '-C', BASE, *args], capture_output=True,
                          text=True, encoding='utf-8', errors='replace')
    if proc.returncode != 0:
        raise DeployError(f'git {args[0]} failed: {proc.stderr.strip()}')
    return proc.stdout


def git_state():
    sha = git('rev-parse', 'HEAD').strip()
    branch = git('rev-parse', '--abbrev-ref', 'HEAD').strip()
    dirty = [l for l in git('status', '--porcelain', '--untracked-files=no').splitlines() if l.strip()]
    return sha, branch, dirty


def collect_bundle():
    """Return (sorted relative paths to ship, list of (path, reason) excluded)."""
    files, excluded = [], []
    tracked = [p for p in git('ls-files', '-z', '--', *BUNDLE_TRACKED).split('\0') if p]
    for rel in tracked:
        if rel in SHIP_EXCLUDE:
            excluded.append((rel, SHIP_EXCLUDE[rel]))
            continue
        full = os.path.join(BASE, *rel.split('/'))
        if os.path.islink(full) or not os.path.isfile(full):
            raise DeployError(f'tracked path missing or not a regular file: {rel}')
        files.append(rel)
    for built in BUNDLE_BUILT:
        root_dir = os.path.join(BASE, *built.split('/'))
        if not os.path.isdir(root_dir):
            raise DeployError(f'{built} is missing - run `npm run build` first')
        for root, _dirs, names in os.walk(root_dir):
            for name in names:
                full = os.path.join(root, name)
                if os.path.islink(full):
                    raise DeployError(f'symlink inside build output refused: {full}')
                files.append(os.path.relpath(full, BASE).replace(os.sep, '/'))
    for req in ('client/dist/index.html', 'server/dist/index.js'):
        if req not in files:
            raise DeployError(f'required build output missing: {req} - run `npm run build` first')
    return sorted(set(files)), excluded


def version_text(sha, branch, stamp, dirty):
    built = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    flag = 'true' if dirty else 'false'
    return f'sha={sha}\nbranch={branch}\nbuilt_utc={built}\nstamp={stamp}\ndirty={flag}\n'


def build_archive(files, version):
    fd, tar_path = tempfile.mkstemp(suffix='.tar.gz', prefix='smile-bundle-')
    os.close(fd)
    try:
        with tarfile.open(tar_path, 'w:gz') as tar:
            for rel in files:
                tar.add(os.path.join(BASE, *rel.split('/')), arcname=rel, recursive=False)
            data = version.encode('utf-8')
            info = tarfile.TarInfo('VERSION')
            info.size = len(data)
            info.mtime = int(time.time())
            tar.addfile(info, io.BytesIO(data))
    except Exception:
        os.remove(tar_path)
        raise
    return tar_path


def verify_archive(tar_path, files):
    """Return a list of problems. Empty list means the archive is safe to ship."""
    with tarfile.open(tar_path, 'r:gz') as tar:
        members = tar.getmembers()
    names = [m.name for m in members]
    problems = []
    for m in members:
        if not (m.isfile() or m.isdir()):
            problems.append(f'{m.name}  (not a regular file or directory)')
    if len(set(names)) != len(names):
        problems.append('archive contains duplicate entries')
    for n in names:
        reason = forbidden_reason(n)
        if reason:
            problems.append(f'{n}  ({reason})')
    for req in REQUIRED_IN_BUNDLE:
        if req not in names:
            problems.append(f'required entry missing: {req}')
    expected = set(files) | {'VERSION'}
    extra = sorted(set(names) - expected)
    if extra:
        problems.append(f'unexpected entries not in the planned file list: {extra[:5]}')
    return names, problems


# --- remote: bash templates (placeholders replaced, never f-strings) ----------

BACKUP_SH = r'''set -euo pipefail
export LC_ALL=C
STAMP='__STAMP__'
mkdir -p /var/backups/smile && chmod 700 /var/backups/smile
DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile/.env | cut -d= -f2- | tr -d '"')
f=/var/backups/smile/smile_db-$STAMP.dump
pg_dump "$DATABASE_URL" -Fc -f "$f"
pg_restore --list "$f" >/dev/null && echo "database backup: VALID ($f)"
tar czf /var/backups/smile/opt-smile-$STAMP.tar.gz -C /opt/smile --exclude=node_modules --exclude=.env .
echo "app snapshot: /var/backups/smile/opt-smile-$STAMP.tar.gz"
cp -a /opt/smile/.env /var/backups/smile/env-backup-$STAMP
chmod 600 /var/backups/smile/env-backup-$STAMP
echo "env copy: /var/backups/smile/env-backup-$STAMP"
'''

# One-time migration. Idempotent: a no-op once /opt/smile is a symlink.
# Never deletes: the legacy tree is RENAMED to <stamp>-legacy (a valid release for rollback),
# and its .env is copied to shared and to /var/backups (a copy is kept in backups).
MIGRATE_SH = r'''set -euo pipefail
STAMP='__STAMP__'
LEG=""
mkdir -p /opt/smile-releases /opt/smile-shared /var/backups/smile
chmod 700 /var/backups/smile
if [ -L /opt/smile ]; then
  echo "layout: already migrated, /opt/smile -> $(readlink /opt/smile)"
  test -f /opt/smile-shared/.env || { echo "ABORT: /opt/smile-shared/.env is missing"; exit 1; }
  exit 0
fi
if [ ! -d /opt/smile ]; then
  echo "ABORT: /opt/smile is neither a directory nor a symlink (use install-lxc.sh)"; exit 1
fi
test -f /opt/smile/.env || { echo "ABORT: legacy /opt/smile/.env is missing; refusing to migrate"; exit 1; }
if [ -e /opt/smile-shared/.env ]; then
  cmp -s /opt/smile/.env /opt/smile-shared/.env || { echo "ABORT: /opt/smile-shared/.env differs from legacy .env; resolve manually"; exit 1; }
else
  cp -a /opt/smile/.env /opt/smile-shared/.env
fi
chown smile:smile /opt/smile-shared/.env
chmod 600 /opt/smile-shared/.env
LEG="/opt/smile-releases/${STAMP}-legacy"
if [ -e "$LEG" ]; then echo "ABORT: $LEG already exists"; exit 1; fi

rollback_rename() {
  if [ -n "$LEG" ] && [ -d "$LEG" ] && [ ! -e /opt/smile ]; then
    mv "$LEG" /opt/smile && echo "ROLLED BACK migration rename: /opt/smile restored"
  fi
}
trap rollback_rename ERR

cp -a /opt/smile/.env "/var/backups/smile/env-premigration-$STAMP"
mv /opt/smile "$LEG"
ln -s /opt/smile-shared/.env "$LEG/.env.link-tmp"
mv -f "$LEG/.env.link-tmp" "$LEG/.env"
ln -sfn "$LEG" /opt/.smile-migrate-tmp
mv -T /opt/.smile-migrate-tmp /opt/smile
trap - ERR
echo "migrated: /opt/smile -> $(readlink /opt/smile)"
echo "legacy tree kept at $LEG; .env copy at /var/backups/smile/env-premigration-$STAMP"
'''

EXTRACT_SH = r'''set -euo pipefail
STAMP='__STAMP__'
REL=/opt/smile-releases/$STAMP
INC=/opt/smile-releases/.incoming-$STAMP
TARBALL=/tmp/smile_update-$STAMP.tar.gz
if [ -e "$REL" ]; then echo "ABORT: $REL already exists"; exit 1; fi
rm -rf "$INC"; mkdir -p "$INC"
tar -xzf "$TARBALL" -C "$INC" --no-same-owner
rm -f "$TARBALL"
for f in VERSION package.json package-lock.json server/package.json client/package.json server/dist/index.js client/dist/index.html server/drizzle/meta/_journal.json; do
  if [ ! -f "$INC/$f" ]; then echo "ABORT: bundle is missing $f"; rm -rf "$INC"; exit 1; fi
done
if [ -e "$INC/.env" ] || [ -L "$INC/.env" ]; then echo "ABORT: bundle contains .env"; rm -rf "$INC"; exit 1; fi
ln -s /opt/smile-shared/.env "$INC/.env"
mv "$INC" "$REL"
echo "--- release $REL ---"
cat "$REL/VERSION"
'''

NPM_SH = r'''set -euo pipefail
cd /opt/smile-releases/__STAMP__
npm install --omit=dev --ignore-scripts --no-fund --no-audit
chown -R smile:smile /opt/smile-releases/__STAMP__
echo "dependencies installed in /opt/smile-releases/__STAMP__"
'''

# Atomic switch: create the new symlink under a temp name, then rename() it over /opt/smile.
SWITCH_SH = r'''set -euo pipefail
ln -sfn /opt/smile-releases/__STAMP__ /opt/.smile-next
mv -T /opt/.smile-next /opt/smile
echo "live: /opt/smile -> $(readlink /opt/smile)"
systemctl restart smile.service
'''

ROLLBACK_SH = r'''set -euo pipefail
ln -sfn __PREV__ /opt/.smile-next
mv -T /opt/.smile-next /opt/smile
echo "rolled back: /opt/smile -> $(readlink /opt/smile)"
systemctl restart smile.service
'''

COUNT_SH = r'''export DATABASE_URL=$(grep -E '^DATABASE_URL=' /opt/smile-shared/.env | cut -d= -f2- | tr -d '"')
psql "$DATABASE_URL" -tAc "SELECT count(*) FROM drizzle.__drizzle_migrations" 2>/dev/null || echo 0
'''

VERIFY_SH = r'''curl -s -D- -o /dev/null -m 5 http://127.0.0.1:3000/health | grep -iE "content-security|x-frame|cache-control" || true
echo "--- served asset ---"
curl -s -m 5 http://127.0.0.1:3000/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.(js|css)' | sort -u || true
'''

PRUNE_SH = r'''cd /opt/smile-releases || exit 0
CUR=$(readlink -f /opt/smile || true)
n=0
for d in $(ls -1 | grep -E '^[0-9]{8}-[0-9]{6}(-legacy)?$' | sort -r); do
  n=$((n+1))
  p="/opt/smile-releases/$d"
  if [ "$n" -le __KEEP__ ] || [ "$p" = "$CUR" ]; then
    echo "keep  $d"
  else
    echo "prune $d"
    rm -rf -- "$p"
  fi
done
'''

TIMERS_SH = r'''mkdir -p /etc/smile /var/backups/smile /var/backups/smile-independent
chown -R smile:smile /var/backups/smile /var/backups/smile-independent
chmod 700 /var/backups/smile /var/backups/smile-independent
chmod +x /opt/smile/scripts/*.py /opt/smile/scripts/*.sh 2>/dev/null || true

for unit in smile-m365-backup smile-restore-drill smile-independent-backup; do
  cp -a /opt/smile/scripts/systemd/$unit.service /etc/systemd/system/
  cp -a /opt/smile/scripts/systemd/$unit.timer /etc/systemd/system/
done
systemctl daemon-reload

if [ ! -f /etc/smile/backup.env ]; then
  ENC_KEY=$(openssl rand -hex 32)
  DB_URL=$(grep -E '^DATABASE_URL=' /opt/smile-shared/.env | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
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

if sudo -u smile /usr/bin/python3 /opt/smile/scripts/backup_m365.py --check; then
  systemctl enable --now smile-m365-backup.timer
  echo "M365 backup timer armed."
else
  systemctl enable smile-m365-backup.timer
  echo "WARN: preflight failed - timer installed but NOT started."
fi
systemctl enable --now smile-restore-drill.timer
systemctl enable --now smile-independent-backup.timer
echo "Restore drill and independent backup timers armed."
systemctl status smile-m365-backup.timer smile-restore-drill.timer smile-independent-backup.timer --no-pager || true
'''


def render(template, **values):
    out = template
    for key, value in values.items():
        out = out.replace(f'__{key}__', str(value))
    return out


# --- remote transport ---------------------------------------------------------

def _ssh_factory():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from ssh_utils import create_ssh_client
    return create_ssh_client()


class Remote:
    def __init__(self):
        self.ssh = None
        self.kwargs = {}
        self.password = os.environ.get('PROXMOX_PASSWORD')

    def connect(self):
        import paramiko
        key_file = os.path.expanduser('~/.ssh/id_ed25519')
        if not self.password and not os.path.exists(key_file):
            raise DeployError('Neither PROXMOX_PASSWORD nor ~/.ssh/id_ed25519 is configured.')
        self.kwargs = {'timeout': 25}
        if self.password:
            self.kwargs['password'] = self.password
        elif os.path.exists(key_file):
            self.kwargs['key_filename'] = key_file
        self.ssh = _ssh_factory()
        try:
            self.ssh.connect(HOST, username=USER, **self.kwargs)
        except paramiko.AuthenticationException:
            if self.password:
                raise
            import getpass
            self.password = getpass.getpass(f'SSH key authentication failed. Enter SSH password for {USER}@{HOST}: ')
            self.kwargs = {'timeout': 25, 'password': self.password}
            self.ssh = _ssh_factory()
            self.ssh.connect(HOST, username=USER, **self.kwargs)
        self._keepalive()

    def _keepalive(self):
        if self.ssh.get_transport():
            self.ssh.get_transport().set_keepalive(5)

    def _ensure(self):
        transport = self.ssh.get_transport() if self.ssh else None
        if not transport or not transport.is_active():
            print('Re-establishing SSH connection...')
            self.ssh = _ssh_factory()
            self.ssh.connect(HOST, username=USER, **self.kwargs)
            self._keepalive()

    def _exec(self, cmd, timeout):
        self._ensure()
        try:
            _, stdout, stderr = self.ssh.exec_command(cmd, timeout=timeout)
        except Exception:
            self._ensure()
            _, stdout, stderr = self.ssh.exec_command(cmd, timeout=timeout)
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        rc = stdout.channel.recv_exit_status()
        return rc, out, err

    def run(self, cmd, timeout=300, label=None, check=True):
        rc, out, err = self._exec(cmd, timeout)
        if label:
            print(f'\n=== {label} ===')
            if out.strip():
                print(out.rstrip())
            if rc != 0 and err.strip():
                print('[stderr]', err.strip()[:2000])
            print(f'[exit {rc}]')
        if check and rc != 0:
            raise DeployError(f'{label or cmd[:60]} failed (exit {rc})')
        return rc, out, err

    def ex(self, script, timeout=300, label=None, check=True):
        """Run a bash script inside the container (pct exec)."""
        b64 = base64.b64encode(script.encode()).decode()
        return self.run(f'pct exec {CID} -- bash -c "echo {b64} | base64 -d | bash"',
                        timeout=timeout, label=label, check=check)

    def host(self, cmd, timeout=300, label=None, check=True):
        return self.run(cmd, timeout=timeout, label=label, check=check)

    def close(self):
        if self.ssh:
            self.ssh.close()


def wait_healthy(remote, attempts=12):
    for attempt in range(1, attempts + 1):
        time.sleep(5)
        _, out, _ = remote.ex('systemctl is-active smile.service; '
                              f'curl -sf -m 5 {HEALTH_URL} || echo NO_RESPONSE',
                              timeout=60, check=False)
        lines = out.strip().splitlines()
        ok = bool(lines) and lines[0].strip() == 'active' and '"status":"ok"' in out
        print(f'  attempt {attempt:>2}: {out.strip()[:120]!r}')
        if ok:
            return True
    return False


def rollback(remote, prev):
    if not PREV_RE.match(prev or ''):
        print(f'!! no valid previous release recorded ({prev!r}); manual intervention required')
        return False
    remote.ex(render(ROLLBACK_SH, PREV=prev), timeout=120, label='rollback: repoint + restart', check=False)
    ok = wait_healthy(remote)
    print('rollback: service HEALTHY on previous release' if ok else
          '!! rollback: service still NOT healthy - investigate immediately')
    return ok


def deploy(bundle_path, stamp, sha, branch, dirty):
    remote = Remote()
    tmp_host = f'/tmp/smile_update-{stamp}.tar.gz'
    try:
        remote.connect()

        remote.ex(render(BACKUP_SH, STAMP=stamp), timeout=900, label='0. pre-flight backups')
        remote.ex(render(MIGRATE_SH, STAMP=stamp), timeout=300,
                  label='1. layout check (one-time migration if /opt/smile is a plain dir)')
        _, before, _ = remote.ex(COUNT_SH, check=False, label=None)

        sftp = remote.ssh.open_sftp()
        sftp.put(bundle_path, tmp_host)
        sftp.close()
        print('\n  bundle uploaded to Proxmox host')
        remote.host(f'pct push {CID} {tmp_host} {tmp_host}', label='2. push bundle into container')
        remote.ex(render(EXTRACT_SH, STAMP=stamp), label='2. extract into new release')
        remote.ex(render(NPM_SH, STAMP=stamp), timeout=900, label='3. npm install --omit=dev (in release)')

        _, prev_out, _ = remote.ex('readlink /opt/smile 2>/dev/null || echo NONE',
                                   label='4. current live release (rollback target)')
        prev = prev_out.strip()

        # ---- point of no return: from here, failures roll back -------------
        try:
            remote.ex(render(SWITCH_SH, STAMP=stamp), label='5. atomic switch + restart smile.service')
            print('\n=== 5. health check (/health) ===')
            if not wait_healthy(remote):
                raise DeployError('smile.service did not pass /health')
        except DeployError as exc:
            print(f'\n!! {exc} - rolling back to {prev}')
            healthy = rollback(remote, prev)
            raise DeployError(f'deploy failed and was rolled back (previous release healthy: {healthy})')

        _, after, _ = remote.ex(COUNT_SH, check=False, label=None)
        print(f'\n  migrations recorded: before={before.strip()} after={after.strip()} '
              f'({"no-op, as expected" if before.strip() == after.strip() else "CHANGED - investigate"})')

        remote.ex(VERIFY_SH, check=False, label='6. verification')
        remote.ex(render(PRUNE_SH, KEEP=KEEP_RELEASES), check=False,
                  label=f'7. retention (keep newest {KEEP_RELEASES} releases + live)')
        remote.ex('systemctl status smile.service --no-pager -n 5', check=False, label='8. service status')
        remote.ex('journalctl -u smile.service --since "-3 min" --no-pager | grep -iE "error|fail|migrat" | head -20 || true',
                  check=False, label='8. recent log warnings')
        remote.ex(render(TIMERS_SH), timeout=600, check=False, label='9. backup timers')

        print(f'\n✓ DEPLOYMENT SUCCESSFUL  release={stamp}  sha={sha}  branch={branch}'
              + ('  (DIRTY: --allow-dirty)' if dirty else ''))
    finally:
        if remote.ssh is not None:
            try:
                remote.host(f'rm -f {tmp_host}', check=False)
            except Exception:
                pass
            remote.close()


def parse_args(argv):
    parser = argparse.ArgumentParser(description='Deploy SMILE to LXC 115 (release layout).')
    parser.add_argument('--dry-run', action='store_true',
                        help='build and validate the bundle locally; print the file list; do not connect')
    parser.add_argument('--allow-dirty', action='store_true',
                        help='allow uncommitted changes to tracked files (ships working-tree content)')
    return parser.parse_args(argv)


def main(argv):
    args = parse_args(argv)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')

    print('--- SMILE deploy ---')
    print(f'target : Proxmox {HOST} / LXC {CID} / {LIVE} (releases: {RELEASES})')
    sha, branch, dirty = git_state()
    print(f'git    : branch={branch} sha={sha}')
    if dirty:
        print(f'working tree: DIRTY ({len(dirty)} tracked path(s) with uncommitted changes):')
        for line in dirty[:30]:
            print(f'    {line}')
        if not args.allow_dirty:
            print('REFUSING: commit or stash tracked changes first, or re-run with --allow-dirty.')
            return 1
        print('  --allow-dirty given: shipping working-tree content; VERSION will say dirty=true')
    else:
        print('working tree: clean (tracked files match HEAD)')

    files, excluded = collect_bundle()
    for rel, reason in excluded:
        print(f'  excluded tracked file: {rel}  ({reason})')
    print(f'  {len(files)} files planned (tracked bundle + client/dist + server/dist)')

    version = version_text(sha, branch, stamp, bool(dirty))
    tar_path = build_archive(files, version)
    try:
        names, problems = verify_archive(tar_path, files)
        print('\n--- archive validation (fail-closed) ---')
        print(f'  entries: {len(names)}  size: {os.path.getsize(tar_path) // 1024} KB')
        if problems:
            print('REFUSING TO DEPLOY - archive failed validation:')
            for p in problems[:30]:
                print(f'    {p}')
            return 1
        print('  forbidden-check: PASSED (no .env*, *.TXT, *.docx, *.csv, *.sql outside server/drizzle, '
              'export/, tools/, node_modules, .git, *.ps1, credentials, ...)')
        print('  required entries: present; symlinks: none')

        print('\n--- VERSION (bundle) ---')
        print(version.rstrip())

        print('\n--- file list ---')
        for name in names:
            print(f'  {name}')

        if args.dry_run:
            print('\nDRY RUN: archive validated; nothing was sent to Proxmox. Temp archive removed.')
            return 0

        deploy(tar_path, stamp, sha, branch, bool(dirty))
        return 0
    finally:
        if os.path.exists(tar_path):
            os.remove(tar_path)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except DeployError as exc:
        print(f'\nDEPLOY ABORTED: {exc}', file=sys.stderr)
        sys.exit(1)
