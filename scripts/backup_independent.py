#!/usr/bin/env python3
"""
backup_independent.py — Independent encrypted off-host backup using asymmetric encryption.

Security Architecture:
  1. Asymmetric Encryption (RSA 4096 + AES-256-CBC via OpenSSL CMS):
     - The container holding the live database ONLY holds the Public Certificate (/etc/smile/independent_backup.cert.pem).
     - The Private Key (/etc/smile-security/independent_backup_private.key) is NEVER stored on the container.
       It resides exclusively off-host (e.g. on the Proxmox host root filesystem or offline media).
     - Result: Even a total root compromise of LXC 115 CANNOT decrypt historical independent backups.
  2. Isolated Off-Host Storage:
     - Independent copies are saved to /var/backups/smile-independent and synced to the Proxmox host.
     - Pruning applies a 14-day retention cycle.
"""
import os
import sys
import glob
import time
import shutil
import datetime
import subprocess

ENV_FILE_CANDIDATES = ("/etc/smile/backup.env",)

def log(msg: str):
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [independent-backup] {msg}", flush=True)

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

def run_cmd(cmd, check=True):
    res = subprocess.run(cmd, capture_output=True, text=True)
    if check and res.returncode != 0:
        err = res.stderr.strip() if res.stderr else res.stdout.strip()
        raise RuntimeError(f"Command failed ({res.returncode}): {' '.join(cmd)}\n{err}")
    return res

def prune_old_backups(dest_dir, keep_days=14):
    cutoff = time.time() - (keep_days * 86400)
    for entry in os.scandir(dest_dir):
        if entry.is_file() and entry.name.endswith(".independent.enc"):
            if entry.stat().st_mtime < cutoff:
                try:
                    os.remove(entry.path)
                    log(f"Pruned expired independent backup: {entry.name}")
                except Exception as e:
                    log(f"Warning: Could not remove {entry.name}: {e}")

def main():
    log("Starting independent encrypted backup run...")
    loaded = load_env()
    source_dir = resolve_setting(loaded, "BACKUP_DIR", "/var/backups/smile")
    dest_dir = resolve_setting(loaded, "INDEPENDENT_BACKUP_DIR", "/var/backups/smile-independent")
    cert_path = resolve_setting(loaded, "INDEPENDENT_BACKUP_CERT", "/etc/smile/independent_backup.cert.pem")
    keep_days = int(resolve_setting(loaded, "INDEPENDENT_KEEP_DAYS", "14"))

    # Fail fast before touching the filesystem: a host without the encryption
    # certificate must not leave a stray destination directory behind.
    if not os.path.exists(cert_path):
        fail(f"Public certificate not found at {cert_path}. Run setup_independent_keys.py first.")

    os.makedirs(dest_dir, exist_ok=True)

    # Find the newest local pg_dump archive
    dumps = glob.glob(os.path.join(source_dir, "smile_db_*.dump"))
    if not dumps:
        fail(f"No database dumps found in {source_dir} to create independent copy from.")

    dumps.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    latest_dump = dumps[0]
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M")
    dest_enc_file = os.path.join(dest_dir, f"smile_db_{stamp}.independent.enc")

    log(f"Encrypting {os.path.basename(latest_dump)} with asymmetric RSA-4096 certificate ({cert_path})...")

    # Encrypt using OpenSSL CMS with the public certificate
    enc_cmd = [
        "openssl", "cms", "-encrypt",
        "-aes-256-cbc", "-binary",
        "-in", latest_dump,
        "-out", dest_enc_file,
        cert_path,
    ]
    run_cmd(enc_cmd)

    if not os.path.exists(dest_enc_file) or os.path.getsize(dest_enc_file) == 0:
        fail("Encryption failed: output file is missing or empty.")

    try:
        os.chmod(dest_enc_file, 0o600)
    except OSError as exc:
        fail(f"Could not restrict independent backup permissions: {exc}")

    file_size = os.path.getsize(dest_enc_file)
    log(f"✓ Independent copy created: {os.path.basename(dest_enc_file)} ({file_size} bytes)")

    # Prune old independent snapshots
    prune_old_backups(dest_dir, keep_days=keep_days)
    log("✓ Independent backup completed successfully.")

if __name__ == "__main__":
    main()
