#!/usr/bin/env python3
"""
restore_drill.py — Automated proof that backups can actually be restored.

Properties:
  - Tests the real restore pipeline into an isolated scratch database (smile_restore_drill).
  - Never touches or modifies the live database (smile_db).
  - Decrypts encrypted archives (.enc) to verify that the encryption key is valid.
  - Verifies table counts and ensures at least 100 pupils are restored (partial restore detection).
  - Drops the isolated scratch database in a finally block to ensure zero leftover state.
  - Writes a JSON verification receipt to /var/backups/smile/restore_drill_status.json.
  - Exits 0 on success, 1 on failure (systemd alert).
"""
import os
import sys
import json
import time
import glob
import tempfile
import datetime
import subprocess

ENV_FILE_CANDIDATES = ("/etc/smile/backup.env",)

def log(msg: str):
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [restore-drill] {msg}", flush=True)

def fail(msg: str):
    log(f"CRITICAL ERROR: {msg}")
    sys.exit(1)

def load_env():
    values = {}
    for path in ENV_FILE_CANDIDATES:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        v = v.strip().strip('"').strip("'")
                        if v:
                            values[k.strip()] = v
            break
    return values

def resolve_setting(loaded, key, default=""):
    return os.environ.get(key) or loaded.get(key, default)

def run_cmd(cmd, check=True, capture=True):
    res = subprocess.run(cmd, capture_output=capture, text=True)
    if check and res.returncode != 0:
        err = res.stderr.strip() if res.stderr else res.stdout.strip()
        raise RuntimeError(f"Command failed ({res.returncode}): {' '.join(cmd)}\n{err}")
    return res

def main():
    log("Starting automated restore drill...")
    loaded = load_env()
    backup_dir = resolve_setting(loaded, "BACKUP_DIR", "/var/backups/smile")
    passphrase = resolve_setting(loaded, "BACKUP_ENCRYPTION_PASSPHRASE", "")
    live_db = resolve_setting(loaded, "DB_NAME", "smile_db")
    drill_db = resolve_setting(loaded, "DRILL_DB", "smile_restore_drill")

    if drill_db == live_db:
        fail(f"Safety check failed: DRILL_DB ('{drill_db}') must not be the live database name!")

    # Find candidate dumps in backup_dir
    dump_candidates = glob.glob(os.path.join(backup_dir, "smile_db_*.dump"))
    enc_candidates = glob.glob(os.path.join(backup_dir, "smile_db_*.dump.enc"))

    all_dumps = dump_candidates + enc_candidates
    if not all_dumps:
        fail(f"No database dumps found in {backup_dir}")

    # Sort by modification time, newest first
    all_dumps.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    selected_backup = all_dumps[0]
    log(f"Selected latest backup for restore drill: {os.path.basename(selected_backup)}")

    start_time = time.time()
    temp_dir = tempfile.mkdtemp(prefix="smile-drill-")
    decrypted_dump = os.path.join(temp_dir, "restorable.dump")

    db_url = resolve_setting(loaded, "DATABASE_URL", "")
    if db_url:
        base_url = db_url.rsplit('/', 1)[0] + '/postgres'
        drill_url = db_url.rsplit('/', 1)[0] + '/' + drill_db
    else:
        base_url = ""
        drill_url = ""

    def exec_db_admin(sql):
        if base_url:
            return run_cmd(["psql", base_url, "-c", sql])
        else:
            return run_cmd(["su", "-", "postgres", "-c", f"psql -c '{sql}'"])

    def query_count(target_db_url, target_db_name, table):
        if target_db_url:
            res = run_cmd(["psql", target_db_url, "-t", "-A", "-c", f"SELECT count(*) FROM {table};"])
        else:
            res = run_cmd(["su", "-", "postgres", "-c", f"psql -d {target_db_name} -t -A -c 'SELECT count(*) FROM {table};'"])
        return int(res.stdout.strip() or 0)

    try:
        # Step 1: Decrypt if needed
        if selected_backup.endswith(".enc"):
            if not passphrase:
                fail("Backup is encrypted but BACKUP_ENCRYPTION_PASSPHRASE is not configured.")
            log("Decrypting backup with AES-256-CBC PBKDF2...")
            decrypt_cmd = [
                "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
                "-in", selected_backup,
                "-out", decrypted_dump,
                "-pass", f"pass:{passphrase}",
            ]
            run_cmd(decrypt_cmd)
            restore_file = decrypted_dump
        else:
            restore_file = selected_backup

        # Step 2: Validate archive TOC
        log("Validating dump archive structure...")
        toc_res = run_cmd(["pg_restore", "--list", restore_file])
        if "pupils" not in toc_res.stdout:
            fail("Archive table-of-contents validation failed: 'pupils' table is missing.")

        # Step 3: Recreate isolated drill database
        log(f"Recreating isolated drill database: {drill_db}...")
        exec_db_admin(f"DROP DATABASE IF EXISTS {drill_db};")
        exec_db_admin(f"CREATE DATABASE {drill_db};")

        # Step 4: Run pg_restore into isolated database
        log(f"Restoring archive into {drill_db}...")
        if drill_url:
            pg_cmd = [
                "pg_restore", "--exit-on-error", "-d", drill_url,
                "--no-owner", "--no-acl", restore_file,
            ]
        else:
            pg_cmd = [
                "su", "-", "postgres", "-c",
                f"pg_restore --exit-on-error -d {drill_db} --no-owner --no-acl {restore_file}",
            ]
        pg_res = subprocess.run(pg_cmd, capture_output=True, text=True)
        # pg_restore exit 1 means "ran with errors"; a drill that accepts it can
        # report a partial restore as a successful proof of recoverability.
        if pg_res.returncode != 0:
            fail(f"pg_restore failed with exit code {pg_res.returncode}: {pg_res.stderr.strip()}")

        # Step 5: Verify table counts against live database
        log("Comparing row counts between live database and restored drill database...")
        tables_to_verify = [
            "pupils",
            "school_classes",
            "teachers",
            "users",
            "behavior_cards",
            "evaluations",
            "observation_rounds",
        ]

        verified_counts = {}
        for tbl in tables_to_verify:
            live_count = query_count(db_url, live_db, tbl)
            drill_count = query_count(drill_url, drill_db, tbl)

            verified_counts[tbl] = {"live": live_count, "restored": drill_count}
            log(f"  {tbl:<20} live={live_count:<6} restored={drill_count:<6}")

            if live_count != drill_count:
                fail(f"Count mismatch in table '{tbl}': live has {live_count}, restored has {drill_count}!")

        # Step 6: Sanity checks
        pupil_count = verified_counts["pupils"]["restored"]
        if pupil_count < 100:
            fail(f"Restored pupil count ({pupil_count}) is implausibly low. Minimum 100 expected for this school.")

        duration = round(time.time() - start_time, 2)
        log(f"✓ DRILL PASSED: {pupil_count} pupils, all tables 100% matched in {duration}s.")

        # Step 7: Write receipt
        receipt = {
            "status": "PASSED",
            "timestamp": datetime.datetime.now().isoformat(),
            "tested_backup": os.path.basename(selected_backup),
            "pupil_count": pupil_count,
            "duration_seconds": duration,
            "verified_tables": verified_counts,
        }
        status_file = os.path.join(backup_dir, "restore_drill_status.json")
        try:
            with open(status_file, "w", encoding="utf-8") as f:
                json.dump(receipt, f, indent=2)
            log(f"Receipt written to {status_file}")
        except Exception as e:
            log(f"Notice: Could not write receipt file: {e}")

    finally:
        # Step 8: Clean up scratch database and temp directory
        log(f"Cleaning up isolated drill database: {drill_db}...")
        try:
            exec_db_admin(f"DROP DATABASE IF EXISTS {drill_db};")
        except Exception as e:
            log(f"Warning: Failed to drop drill db on cleanup: {e}")
        if os.path.exists(temp_dir):
            import shutil
            shutil.rmtree(temp_dir, ignore_errors=True)
        log("Cleanup completed.")

    log("✓ Restore drill finished successfully with 0 errors.")

if __name__ == "__main__":
    main()
