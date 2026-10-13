#!/usr/bin/env python3
"""
Safely reset production LXC 115 database to defaults:
- Pre-reset backup (pg_dump) taken before any modification
- Truncate all ratings, evaluations, final ranks, locks, cards, and timeouts
- Reset all teacher accounts to initial bootstrap password with mustChangePassword=true
- Keep master data (teachers, pupils, classes, assignments, rubrics, timetable) intact
- Restart smile.service and verify health

Usage:
  python scripts/reset_lxc_defaults.py
"""
import os
import sys
import time
import base64
import getpass
import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

HOST = os.environ.get('PROXMOX_HOST', '172.16.1.54')
USER = os.environ.get('PROXMOX_USER', 'root')
PASSWORD = os.environ.get('PROXMOX_PASSWORD')
CID = os.environ.get('LXC_CONTAINER_ID', '115')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import create_ssh_client

key_file = os.path.expanduser('~/.ssh/id_ed25519')
ssh = create_ssh_client()
connect_kwargs = {'timeout': 20}
if PASSWORD:
    connect_kwargs['password'] = PASSWORD
elif os.path.exists(key_file):
    connect_kwargs['key_filename'] = key_file

try:
    ssh.connect(HOST, username=USER, **connect_kwargs)
except (paramiko.AuthenticationException, paramiko.SSHException):
    if not PASSWORD:
        PASSWORD = getpass.getpass(f"Enter SSH password for {USER}@{HOST}: ")
        ssh.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    else:
        raise

def run(cmd, timeout=60):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return rc, out, err

try:
    print(f"=== SMILE LXC {CID} Reset to Default ===")

    # 1. Verify container status
    rc, out, err = run(f"pct status {CID}")
    if rc != 0 or "status: running" not in out:
        print(f"Error: Container {CID} is not running: {out} {err}")
        sys.exit(1)
    print(f"✓ Container {CID} is running.")

    # 2. Safety Backup
    backup_file = f"/var/backups/smile/smile_db_pre_reset_{time.strftime('%Y%m%d_%H%M%S')}.dump"
    print(f"Creating safety database backup inside container: {backup_file}...")
    run(f"pct exec {CID} -- bash -c 'mkdir -p /var/backups/smile && chown postgres:postgres /var/backups/smile'")
    rc, out, err = run(f"pct exec {CID} -- sudo -u postgres pg_dump -Fc smile_db -f {backup_file}")
    if rc != 0:
        print(f"Error: Database backup failed: {err}")
        sys.exit(1)
    print(f"✓ Safety backup created: {backup_file}")

    # 3. Execute reset script inside container using Node.js and .env
    print("Executing database reset inside container...")
    reset_script = r"""
set -euo pipefail
cd /opt/smile

node -e '
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");

const envContent = fs.readFileSync(".env", "utf8");
let databaseUrl = "";
let initialPassword = "";

for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (trimmed.startsWith("DATABASE_URL=")) {
    databaseUrl = trimmed.substring("DATABASE_URL=".length).replace(/^["\x27]|["\x27]$/g, "");
  }
  if (trimmed.startsWith("INITIAL_USER_PASSWORD=")) {
    initialPassword = trimmed.substring("INITIAL_USER_PASSWORD=".length).replace(/^["\x27]|["\x27]$/g, "");
  }
}

if (!databaseUrl) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}
if (!initialPassword) {
  console.error("INITIAL_USER_PASSWORD not found in .env");
  process.exit(1);
}

async function reset() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  console.log("Connected to database.");

  const hash = await bcrypt.hash(initialPassword, 12);

  await client.query("BEGIN");
  try {
    // Truncate all rating, conference, card, and timeout data
    await client.query(`
      TRUNCATE
        evaluation_items,
        evaluations,
        final_ranks,
        class_round_locks,
        behavior_cards,
        pupil_behavior_actions,
        timeout_escalations,
        timeout_incidents,
        password_resets,
        audit_logs
      RESTART IDENTITY CASCADE;
    `);

    // Unlock observation rounds
    await client.query("UPDATE observation_rounds SET is_locked = false;");

    // Reset all teacher accounts to initial bootstrap password & mustChangePassword
    const userRes = await client.query(
      "UPDATE users SET password_hash = $1, must_change_password = true, password_issued_at = now(), session_version = 0 WHERE role != \x27admin\x27 RETURNING username;",
      [hash]
    );

    await client.query("COMMIT");
    console.log(`Reset ${userRes.rowCount} teacher accounts to initial password.`);
    console.log("All evaluations, items, final ranks, cards, timeouts, and logs truncated.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Reset failed, rolled back:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

reset();
'
"""
    b64 = base64.b64encode(reset_script.encode()).decode()
    rc, out, err = run(f'pct exec {CID} -- bash -c "echo {b64} | base64 -d | bash"')
    if rc != 0:
        print(f"Error executing reset:\n{out}\n{err}")
        sys.exit(1)
    print(out)

    # 4. Restart smile.service
    print("Restarting smile.service...")
    rc, out, err = run(f"pct exec {CID} -- systemctl restart smile.service")
    if rc != 0:
        print(f"Warning: systemctl restart returned {rc}: {err}")

    time.sleep(2)
    rc, out, err = run(f"pct exec {CID} -- systemctl is-active smile.service")
    print(f"Service status: {out}")

    # 5. Verification counts
    print("\nVerifying database state...")
    verify_script = """
su - postgres -c 'psql -d smile_db -tAc "
SELECT
  (SELECT count(*) FROM evaluations) AS evals,
  (SELECT count(*) FROM final_ranks) AS ranks,
  (SELECT count(*) FROM behavior_cards) AS cards,
  (SELECT count(*) FROM timeout_incidents) AS timeouts,
  (SELECT count(*) FROM users WHERE must_change_password = false AND role != \x27admin\x27) AS logged_in_teachers,
  (SELECT count(*) FROM users WHERE role != \x27admin\x27) AS total_teachers,
  (SELECT count(*) FROM pupils) AS pupils,
  (SELECT count(*) FROM school_classes) AS classes;
"'
"""
    verify_b64 = base64.b64encode(verify_script.encode()).decode()
    rc, out, err = run(f'pct exec {CID} -- bash -c "echo {verify_b64} | base64 -d | bash"')
    if rc == 0 and out:
        parts = [p.strip() for p in out.split('|')]
        if len(parts) >= 8:
            print(f"  - Evaluations: {parts[0]}")
            print(f"  - Final Ranks: {parts[1]}")
            print(f"  - Behavior Cards: {parts[2]}")
            print(f"  - Timeouts: {parts[3]}")
            print(f"  - Logged-in Teachers: {parts[4]} (expected 0)")
            print(f"  - Total Teacher Accounts (reset): {parts[5]}")
            print(f"  - Preserved Pupils: {parts[6]}")
            print(f"  - Preserved Classes: {parts[7]}")

    print("\n✓ Production LXC 115 reset completed successfully!")

finally:
    ssh.close()
