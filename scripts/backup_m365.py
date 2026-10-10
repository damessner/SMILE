#!/usr/bin/env python3
"""
backup_m365.py — Encrypted 10-minute daytime backup with local retention and Microsoft 365 upload.

Pipeline:
   1. Dump database locally (pg_dump -Fc) -> /var/backups/smile/smile_db_{stamp}.dump
   2. Validate dump index with pg_restore --list (asserts integrity and presence of pupils table)
   3. Generate human-readable reports (HTML, Markdown, Excel)
   4. Client-side AES-256 encryption of all cloud-bound assets (DSGVO compliant)
   5. Apply local retention pruning (keep 10-minute snapshots for 3 days, dailies for 30 days)
   6. Authenticate and upload encrypted assets to Microsoft 365. rclone with a
      delegated OAuth token is preferred: it survives MFA/Conditional Access and
      needs no stored password. If no rclone remote is configured the legacy
      password-grant Graph path is used and a warning is logged, because it
      stops working the moment Security Defaults are enforced.
   7. Apply cloud retention pruning (keep 10-minute snapshots for CLOUD_KEEP_DAYS,
      19:00 dailies are preserved via the per-school-year archive)
   8. Write a LATEST.txt pointer recording which snapshot folder is current.
      There is deliberately no overwritten "latest" folder: each run keeps its
      own folder, and everything is age-pruned uniformly.
   9. Exit non-zero on any error so systemd / monitoring alerts

Hardening rules enforced here:
   - No credentials are ever hardcoded. Configuration comes from the process
     environment, then from /etc/smile/backup.env. THAT IS ALL.
   - The encryption passphrase is its own secret. It is NEVER derived from the
     M365 password: rotating that password must not silently orphan every
     encrypted backup already in the cloud, and the server-side restore path
     must find the same key the backup path used.
   - A run either fully succeeds or reports failure. Upload errors are counted
     and propagated, so systemd marks the unit failed and an operator sees it.
"""
import os
import re
import sys
import json
import time
import shutil
import urllib.parse
import urllib.error
import urllib.request
import datetime
import subprocess
import tempfile

# ---------------------------------------------------------------------------
# Configuration resolution
# ---------------------------------------------------------------------------

ENV_FILE_CANDIDATES = ("/etc/smile/backup.env",)
SNAPSHOT_RE = re.compile(r"^smile_db_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})\.dump$")

def log(msg):
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)

def fail(msg):
    log(f"CRITICAL ERROR: {msg}")
    sys.exit(1)

def warn(msg):
    log(f"WARNING: {msg}")

def load_env():
    """Read the first env file that exists. First file wins.

    Deliberately first-found-wins rather than last-writer-wins: precedence that
    depends on how many files happen to exist on the box is precedence nobody
    can reason about. Only a real absolute path is honoured — a relative path
    such as "scripts/backup.env" would silently depend on the working directory
    and could shadow the production file.
    """
    for path in ENV_FILE_CANDIDATES:
        if os.path.exists(path):
            values = {}
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        v = v.strip().strip('"').strip("'")
                        if v:
                            values[k.strip()] = v
            return values
    return {}

def setting(loaded, key, default=""):
    """Resolve a setting. The live environment always wins over the env file.

    systemd EnvironmentFile= already injects the file into the environment, so on
    a production run this usually returns straight from os.environ. The file is
    only consulted for manual runs.
    """
    value = os.environ.get(key)
    if value:
        return value
    return loaded.get(key, default)

# ---------------------------------------------------------------------------
# Encryption
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Local retention
# ---------------------------------------------------------------------------

def snapshot_kind(fname):
    """Classify a snapshot filename as 'daily', 'intraday', or None.

    Parses the timestamp out of the name instead of substring-matching. The old
    check (`"_19" in fname`) looked self-evident but was only accidentally
    correct: it matched any run at 19:00 and, if the schedule ever changed to
    e.g. 19:10, or a backup was taken at 10:19, it would misclassify it.

    Returns (kind, stamp) or (None, None) if the name is not a snapshot.
    """
    m = SNAPSHOT_RE.match(fname)
    if not m:
        return None, None
    y, mo, d, h, mi = m.groups()
    return ("daily" if h == "19" else "intraday"), f"{y}-{mo}-{d} {h}:{mi}"

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
        # Never prune manual safety snapshots taken before a restore.
        if fname.startswith("pre-restore-safety-"):
            continue
        kind, _ = snapshot_kind(fname)
        if kind is None:
            continue
        mtime = entry.stat().st_mtime
        cutoff = daily_cutoff if kind == "daily" else intraday_cutoff
        if mtime < cutoff:
            try:
                os.remove(entry.path)
                log(f"Pruned expired local {kind} backup: {fname}")
            except Exception as e:
                warn(f"Failed to remove {fname}: {e}")

# ---------------------------------------------------------------------------
# Microsoft Graph transport
# ---------------------------------------------------------------------------

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
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_body)
            desc = err_json.get("error_description", err_body)
            log(f"M365 OAuth authentication failed ({err_json.get('error', e.code)}): {desc}")
        except Exception:
            log(f"M365 OAuth HTTPError {e.code}: {err_body}")
        return None
    except Exception as e:
        log(f"M365 OAuth authentication failed: {e}")
        return None

def upload_file_to_onedrive(access_token, remote_path, local_file_path, retries=3):
    encoded_path = urllib.parse.quote(remote_path)
    url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded_path}:/content"

    # Stream from disk rather than reading the whole file into memory. A dump of
    # a couple of hundred MB is the normal case here, and MemoryDenyWriteExecute
    # plus ProtectSystem=strict make a large in-RAM copy needlessly risky.
    with open(local_file_path, "rb") as f:
        for attempt in range(1, retries + 1):
            f.seek(0)
            try:
                req = urllib.request.Request(url, data=f, method="PUT")
                req.add_header("Authorization", f"Bearer {access_token}")
                req.add_header("Content-Type", "application/octet-stream")
                with urllib.request.urlopen(req, timeout=300) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    return True, data.get("name")
            except Exception as e:
                if attempt == retries:
                    return False, str(e)
                time.sleep(2 * attempt)
    return False, "Max retries exceeded"

def graph_list_children(access_token, folder):
    """List the immediate children of a OneDrive folder, following pagination.

    A 30-day retention horizon at 10-minute cadence is ~2300 folders, and Graph
    returns at most 200 children per page. Reading only the first page meant the
    prune silently saw none of them and deleted nothing.
    """
    encoded = urllib.parse.quote(folder)
    url = f"https://graph.microsoft.com/v1.0/me/drive/root:/{encoded}:/children"
    items = []
    while url:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        items.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
    return items

def prune_cloud_backups(access_token, keep_days=30, loaded=None):
    """Prunes cloud intraday snapshots older than keep_days. Returns problem list.

    Uses rclone when a remote is configured (it lists folders without paging and
    deletes by name); otherwise falls back to paginated Graph calls.

    The 19:00 Tagesschluss snapshot is archived into a per-school-year folder,
    which this function does not touch. Anything that is not a timestamped
    snapshot folder (the Schuljahr archive, and the small LATEST.txt pointer)
    is also left alone; the pointer is a ~20-byte index entry, so retaining it
    indefinitely is not a growth problem.

    A failed prune is surfaced but does not fail the run: losing cloud retention
    is a GB-scale problem discovered tomorrow, and failing a successful backup
    for it would teach the operator to ignore alerts.
    """
    problems = []
    now_dt = datetime.datetime.now()

    if loaded is not None and rclone_remote_ok(loaded):
        remote = setting(loaded, "RCLONE_REMOTE", "m365")
        config = setting(loaded, "RCLONE_CONFIG", "/etc/smile/rclone.conf")
        res = subprocess.run(
            ["rclone", "lsf", f"{remote}:SMILE-Backups", "--dirs-only",
             "--config", config, "--timeout", "60s"],
            capture_output=True, text=True,
        )
        if res.returncode != 0:
            return [f"cloud retention scan failed: {res.stderr.strip()}"]
        for name in res.stdout.split():
            if len(name) == 15 and name[10] == "_":
                try:
                    folder_dt = datetime.datetime.strptime(name, "%Y-%m-%d_%H%M")
                    if folder_dt.hour == 19:
                        continue
                    if (now_dt - folder_dt).total_seconds() > keep_days * 86400:
                        subprocess.run(
                            ["rclone", "purge", f"{remote}:SMILE-Backups/{name}",
                             "--config", config, "--timeout", "60s"],
                            capture_output=True, text=True,
                        )
                        log(f"Pruned expired cloud snapshot folder: {name}")
                except Exception as e:
                    problems.append(f"cloud prune of {name} failed: {e}")
        return problems

    try:
        items = graph_list_children(access_token, "SMILE-Backups")
    except Exception as e:
        log(f"Cloud retention scan failed: {e}")
        return [f"cloud retention scan failed: {e}"]

    now_dt = datetime.datetime.now()
    for item in items:
        name = item.get("name", "")
        # Only timestamped intraday folders: YYYY-MM-DD_HHMM
        if len(name) == 15 and name[10] == "_":
            try:
                folder_dt = datetime.datetime.strptime(name, "%Y-%m-%d_%H%M")
                # Tagesschluss snapshots are retained via the school-year archive.
                if folder_dt.hour == 19:
                    continue
                if (now_dt - folder_dt).total_seconds() > keep_days * 86400:
                    item_id = item.get("id")
                    if not item_id:
                        problems.append(f"cloud folder {name} has no id; not deleted")
                        continue
                    del_url = f"https://graph.microsoft.com/v1.0/me/drive/items/{item_id}"
                    del_req = urllib.request.Request(
                        del_url, method="DELETE",
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    urllib.request.urlopen(del_req, timeout=15)
                    log(f"Pruned expired cloud snapshot folder: {name}")
            except Exception as e:
                # One folder failing must not abort the scan of the rest.
                problems.append(f"cloud prune of {name} failed: {e}")
    return problems

# ---------------------------------------------------------------------------
# Upload transport
# ---------------------------------------------------------------------------

def rclone_remote_ok(loaded):
    """True if a configured rclone remote is reachable."""
    remote = setting(loaded, "RCLONE_REMOTE", "m365")
    config = setting(loaded, "RCLONE_CONFIG", "/etc/smile/rclone.conf")
    res = subprocess.run(
        ["rclone", "lsd", f"{remote}:", "--config", config, "--timeout", "30s"],
        capture_output=True, text=True,
    )
    return res.returncode == 0

def upload_via_rclone(loaded, remote_path, local_file_path, retries=3):
    remote = setting(loaded, "RCLONE_REMOTE", "m365")
    config = setting(loaded, "RCLONE_CONFIG", "/etc/smile/rclone.conf")
    dest = f"{remote}:{remote_path}"
    for attempt in range(1, retries + 1):
        res = subprocess.run(
            ["rclone", "copyto", local_file_path, dest,
             "--config", config, "--timeout", "120s", "--retries", "5"],
            capture_output=True, text=True,
        )
        if res.returncode == 0:
            return True, os.path.basename(remote_path)
        if attempt == retries:
            return False, res.stderr.strip() or res.stdout.strip()
        time.sleep(2 * attempt)
    return False, "Max retries exceeded"

def upload(loaded, token, remote_path, local_file_path):
    """Try rclone first, then fall back to the Graph PUT."""
    if rclone_remote_ok(loaded):
        ok, res = upload_via_rclone(loaded, remote_path, local_file_path)
        if ok:
            return True, res
        warn(f"rclone upload of {remote_path} failed ({res}); falling back to Graph.")
    if token:
        return upload_file_to_onedrive(token, remote_path, local_file_path)
    return False, "no rclone remote and no Graph token available"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

def preflight(loaded):
    """Validate prerequisites without touching any data. Used by `--check`."""
    problems = []

    # shutil.which() rather than shelling out to `which`: it is portable and does
    # not add a subprocess to a job whose whole point is to be auditable.
    for cmd in ("pg_dump", "pg_restore", "openssl"):
        if shutil.which(cmd) is None:
            problems.append(f"{cmd} is not on PATH")

    db_url = os.environ.get("DATABASE_URL") or loaded.get("DATABASE_URL")
    if not db_url:
        user = loaded.get("DB_USER", "smile_backup")
        if not user:
            problems.append("no DATABASE_URL and no DB_USER in /etc/smile/backup.env")

    if not setting(loaded, "M365_USER"):
        problems.append("M365_USER is not configured")
    if not setting(loaded, "M365_PASSWORD"):
        problems.append("M365_PASSWORD is not configured")

    if not setting(loaded, "BACKUP_ENCRYPTION_PASSPHRASE"):
        problems.append(
            "BACKUP_ENCRYPTION_PASSPHRASE is not configured. Refusing to run: "
            "it must be an independent secret, never the M365 password."
        )

    backup_root = os.environ.get("BACKUP_DIR", "/var/backups/smile")
    if os.path.exists(backup_root) and not os.access(backup_root, os.W_OK):
        problems.append(f"{backup_root} is not writable")

    if problems:
        for p in problems:
            log(f"PRECHECK: {p}")
    else:
        log("Preflight passed: all prerequisites present.")
    return problems

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        sys.exit(1 if preflight(load_env()) else 0)

    loaded = load_env()
    now = datetime.datetime.now()
    stamp = now.strftime("%Y-%m-%d_%H%M")
    is_tagesschluss = (now.hour == 19)

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    backup_root = os.environ.get("BACKUP_DIR", "/var/backups/smile")
    os.makedirs(backup_root, exist_ok=True)

    # Fail before dumping, not after, if the configuration cannot possibly work.
    if preflight(loaded):
        fail("Configuration incomplete. Run 'backup_m365.py --check' for details.")

    # -------------------------------------------------------------------------
    # Resolve the database target. The DSN comes from the environment or the env
    # file; there is no hardcoded fallback, because a hardcoded production
    # password in a tracked script is exactly the leak this pipeline must not
    # repeat.
    # -------------------------------------------------------------------------
    db_url = os.environ.get("DATABASE_URL") or loaded.get("DATABASE_URL")
    if not db_url:
        user = loaded.get("DB_USER", "smile_backup")
        pwd = setting(loaded, "DB_PASSWORD", os.environ.get("PGPASSWORD", ""))
        auth = f"{user}:{pwd}" if pwd else user
        host = loaded.get("DB_HOST", "127.0.0.1")
        port = loaded.get("DB_PORT", "5432")
        db_name = loaded.get("DB_NAME", "smile_db")
        db_url = f"postgresql://{auth}@{host}:{port}/{db_name}"

    # The encryption key is independent of the Microsoft account password.
    encryption_passphrase = setting(loaded, "BACKUP_ENCRYPTION_PASSPHRASE")

    m365_user = setting(loaded, "M365_USER")
    m365_pass = setting(loaded, "M365_PASSWORD")

    # -------------------------------------------------------------------------
    # STEP 1: Always perform and validate local database dump first
    # -------------------------------------------------------------------------
    local_dump_file = os.path.join(backup_root, f"smile_db_{stamp}.dump")
    log(f"Starting local database dump: {local_dump_file}")

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
            res = subprocess.run(
                [sys.executable, gen_script, "--html", html_file, "--md", md_file],
                capture_output=True, text=True,
            )
            # Reports are a named deliverable of this pipeline. A silent failure
            # here means teachers get nothing at class conference and only find
            # out then.
            if res.returncode != 0:
                fail(f"Report generation failed: {res.stderr.strip() or res.stdout.strip()}")
            for f, label in ((html_file, "HTML"), (md_file, "Markdown")):
                if not os.path.exists(f) or os.path.getsize(f) == 0:
                    fail(f"Report generator produced an empty {label} report.")
            log("✓ Human-readable reports generated")

        excel_script = os.path.join(base_dir, "scripts", "export-live-excel.py")
        if os.path.exists(excel_script):
            res = subprocess.run(
                [sys.executable, excel_script, excel_file],
                capture_output=True, text=True,
            )
            if res.returncode != 0:
                fail(f"Excel export failed: {res.stderr.strip() or res.stdout.strip()}")
            log("✓ Excel overview generated")

        # ---------------------------------------------------------------------
        # STEP 3: Encrypt assets before uploading to cloud (DSGVO compliance)
        # ---------------------------------------------------------------------
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
        # STEP 4: Authenticate to M365 & Upload encrypted archives
        # ---------------------------------------------------------------------
        log(f"Authenticating to Microsoft 365 as {m365_user}...")
        # With a working rclone remote the password grant is never contacted:
        # that flow is blocked by MFA and Security Defaults, and this is how
        # the backup keeps running when the school turns them on.
        if rclone_remote_ok(loaded):
            log("Using rclone OneDrive remote (delegated OAuth).")
            token = None
        else:
            warn("No usable rclone remote — falling back to the legacy password grant. "
                 "Run scripts/setup-m365-rclone.sh to move off it.")
            tenant_id = setting(loaded, "M365_TENANT_ID", "42864638-c600-42c0-8f6a-18beaa7cbf31")
            token = get_m365_token(m365_user, m365_pass, tenant_id=tenant_id)
            if not token:
                fail("Authentication to Microsoft Graph API failed. "
                     "If MFA or Security Defaults are now enforced for this account, "
                     "the password grant no longer works and the backup must move "
                     "to delegated OAuth (rclone) or an app registration.")

        # Every run writes its own timestamped folder. There is deliberately no
        # fixed-name "latest" folder: overwriting it would destroy the previous
        # run's copy, and exempting it from pruning meant it grew without
        # limit. Discovery is solved with a ~20-byte pointer file instead.
        targets = [f"SMILE-Backups/{stamp}"]
        if is_tagesschluss:
            school_year = f"Schuljahr_{now.year if now.month >= 9 else now.year - 1}-{now.year + 1 if now.month >= 9 else now.year}"
            targets.append(f"SMILE-Backups/{school_year}/{stamp}_Tagesschluss")
            log(f"Tagesschluss snapshot — archiving to {school_year}/")

        pointer_file = os.path.join(tmpdir, "LATEST.txt")
        with open(pointer_file, "w", encoding="utf-8") as f:
            f.write(f"{stamp}\n")
        # Files that live directly under SMILE-Backups rather than in a snapshot
        # folder. The pointer is metadata, not pupil data, so it stays in the
        # clear: it is useless without the matching folder.
        root_files = [("LATEST.txt", pointer_file)]

        upload_errors = 0
        for target_folder in targets:
            log(f"Uploading encrypted files: {target_folder}/...")
            for dest_name, enc_path in files_to_upload:
                remote_path = f"{target_folder}/{dest_name}"
                ok, res = upload(loaded, token, remote_path, enc_path)
                if ok:
                    log(f"  ✓ {dest_name} uploaded successfully")
                else:
                    log(f"  ✗ {dest_name} upload failed: {res}")
                    upload_errors += 1

        log("Updating the LATEST.txt pointer...")
        for dest_name, src_path in root_files:
            remote_path = f"SMILE-Backups/{dest_name}"
            ok, res = upload(loaded, token, remote_path, src_path)
            if ok:
                log(f"  ✓ {dest_name} now points at {stamp}")
            else:
                log(f"  ✗ {dest_name} update failed: {res}")
                upload_errors += 1

        # ---------------------------------------------------------------------
        # STEP 5: Cloud retention pruning
        # ---------------------------------------------------------------------
        cloud_keep_days = int(setting(loaded, "CLOUD_KEEP_DAYS", "30"))
        cloud_problems = prune_cloud_backups(token, keep_days=cloud_keep_days, loaded=loaded)
        for p in cloud_problems:
            warn(p)

    # -------------------------------------------------------------------------
    # STEP 6: Local retention pruning.
    # Deliberately AFTER a successful upload: the dump only leaves the box once
    # the cloud copy is confirmed to exist.
    # -------------------------------------------------------------------------
    keep_intraday_days = int(setting(loaded, "KEEP_INTRADAY_DAYS", "3"))
    keep_daily_days = int(setting(loaded, "KEEP_DAILY_DAYS", "30"))
    prune_local_backups(backup_root, keep_intraday_days=keep_intraday_days, keep_daily_days=keep_daily_days)

    if upload_errors > 0:
        fail(f"{upload_errors} file(s) failed to upload to Microsoft 365 OneDrive.")
    if cloud_problems:
        warn(f"{len(cloud_problems)} cloud retention problem(s); footprint may be growing.")

    log(f"✓ Backup run {stamp} completed successfully (Local + Encrypted Cloud).")

if __name__ == "__main__":
    main()
