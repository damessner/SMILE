#!/usr/bin/env python3
"""
setup_independent_keys.py — Configure asymmetric RSA 4096 keypair for independent backups.

Key Isolation Architecture:
  - Private Key: stored exclusively on the Proxmox Host at /etc/smile-security/independent_backup_private.key
    (chmod 600, owned by root). NEVER copied into the LXC container.
  - Public Certificate: stored inside LXC 115 at /etc/smile/independent_backup.cert.pem
    (readable by smile:smile).
  - Storage: /var/backups/smile-independent/ on Proxmox host receives synced off-host encrypted archives.
"""
import os
import sys
import tempfile
import base64

sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
from ssh_utils import create_ssh_client

HOST = os.environ.get('PROXMOX_HOST', '172.16.1.54')
USER = os.environ.get('PROXMOX_USER', 'root')
PASSWORD = os.environ.get('PROXMOX_PASSWORD')
CID = os.environ.get('LXC_CONTAINER_ID', '115')

def run_host(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if rc != 0:
        raise RuntimeError(f"Host command failed ({rc}): {cmd}\n{err or out}")
    return out

def run_lxc(client, script):
    b64 = base64.b64encode(script.encode()).decode()
    cmd = f'pct exec {CID} -- bash -c "echo {b64} | base64 -d | bash"'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    if rc != 0:
        raise RuntimeError(f"LXC command failed ({rc}):\n{err or out}")
    return out

def main():
    print("Setting up asymmetric key isolation for independent backups...")
    client = create_ssh_client()
    client.connect(HOST, username=USER, password=PASSWORD, timeout=15)

    try:
        # Step 1: Ensure directory on Proxmox host
        run_host(client, "mkdir -p /etc/smile-security /var/backups/smile-independent")
        run_host(client, "chmod 700 /etc/smile-security /var/backups/smile-independent")

        # Step 2: Generate RSA 4096 keypair on Proxmox host if not exists
        check_key = run_host(client, "test -f /etc/smile-security/independent_backup_private.key && echo exists || echo missing")
        if check_key != "exists":
            print("Generating new RSA-4096 private key and X.509 certificate on Proxmox host...")
            gen_cmd = """
            openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out /etc/smile-security/independent_backup_private.key 2>/dev/null
            chmod 600 /etc/smile-security/independent_backup_private.key
            openssl req -new -x509 -key /etc/smile-security/independent_backup_private.key -out /etc/smile-security/independent_backup.cert.pem -days 3650 -subj "/CN=SMILE-Independent-Offsite-Backup" 2>/dev/null
            chmod 644 /etc/smile-security/independent_backup.cert.pem
            """
            run_host(client, gen_cmd)
            print("✓ RSA-4096 keypair created on Proxmox host.")
        else:
            print("✓ Existing RSA-4096 keypair found on Proxmox host.")

        # Step 3: Copy ONLY the public certificate into LXC 115
        cert_content = run_host(client, "cat /etc/smile-security/independent_backup.cert.pem")
        cert_b64 = base64.b64encode(cert_content.encode()).decode()

        install_cert_script = f"""
        set -euo pipefail
        mkdir -p /etc/smile /var/backups/smile-independent
        echo "{cert_b64}" | base64 -d > /etc/smile/independent_backup.cert.pem
        chown smile:smile /etc/smile/independent_backup.cert.pem
        chmod 644 /etc/smile/independent_backup.cert.pem

        chown smile:smile /var/backups/smile-independent
        chmod 700 /var/backups/smile-independent
        """
        run_lxc(client, install_cert_script)
        print("✓ Public certificate installed inside LXC 115 at /etc/smile/independent_backup.cert.pem")
        print("✓ Private key securely isolated on Proxmox host at /etc/smile-security/independent_backup_private.key (NOT inside LXC)")

        # Step 4: Verify roundtrip encryption between LXC (public key) and Proxmox Host (private key)
        print("Verifying asymmetric encryption roundtrip across host boundary...")
        test_enc = """
        echo "Boundary security check payload" | openssl cms -encrypt -aes-256-cbc -binary -out /tmp/test_boundary.enc /etc/smile/independent_backup.cert.pem
        cat /tmp/test_boundary.enc
        rm -f /tmp/test_boundary.enc
        """
        enc_output = run_lxc(client, test_enc)
        enc_b64 = base64.b64encode(enc_output.encode()).decode()

        decrypt_test_host = f"""
        echo "{enc_b64}" | base64 -d | openssl cms -decrypt -inkey /etc/smile-security/independent_backup_private.key
        """
        decrypted = run_host(client, decrypt_test_host)
        if "Boundary security check payload" in decrypted:
            print("✓ Boundary roundtrip verification: SUCCESS! Encryption inside LXC matches private decryption on Host.")
        else:
            raise RuntimeError("Decryption verification failed!")

        # Step 5: Setup off-host sync cron on Proxmox Host to pull independent backups automatically
        sync_script = """
        cat > /usr/local/bin/smile-sync-independent-backups.sh << 'EOF_SYNC'
#!/bin/bash
set -euo pipefail

DEST_DIR="/var/backups/smile-independent"
mkdir -p "$DEST_DIR"
chmod 700 "$DEST_DIR"

pct status 115 2>/dev/null | grep -q "status: running" || exit 0

FILES=$(pct exec 115 -- find /var/backups/smile-independent -maxdepth 1 -name "*.independent.enc" 2>/dev/null || true)

for f in $FILES; do
  fname=$(basename "$f")
  if [ ! -f "$DEST_DIR/$fname" ]; then
    pct pull 115 "$f" "$DEST_DIR/$fname"
    chmod 600 "$DEST_DIR/$fname"
    echo "Pulled $fname to host $DEST_DIR"
  fi
done

# Prune files older than 14 days on host
find "$DEST_DIR" -type f -name "*.independent.enc" -mtime +14 -delete 2>/dev/null || true
EOF_SYNC
        chmod 755 /usr/local/bin/smile-sync-independent-backups.sh
        # Daily cron on host at 20:00 (after 19:30 container backup)
        echo "0 20 * * * root /usr/local/bin/smile-sync-independent-backups.sh" > /etc/cron.d/smile-sync-independent
        chmod 644 /etc/cron.d/smile-sync-independent
        """
        run_host(client, sync_script)
        print("✓ Proxmox host off-host sync cron installed at /etc/cron.d/smile-sync-independent")

    finally:
        client.close()

    print("\n✓ Independent backup security architecture is fully configured and verified.")

if __name__ == '__main__':
    main()
