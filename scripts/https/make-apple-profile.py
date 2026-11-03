#!/usr/bin/env python3
"""
Build an Apple configuration profile containing the SMILE internal CA root and
a home-screen Web Clip. Upload the resulting .mobileconfig to the school's MDM,
or install it manually with AirDrop/email.

Certificate payloads installed through MDM or Apple Configurator are trusted
automatically for SSL. A profile downloaded and installed manually still needs
Settings > General > About > Certificate Trust Settings > full trust.
"""
import plistlib
import sys
import uuid
from pathlib import Path


def uid() -> str:
    return str(uuid.uuid4()).upper()


def build(cert_path: Path) -> bytes:
    cert = cert_path.read_bytes()
    cert_payload = {
        "PayloadCertificateFileName": "smile-internal-ca.crt",
        "PayloadContent": cert,
        "PayloadDescription": "Root CA for the SMILE HTTPS service.",
        "PayloadDisplayName": "SMILE Internal CA",
        "PayloadIdentifier": "at.ac.ms-weissenbach.smile.ca",
        "PayloadType": "com.apple.security.root",
        "PayloadUUID": uid(),
        "PayloadVersion": 1,
    }
    webclip_payload = {
        "PayloadDescription": "SMILE assessment platform.",
        "PayloadDisplayName": "SMILE",
        "PayloadIdentifier": "at.ac.ms-weissenbach.smile.webclip",
        "PayloadType": "com.apple.webClip.managed",
        "PayloadUUID": uid(),
        "PayloadVersion": 1,
        "Label": "SMILE",
        "URL": "https://172.16.1.11",
        "IsRemovable": True,
    }
    profile = {
        "PayloadContent": [cert_payload, webclip_payload],
        "PayloadDescription": "Installs the SMILE internal root CA and a SMILE home-screen shortcut.",
        "PayloadDisplayName": "SMILE – Internes Zertifikat",
        "PayloadIdentifier": "at.ac.ms-weissenbach.smile.profile",
        "PayloadOrganization": "MS Telfs Weissenbach",
        "PayloadRemovalDisallowed": False,
        "PayloadType": "Configuration",
        "PayloadUUID": uid(),
        "PayloadVersion": 1,
    }
    return plistlib.dumps(profile, fmt=plistlib.FMT_XML)


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: make-apple-profile.py <ca-root.crt> <out.mobileconfig>", file=sys.stderr)
        return 2
    cert_path = Path(sys.argv[1])
    if not cert_path.is_file():
        print(f"CA certificate not found: {cert_path}", file=sys.stderr)
        return 1
    output = build(cert_path)
    out_path = Path(sys.argv[2])
    out_path.write_bytes(output)
    print(f"wrote {out_path} ({len(output)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
