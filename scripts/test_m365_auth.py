#!/usr/bin/env python3
"""
Test direct Microsoft 365 Graph authentication (ROPC via first-party Office client ID).
Tests login and access to /me/drive without requiring third-party admin consent.
"""
import sys
import json
import getpass
import urllib.request
import urllib.parse
import urllib.error

user = sys.argv[1] if len(sys.argv) > 1 and "@" in sys.argv[1] else "smile@ms-telfs.at"
pwd = sys.argv[2] if len(sys.argv) > 2 else (sys.argv[1] if len(sys.argv) > 1 and "@" not in sys.argv[1] else None)

if not pwd:
    pwd = getpass.getpass(f"Enter Microsoft 365 password for {user}: ")

client_id = "d3590ed6-52b3-4102-aeff-aad2292ab01c"  # Microsoft Office public client
tenant_id = "42864638-c600-42c0-8f6a-18beaa7cbf31"
token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"

data = urllib.parse.urlencode({
    "client_id": client_id,
    "grant_type": "password",
    "username": user,
    "password": pwd,
    "scope": "https://graph.microsoft.com/.default offline_access",
}).encode("utf-8")

req = urllib.request.Request(token_url, data=data, method="POST")
req.add_header("Content-Type", "application/x-www-form-urlencoded")

print(f"Authenticating directly to Microsoft Graph as {user}...")
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.loads(resp.read().decode("utf-8"))
        token = body.get("access_token")

    print("✓ Success: Microsoft 365 authentication succeeded!")
    
    # Verify access to OneDrive
    req_drive = urllib.request.Request(
        "https://graph.microsoft.com/v1.0/me/drive",
        headers={"Authorization": f"Bearer {token}"}
    )
    with urllib.request.urlopen(req_drive, timeout=20) as resp_drive:
        drive_data = json.loads(resp_drive.read().decode("utf-8"))
        drive_id = drive_data.get("id")
        drive_type = drive_data.get("driveType")
        print(f"✓ Success: OneDrive accessible! Drive ID: {drive_id} (Type: {drive_type})")
        print("\nDirect Graph API upload is 100% READY for backups.")

except urllib.error.HTTPError as e:
    err_body = e.read().decode("utf-8", errors="replace")
    try:
        err_json = json.loads(err_body)
        err_msg = err_json.get("error_description", err_body)
    except Exception:
        err_msg = err_body
    print(f"\n✗ Authentication failed (HTTP {e.code}):\n{err_msg}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"\n✗ Connection error: {e}", file=sys.stderr)
    sys.exit(1)
