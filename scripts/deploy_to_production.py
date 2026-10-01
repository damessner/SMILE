#!/usr/bin/env python3
"""
Deploy built bundles to Proxmox LXC 115 production container.

Usage:
  python scripts/deploy_to_production.py
"""
import tarfile
import os
import sys
import tempfile
import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
proxmox_host = os.environ.get('PROXMOX_HOST', '192.168.178.87')
proxmox_user = os.environ.get('PROXMOX_USER', 'root')
proxmox_pass = os.environ.get('PROXMOX_PASSWORD')
container_id = os.environ.get('LXC_CONTAINER_ID', '115')

if not proxmox_pass:
    import getpass
    proxmox_pass = getpass.getpass(f"Enter SSH password for {proxmox_user}@{proxmox_host}: ")

tar_fd, tar_path = tempfile.mkstemp(suffix=".tar.gz")
os.close(tar_fd)

try:
    print("Creating deployment bundle...")
    bundle_items = [
        "package.json",
        "package-lock.json",
        "server/package.json",
        "server/dist",
        "server/src",
        "server/drizzle",
        "client/package.json",
        "client/dist",
        "client/src",
        "scripts",
        "docs",
    ]

    with tarfile.open(tar_path, "w:gz") as tar:
        for item in bundle_items:
            full_path = os.path.join(base_dir, item)
            if os.path.exists(full_path):
                tar.add(full_path, arcname=item)

    print(f"Connecting to Proxmox host {proxmox_host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(proxmox_host, username=proxmox_user, password=proxmox_pass, timeout=15)

    print("Uploading bundle...")
    sftp = ssh.open_sftp()
    remote_tmp = "/tmp/smile_update.tar.gz"
    sftp.put(tar_path, remote_tmp)
    sftp.close()

    cmds = [
        f"pct push {container_id} {remote_tmp} {remote_tmp}",
        f"pct exec {container_id} -- tar -xzf {remote_tmp} -C /opt/smile --overwrite",
        f"pct exec {container_id} -- bash -c 'cd /opt/smile && npm install --omit=dev --ignore-scripts'",
        f"pct exec {container_id} -- systemctl restart smile.service",
        f"pct exec {container_id} -- systemctl status smile.service",
    ]

    for cmd in cmds:
        print(f"\n>>> {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='replace').strip()
        if out:
            print(out)

    ssh.close()
    print("\n✓ Production deployment completed successfully!")

finally:
    if os.path.exists(tar_path):
        os.remove(tar_path)
