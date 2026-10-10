#!/usr/bin/env python3
"""
Interactive helper to authorize Microsoft 365 OneDrive via rclone,
query the tenant's drive_id & drive_type from Graph API,
and generate the exact /etc/smile/rclone.conf configuration.
"""
import os
import re
import sys
import json
import shutil
import webbrowser
import subprocess
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

RCLONE_PATHS = [
    os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.75.1-windows-amd64\rclone.exe"),
    shutil.which("rclone"),
]

rclone_bin = None
for p in RCLONE_PATHS:
    if p and os.path.exists(p):
        rclone_bin = p
        break

if not rclone_bin:
    print("Error: rclone executable not found.", file=sys.stderr, flush=True)
    sys.exit(1)

print(f"Using rclone binary: {rclone_bin}", flush=True)
print("Starting 'rclone authorize onedrive'...", flush=True)

# Spawn process with line-by-line streaming
proc = subprocess.Popen(
    [rclone_bin, "authorize", "onedrive"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    bufsize=1,
)

all_output = []
token_blob = None
url_opened = False

for line in iter(proc.stdout.readline, ''):
    line_clean = line.rstrip()
    all_output.append(line_clean)
    print(line_clean, flush=True)

    # Detect authorization URL and open in browser
    match = re.search(r'(https?://[^\s]+)', line_clean)
    if match and not url_opened:
        url = match.group(1)
        print(f"\n[ACTION REQUIRED] Opening browser at:\n{url}\n", flush=True)
        try:
            if sys.platform == "win32":
                os.system(f'start "" "{url}"')
            else:
                webbrowser.open(url)
            url_opened = True
        except Exception as e:
            print(f"Could not open browser automatically: {e}", flush=True)

    # Detect token JSON
    if line_clean.startswith("{") and line_clean.endswith("}") and "access_token" in line_clean:
        token_blob = line_clean

proc.stdout.close()
return_code = proc.wait()

if return_code != 0:
    print(f"\nrclone authorize exited with code {return_code}", file=sys.stderr, flush=True)
    sys.exit(return_code)

if not token_blob:
    # Try reconstructing from all output lines
    joined = "\n".join(all_output)
    match = re.search(r'(\{[\s\S]*?"access_token"[\s\S]*?\})', joined)
    if match:
        token_blob = match.group(1).replace("\n", " ").strip()

if not token_blob:
    print("Error: Could not extract access token JSON from rclone output.", file=sys.stderr, flush=True)
    sys.exit(1)

print("\n--- Step 1/2: OAuth authorization succeeded! ---", flush=True)

try:
    token_data = json.loads(token_blob)
    access_token = token_data.get("access_token")
except Exception as e:
    print(f"Failed to parse token JSON: {e}", file=sys.stderr, flush=True)
    sys.exit(1)

print("--- Step 2/2: Querying Microsoft Graph API for drive_id & drive_type ---", flush=True)
req = urllib.request.Request(
    "https://graph.microsoft.com/v1.0/me/drive",
    headers={"Authorization": f"Bearer {access_token}"}
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        drive_info = json.loads(resp.read().decode("utf-8"))
except Exception as e:
    print(f"Warning: Failed to query /me/drive via Graph API: {e}", file=sys.stderr, flush=True)
    drive_info = {}

drive_id = drive_info.get("id", "")
drive_type = drive_info.get("driveType", "business")
user_email = drive_info.get("owner", {}).get("user", {}).get("email") or drive_info.get("owner", {}).get("user", {}).get("displayName", "")

print(f"\nAccount confirmed: {user_email}")
print(f"Drive ID: {drive_id}")
print(f"Drive Type: {drive_type}")

config_text = f"""[m365]
type = onedrive
token = {token_blob}
drive_id = {drive_id}
drive_type = {drive_type}
"""

out_config_path = os.path.join(os.path.dirname(__file__), "generated_rclone.conf")
with open(out_config_path, "w", encoding="utf-8") as f:
    f.write(config_text)

print(f"\nConfiguration successfully saved to: {out_config_path}")

print("\nTesting connection with 'rclone lsd m365:'...")
test_res = subprocess.run(
    [rclone_bin, "lsd", "m365:", "--config", out_config_path, "--timeout", "30s"],
    capture_output=True,
    text=True,
)

if test_res.returncode == 0:
    print("Connection test successful! Folders found on OneDrive:")
    print(test_res.stdout.strip())
else:
    print(f"Connection test warning:\n{test_res.stderr.strip()}", file=sys.stderr)

print("\n" + "=" * 60)
print("READY FOR /etc/smile/rclone.conf ON LXC 115:")
print("=" * 60)
print(config_text.strip())
print("=" * 60)
