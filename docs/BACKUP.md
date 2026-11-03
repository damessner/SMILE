# Encrypted Backup — SMILE

> **Current deployment (2026-11-03):** the primary cloud destination is
> **Microsoft 365 OneDrive** (`scripts/backup_m365.py`, `smile-m365-backup.timer`,
> every 10 minutes 06:00–19:00). The independent off-host RSA copy
> (`scripts/backup_independent.py`) and weekly restore drill are the recovery
> proof. The Google Drive/rclone path below is optional and is not installed by
> `deploy.py`; keep it only if you actually operate it.
>
> On 2026-11-03 the M365 passphrase is also escrowed on the Proxmox host at
> `/etc/smile-security/m365-backup-passphrase` (0600). That protects against loss
> of LXC 115, not loss of the Proxmox host: keep the two sealed custodial copies.

Replaces the previous situation, which had **no working restore path at all**. The
in-app JSON export remains a convenience download; it is not a backup.

Pipeline:

```
pg_dump -Fc  →  validate  →  rclone crypt (client-side)  →  Google Drive
```

Restores are proven weekly by an automated drill.

---

## What this protects against, and what it does not

**Protects against:** loss of LXC 115, accidental `DELETE`, a corrupted table,
ransomware that does not reach the Drive account, and a school that loses the
server hardware.

**Does not protect against:** anyone who obtains the crypt passphrase. The key
lives on LXC 115 (in `rclone.conf`, mode 0600) — an attacker who fully compromises
the server gets both the live data and the ability to read every historical backup.
Split the key custody (below) so a single stolen envelope is not sufficient.

---

## One-time setup

### 1. Create a dedicated backup database role

Do not reuse the application role. This one only ever reads.

```sql
CREATE ROLE smile_backup LOGIN PASSWORD '<generate a new one>';
GRANT CONNECT ON DATABASE smile_db TO smile_backup;
GRANT USAGE ON SCHEMA public TO smile_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO smile_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO smile_backup;
```

### 2. Authorise the Drive remote

From a machine with a browser, so the OAuth consent flow is available:

```bash
rclone config
#   Storage: drive
#   Scope: drive
#   ... follow the prompts ...
```

Copy the resulting `[gdrive]` section into LXC 115's `rclone.conf`, or authorise
directly on the LXC if it has a browser.

**The Drive token is not the backup passphrase.** It can be revoked and re-issued at
any time. Only the passphrase is unrecoverable.

### 3. Create the encrypted remote and generate the passphrase

```bash
sudo -u smile bash /opt/smile/scripts/setup-gdrive-backup.sh gdrive
```

This generates a 32-byte random passphrase and salt, writes `rclone.conf` (mode 0600),
uploads a probe object, and **confirms that what landed on Drive is ciphertext and not
plaintext**. It then prints the passphrase and salt **exactly once**.

### 4. Seal the passphrase

Write the printed values on the form the script outputs. **Two sealed copies, two
custodians:**

| Copy | Custodian |
|---|---|
| A | Schulleitung |
| B | School IT / Bezirksinspektion, or a second Schulleitung member |

Store them physically apart from LXC 115 and from each other. The whole point is that
no single loss — one person, one envelope, one room — takes the backups with it.

> **Lose the passphrase and every backup is permanently unreadable.** There is no reset
> and no recovery. This is not a risk to accept lightly.

### 5. Install the units

```bash
sudo install -o root -g smile -m 0640 scripts/backup.env /etc/smile/backup.env
sudo nano /etc/smile/backup.env          # fill in PGPASSWORD

sudo install -m 0644 scripts/systemd/smile-backup.service       /etc/systemd/system/
sudo install -m 0644 scripts/systemd/smile-backup.timer         /etc/systemd/system/
sudo install -m 0644 scripts/systemd/smile-restore-drill.service /etc/systemd/system/
sudo install -m 0644 scripts/systemd/smile-restore-drill.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now smile-backup.timer smile-restore-drill.timer
```

### 6. Prove it works, before you need it

```bash
sudo systemctl start smile-backup.service
journalctl -u smile-backup.service -n 50 --no-pager

sudo systemctl start smile-restore-drill.service
journalctl -u smile-restore-drill.service -n 50 --no-pager
```

Both must succeed. Do not consider the setup complete until the drill has passed at
least once with a real database.

---

## Operating it

```bash
# what is on Drive
sudo -u smile bash scripts/restore-from-gdrive.sh --list

# what would a restore do (writes nothing)
sudo -u smile bash scripts/restore-from-gdrive.sh --latest --dry-run

# restore into a scratch database (safe, non-destructive)
sudo -u smile bash scripts/restore-from-gdrive.sh --latest

# restore over the LIVE database — destructive, guarded
sudo -u smile bash scripts/restore-from-gdrive.sh --latest --target smile_db --force
```

### Timers

| Job | Schedule | Notes |
|---|---|---|
| `smile-backup.timer` | hourly, at :07 + up to 3 min random | `Persistent=true`, so one missed run is not silently skipped |
| `smile-restore-drill.timer` | Sundays 05:30 + up to 30 min random | Exit 1 = alert |

### Why hourly, not every 10 minutes

`pg_dump` is a full dump each time — there is no incrementality. At the projected
~30 MB per compressed dump:

- hourly ≈ 0.7 GB/day of dumps generated
- every 10 minutes ≈ 4.3 GB/day, and risks Drive API throttling

More importantly, a 10-minute window protects against nothing that matters. The
disasters this job exists for — hardware loss, corruption, ransomware, a dropped
table — destroy everything since the *last* backup regardless of its age.

If a tighter recovery point is genuinely needed, the correct lever is
incremental snapshots (restic), not more frequent full dumps.

---

## Retention

| Tier | Window | Keeps |
|---|---|---|
| Hourly | last 3 days | every backup |
| Daily | days 4–31 | newest per day |
| Weekly | weeks 5–16 | newest per week |
| Monthly | beyond 16 weeks | newest per month |

Monthly retention now runs to `KEEP_MONTHLY_MONTHS` (default 12 months); the
previous script deleted everything beyond the 112-day weekly horizon despite
this table. Tunable in `/etc/smile/backup.env`.

The M365 path keeps a single 19:00 Tagesschluss per day plus the configured
intraday window; the 19:10–19:50 runs are pruned like any other intraday copy.

---

## What each run actually verifies

A backup that is uploaded is not necessarily a backup that can be restored, so each
run performs these checks and **exits non-zero if any fail**:

1. Destination reachable **before** dumping — a Drive outage does not generate a dump
   that cannot be sent
2. `pg_restore --list` parses the archive
3. the archive contains a `pupils` table (catches truncated dumps that still parse)
4. the object reads back through the crypt remote
5. `rclone cryptcheck` authenticates the stored objects

The weekly drill then does a real restore and checks the pupil count is plausible,
failing if fewer than 100 rows come back — a partial restore can otherwise exit 0.

---

## Alerting

`smile-restore-drill.service` exit codes:

| Code | Meaning |
|---|---|
| 0 | drill passed |
| 1 | **drill failed — alert** |
| 2 | no backup exists yet |

Minimum sensible monitoring: alert on exit 1, and alert if `smile-backup.timer` has
not fired in the last 3 hours.

```bash
systemctl is-active smile-backup.timer smile-restore-drill.timer
systemctl list-timers 'smile-*'
```

---

## Rotating the passphrase

**You cannot rotate it in place.** Because the key is derived from the passphrase and
rclone stores nothing to re-key against, changing it makes all existing backups
unreadable. You must re-upload everything through a new crypt remote.

Because of this, generate the passphrase once, carefully, and keep the sealed copies.
If it is ever exposed, plan a full re-upload before the next retention cycle deletes
the old encrypted files out from under you.

---

## Tests

The shell scripts carry 54 tests over three suites, run with stub binaries so no
Drive account or database is touched:

```bash
bash scripts/test/run-all.sh
```

They cover the ordering guarantees (reachability checked before dumping), every
failure path (unreachable Drive, failed dump, unreadable object, failed integrity
check), the retention tiering (recent hourly data is never pruned; the newest file
per bucket always survives), and the restore safety gates (refuses to overwrite the
live database without `--force`, rejects path traversal, treats an empty restore as a
failure).

---

---

## 3-2-1 Architecture & Independent Copies

SMILE implements a complete 3-2-1 backup strategy:

1. **3 copies of the data**:
   - Live PostgreSQL database (`smile_db`)
   - Cloud backup on Microsoft 365 OneDrive (`SMILE-Backups/`)
   - Independent off-host copy on the Proxmox virtualization host (`/var/backups/smile-independent/`)
2. **2 different storage media / environments**:
   - Local disk storage (container filesystem + Proxmox host storage)
   - Cloud object storage (Microsoft 365 Graph / OneDrive)
3. **1 copy offsite & isolated with asymmetric encryption**:
   - Encrypted with a 4096-bit RSA certificate (`independent_backup.cert.pem`).
   - The private decryption key (`independent_backup_private.key`) is stored **exclusively on the Proxmox host** (outside LXC 115) and never touches the container.
   - An attacker who fully compromises container 115 **cannot decrypt** the independent backups.

---

## Automated Restore Drill (`restore_drill.py`)

A backup that has never been restored is an unproven assumption.
`smile-restore-drill.timer` fires weekly (Sunday mornings 05:30) and runs `scripts/restore_drill.py`:

- Locates the most recent local or cloud backup.
- Decrypts it to verify that the encryption passphrase is valid.
- Recreates a disposable, isolated scratch database (`smile_restore_drill`).
- Restores the archive with `pg_restore`.
- Verifies that all tables match the live database row-for-row and that pupil count exceeds the sanity threshold (>= 100).
- Writes a status receipt to `/var/backups/smile/restore_drill_status.json`.
- Drops `smile_restore_drill` upon completion.
- Exits 0 on success, 1 on failure (triggering systemd failure alerts).