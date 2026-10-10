#!/usr/bin/env python3
"""
backup_m365.py — Encrypted 10-minute daytime backup with local retention and Microsoft 365 upload.

Pipeline:
  1. Dump database locally (pg_dump -Fc) -> /var/backups/smile/smile_db_{stamp}.dump
  2. Validate dump index with pg_restore --list (asserts integrity and presence of pupils table)
  3. Generate human-readable reports (HTML, Markdown, Excel)
  4. Apply local retention pruning (keep 10-minute snapshots for 3 days, dailies for 30 days)
  5. Client-side AES-256 encryption of all cloud-bound assets (DSGVO compliant)
  6. Authenticate and upload encrypted assets to Microsoft Graph OneDrive with retry
  7. Apply cloud retention pruning (keep 10-minute snapshots for 7 days, daily 19:00 for 365 days)
  8. Exit non-zero on any error so systemd / monitoring alerts
"""
import os
import sys
import json
import time
import datetime
import subprocess
import tempfile
import urllib.request
import urllib.parse
import urllib.error

def log(msg):
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def fail(msg):
    log(f"CRITICAL ERROR: {msg}")
    sys.exit(1)

def load_env():
    env_vars = {}
    for path in ["/etc/smile/backup.env", "/opt/smile/.env", "scripts/backup.env"]:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip().strip('"').strip("'")
    return env_vars

def encrypt_file(source_path, dest_path, passphrase):
    """Encrypts a file using AES-256-CBC with PBKDF2 (matches server/src/routes/backup.ts)."""
    cmd = [
        "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
        "-in", source_path,
        "-out", dest_path,
        "-pass", f"pass:{passphrase}",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not os.path.exists(dest_path) or os.path.getsize(dest_path) == 0:
        raise RuntimeError(f"OpenSSL encryption failed: {res.stderr.strip()}")

def prune_local_backups(backup_dir, keep_intraday_days=3, keep_daily_days=30):
    """Prunes local snapshots to prevent disk exhaustion on the host."""
    if not os.path.exists(backup_dir):
        return
    now_ts = time.time()
    intraday_cutoff = now_ts - (keep_intraday_days * 86400)
    daily_cutoff = now_ts - (keep_daily_days * 86400)

    for entry in os.scandir(backup_dir):
        if not entry.is_file():
            continue
        fname = entry.name
        # Never prune manual safety snapshots
        if fname.startswith("pre-restore-safety-"):
            continue
        if fname.startswith("smile_db_") and fname.endswith(".dump"):
            mtime = entry.stat().st_mtime
            # Check if daily snapshot (taken around 19:00)
            is_daily = "_190" in fname or "_191" in fname or "_19" in fname
            if is_daily:
                if mtime < daily_cutoff:
                    try:
                        os.remove(entry.path)
                        log(f"Pruned expired local daily backup: {fname}")
                    except Exception as e:
                        log(f"Failed to remove {fname}: {e}")
            else:
                if mtime < intraday_cutoff:
                    try:
                        os.remove(entry.path)
                        log(f"Pruned expired local 10-minute backup: {fname}")
                    except Exception as e:
                        log(f"Failed to remove {fname}: {e}")

def get_m365_token(username, password, tenant_id="42864638-c600-42c0-8f6a-18beaa7cbf31"):
    client_id = "d3590ed6-52b3-4102-aeff-aad2292ab01c"  # Microsoft Office public client
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

    data = urllib.parse.urlencode({
        "client_id": client_id,
        "grant_type": "password",
        "username": username,
        "password": password,
        "scope": "https://graph.microsoft.com/.default offline_access",
    }).encode("utf-8")

    req = urllib.request.Request(token_url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body.get("access_token")
    except Exception as e:
        log(f"M365 OAuth authentication failed: {e}")
        return None

def upload_file_to_onedrive(access_token, remote_path, local_file_path, retries=3):
    encoded_path = urllib.parse.quote(remote_path)
    url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded_path}:/content"

    with open(local_file_path, "rb") as f:
        file_data = f.read()

    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, data=file_data, method="PUT")
            req.add_header("Authorization", f"Bearer {access_token}")
            req.add_header("Content-Type", "application/octet-stream")
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return True, data.get("name")
        except Exception as e:
            if attempt == retries:
                return False, str(e)
            time.sleep(2 * attempt)
    return False, "Max retries exceeded"

def prune_cloud_backups(access_token, keep_days=7):
    url = "https://graph.microsoft.com/v1.0/me/drive/root:/SMILE-Backups:/children"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            items = data.get("value", [])
            now_dt = datetime.datetime.now()
            for item in items:
                name = item.get("name", "")
                # Only check intraday folders: YYYY-MM-DD_HHMM
                if len(name) == 15 and name[10] == "_":
                    try:
                        folder_dt = datetime.datetime.strptime(name, "%Y-%m-%d_%H%M")
                        # Tagesschluss snapshot at 19:00 is kept in Schuljahr archive
                        if folder_dt.hour == 19:
                            continue
                        if (now_dt - folder_dt).total_seconds() > keep_days * 86400:
                            item_id = item.get("id")
                            del_url = f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}"
                            del_req = urllib.request.Request(
                                del_url,
                                method="DELETE",
                                headers={"Authorization": f"Bearer {access_token}"},
                            )
                            urllib.request.urlopen(del_req, timeout=15)
                            log(f"Pruned expired cloud snapshot folder: {name}")
                    except Exception:
                        pass
    except Exception as e:
        log(f"Cloud retention scan warning: {e}")

def main():
    loaded = load_env()
    now = datetime.datetime.now()
    stamp = now.strftime("%Y-%m-%d_%H%M")
    is_tagesschluss = (now.hour == 19)

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    backup_root = os.environ.get("BACKUP_DIR", "/var/backups/smile")
    os.makedirs(backup_root, exist_ok=True)

    # -------------------------------------------------------------------------
    # STEP 1: Always perform and validate local database dump first
    # -------------------------------------------------------------------------
    local_dump_file = os.path.join(backup_root, f"smile_db_{stamp}.dump")
    log(f"Starting local database dump: {local_dump_file}")

    db_url = os.environ.get("DATABASE_URL", loaded.get("DATABASE_URL", ""))
    if not db_url:
        user = loaded.get("DB_USER", "smile_backup")
        pwd = loaded.get("DB_PASSWORD", os.environ.get("PGPASSWORD", ""))
        auth = f"{user}:{pwd}" if pwd else user
        host = loaded.get("DB_HOST", "127.0.0.1")
        port = loaded.get("DB_PORT", "5432")
        db_name = loaded.get("DB_NAME", "smile_db")
        db_url = f"postgresql://{auth}@{host}:{port}/{db_name}"

    cmd_dump = [
        "pg_dump",
        "--dbname", db_url,
        "--format=custom",
        "--compress=6",
        "--no-owner", "--no-acl",
        "--file", local_dump_file,
    ]
    res_dump = subprocess.run(cmd_dump, capture_output=True, text=True)
    if res_dump.returncode != 0 or not os.path.exists(local_dump_file) or os.path.getsize(local_dump_file) == 0:
        fail(f"pg_dump failed: {res_dump.stderr.strip()}")

    # Validate dump table of contents with pg_restore --list
    res_toc = subprocess.run(["pg_restore", "--list", local_dump_file], capture_output=True, text=True)
    if res_toc.returncode != 0:
        fail(f"pg_restore --list failed: Dump is corrupt! Error: {res_toc.stderr.strip()}")
    if "pupils" not in res_toc.stdout:
        fail("Dump verification failed: 'pupils' table missing from archive.")

    dump_size = os.path.getsize(local_dump_file)
    log(f"✓ Local dump verified successfully ({dump_size} bytes)")

    # -------------------------------------------------------------------------
    # STEP 2: Generate reports (HTML, Markdown, Excel)
    # -------------------------------------------------------------------------
    with tempfile.TemporaryDirectory(prefix="smile-reports-") as tmpdir:
        html_file = os.path.join(tmpdir, f"SMILE_Druckbericht_{stamp}.html")
        md_file = os.path.join(tmpdir, f"SMILE_Uebersicht_{stamp}.md")
        excel_file = os.path.join(tmpdir, f"SMILE_Gesamtuebersicht_{stamp}.xlsx")

        gen_script = os.path.join(base_dir, "scripts", "generate_export_reports.py")
        if os.path.exists(gen_script):
            subprocess.run([sys.executable, gen_script, "--html", html_file, "--md", md_file], check=False)

        excel_script = os.path.join(base_dir, "scripts", "export-live-excel.py")
        if os.path.exists(excel_script):
            subprocess.run([sys.executable, excel_script, excel_file], check=False)

        # ---------------------------------------------------------------------
        # STEP 3: Local retention pruning
        # ---------------------------------------------------------------------
        prune_local_backups(backup_root, keep_intraday_days=3, keep_daily_days=30)

        # ---------------------------------------------------------------------
        # STEP 4: Encrypt assets before uploading to cloud (DSGVO compliance)
        # ---------------------------------------------------------------------
        m365_user = os.environ.get("M365_USER", loaded.get("M365_USER", "smile@ms-telfs.at"))
        m365_pass = os.environ.get("M365_PASSWORD", loaded.get("M365_PASSWORD", ""))
        encryption_passphrase = (
            os.environ.get("BACKUP_ENCRYPTION_PASSPHRASE")
            or loaded.get("BACKUP_ENCRYPTION_PASSPHRASE")
            or m365_pass
        )

        if not m365_pass:
            fail("M365_PASSWORD is not configured in environment or /opt/smile/.env.")
        if not encryption_passphrase:
            fail("No encryption passphrase available to protect pupil data.")

        log("Encrypting database dump and reports with AES-256-CBC...")
        enc_dump_file = os.path.join(tmpdir, f"smile_db_{stamp}.dump.enc")
        encrypt_file(local_dump_file, enc_dump_file, encryption_passphrase)

        files_to_upload = [
            ("smile_db.dump.enc", enc_dump_file),
        ]

        if os.path.exists(html_file):
            enc_html_file = os.path.join(tmpdir, f"SMILE_Druckbericht_{stamp}.html.enc")
            encrypt_file(html_file, enc_html_file, encryption_passphrase)
            files_to_upload.append(("SMILE_Druckbericht_Alle_Klassen.html.enc", enc_html_file))

        if os.path.exists(md_file):
            enc_md_file = os.path.join(tmpdir, f"SMILE_Uebersicht_{stamp}.md.enc")
            encrypt_file(md_file, enc_md_file, encryption_passphrase)
            files_to_upload.append(("SMILE_Uebersicht.md.enc", enc_md_file))

        if os.path.exists(excel_file):
            enc_excel_file = os.path.join(tmpdir, f"SMILE_Gesamtuebersicht_{stamp}.xlsx.enc")
            encrypt_file(excel_file, enc_excel_file, encryption_passphrase)
            files_to_upload.append(("SMILE_Aktuelle_Gesamtuebersicht.xlsx.enc", enc_excel_file))

        # ---------------------------------------------------------------------
        # STEP 5: Authenticate to M365 & Upload encrypted archives
        # ---------------------------------------------------------------------
        log(f"Authenticating to Microsoft 365 as {m365_user}...")
        token = get_m365_token(m365_user, m365_pass)
        if not token:
            fail("Authentication to Microsoft Graph API failed.")

        targets = [
            f"SMILE-Backups/{stamp}",
            "SMILE-Backups/latest",
        ]
        if is_tagesschluss:
            school_year = f"Schuljahr_{now.year if now.month >= 9 else now.year - 1}-{now.year + 1 if now.month >= 9 else now.year}"
            targets.append(f"SMILE-Backups/{school_year}/{stamp}_Tagesschluss")

        upload_errors = 0
        for target_folder in targets:
            log(f"Uploading encrypted files to OneDrive: {target_folder}/...")
            for dest_name, enc_path in files_to_upload:
                remote_path = f"{target_folder}/{dest_name}"
                ok, res = upload_file_to_onedrive(token, remote_path, enc_path, retries=3)
                if ok:
                    log(f"  ✓ {dest_name} uploaded successfully")
                else:
                    log(f"  ✗ {dest_name} upload failed: {res}")
                    upload_errors += 1

        # ---------------------------------------------------------------------
        # STEP 6: Cloud retention pruning
        # ---------------------------------------------------------------------
        prune_cloud_backups(token, keep_days=7)

        if upload_errors > 0:
            fail(f"{upload_errors} file(s) failed to upload to Microsoft 365 OneDrive.")

        log(f"✓ Backup run {stamp} completed successfully (Local + Encrypted Cloud).")

if __name__ == "__main__":
    main()
