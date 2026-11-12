"""
Helper script to generate iOS distribution signing keys and package .p12 certificates
without needing a Mac.

Usage:
  uv run --with cryptography python scripts/prepare_ios_signing.py generate-csr
  uv run --with cryptography python scripts/prepare_ios_signing.py bundle-p12 [password]
"""

import os
import sys
import base64
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography import x509
    from cryptography.x509.oid import NameOID
except ImportError:
    print("Error: cryptography library not found. Run with:")
    print("  uv run --with cryptography python scripts/prepare_ios_signing.py ...")
    sys.exit(1)

SIGNING_DIR = Path("ios_signing")
KEY_PATH = SIGNING_DIR / "smile_distribution.key"
USER_DOWNLOADS = Path(os.environ.get("USERPROFILE", "")) / "Downloads"


def generate_csr():
    SIGNING_DIR.mkdir(parents=True, exist_ok=True)

    print("[1/2] Generating 2048-bit RSA Private Key...")
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    with open(KEY_PATH, "wb") as f:
        f.write(
            private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )
    print(f"  -> Saved private key to: {KEY_PATH}")

    print("[2/2] Generating Certificate Signing Request (CSR)...")
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(
            x509.Name(
                [
                    x509.NameAttribute(NameOID.COMMON_NAME, "David Messner (SMILE)"),
                    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Mittelschule Telfs Dr. Aloys Weissenbach"),
                    x509.NameAttribute(NameOID.COUNTRY_NAME, "AT"),
                ]
            )
        )
        .sign(private_key, hashes.SHA256())
    )

    csr_path = USER_DOWNLOADS / "CertificateSigningRequest.certSigningRequest"
    with open(csr_path, "wb") as f:
        f.write(csr.public_bytes(serialization.Encoding.PEM))

    print(f"  -> Saved CSR to: {csr_path}")
    print("\nSUCCESS! CSR created.")
    print("Next steps:")
    print("1. Open https://developer.apple.com/account/resources/certificates/add")
    print("2. Choose 'Apple Distribution' and click Continue.")
    print("3. Upload the file from your Downloads folder:")
    print(f"   {csr_path.name}")
    print("4. Click Continue, then Download the certificate (distribution.cer).")
    print("5. Once downloaded, run:")
    print("   uv run --with cryptography python scripts/prepare_ios_signing.py bundle-p12")


def bundle_p12(password: str = "Smile2026!"):
    if not KEY_PATH.exists():
        print(f"Error: {KEY_PATH} not found. Run generate-csr first!")
        sys.exit(1)

    cer_candidates = list(USER_DOWNLOADS.glob("*.cer")) + list(SIGNING_DIR.glob("*.cer"))
    if not cer_candidates:
        print(f"Error: No .cer file found in {USER_DOWNLOADS} or {SIGNING_DIR}.")
        print("Please download 'distribution.cer' from developer.apple.com first.")
        sys.exit(1)

    cer_path = sorted(cer_candidates, key=lambda p: p.stat().st_mtime, reverse=True)[0]
    print(f"Using certificate: {cer_path}")

    with open(KEY_PATH, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)

    cer_data = cer_path.read_bytes()
    try:
        cert = x509.load_der_x509_certificate(cer_data)
    except Exception:
        cert = x509.load_pem_x509_certificate(cer_data)

    p12_data = pkcs12.serialize_key_and_certificates(
        name=b"SMILE Distribution",
        key=private_key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(password.encode("utf-8")),
    )

    p12_path = SIGNING_DIR / "smile_distribution.p12"
    p12_path.write_bytes(p12_data)
    print(f"  -> Generated .p12 certificate: {p12_path}")

    p12_b64 = base64.b64encode(p12_data).decode("ascii")

    # Look for provisioning profile
    profile_candidates = list(USER_DOWNLOADS.glob("*.mobileprovision")) + list(SIGNING_DIR.glob("*.mobileprovision"))
    profile_b64 = None
    if profile_candidates:
        profile_path = sorted(profile_candidates, key=lambda p: p.stat().st_mtime, reverse=True)[0]
        print(f"Using provisioning profile: {profile_path}")
        profile_b64 = base64.b64encode(profile_path.read_bytes()).decode("ascii")
    else:
        print("Note: No .mobileprovision file found yet in Downloads.")

    # Look for AuthKey_*.p8
    p8_candidates = list(USER_DOWNLOADS.glob("AuthKey_*.p8")) + list(SIGNING_DIR.glob("*.p8"))
    p8_content = None
    key_id = None
    if p8_candidates:
        p8_path = sorted(p8_candidates, key=lambda p: p.stat().st_mtime, reverse=True)[0]
        print(f"Using App Store Connect API Key: {p8_path.name}")
        p8_content = p8_path.read_text(encoding="utf-8")
        if "_" in p8_path.stem:
            key_id = p8_path.stem.split("_")[1]

    # Save summary of secrets to a local text file for easy copy/paste
    secrets_summary_path = SIGNING_DIR / "github_secrets_to_add.txt"
    with open(secrets_summary_path, "w", encoding="utf-8") as f:
        f.write("=== GITHUB SECRETS FOR SMILE IOS BUILD ===\n")
        f.write("Add these at: https://github.com/damessner/SMILE/settings/secrets/actions\n\n")

        if key_id:
            f.write(f"1. APP_STORE_CONNECT_KEY_ID:\n{key_id}\n\n")
        f.write("2. APP_STORE_CONNECT_ISSUER_ID:\n[Copy Issuer ID from App Store Connect Keys page]\n\n")
        if p8_content:
            f.write(f"3. APP_STORE_CONNECT_PRIVATE_KEY:\n{p8_content}\n\n")
        f.write(f"4. BUILD_CERTIFICATE_BASE64:\n{p12_b64}\n\n")
        f.write(f"5. P12_PASSWORD:\n{password}\n\n")
        if profile_b64:
            f.write(f"6. BUILD_PROVISION_PROFILE_BASE64:\n{profile_b64}\n\n")

    print(f"\n[OK] Summary of GitHub Secrets written to: {secrets_summary_path}")
    print("Keep this file secret. It will not be committed to git.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: prepare_ios_signing.py [generate-csr|bundle-p12]")
        sys.exit(1)

    cmd = sys.argv[1]
    if cmd == "generate-csr":
        generate_csr()
    elif cmd == "bundle-p12":
        pw = sys.argv[2] if len(sys.argv) > 2 else "Smile2026!"
        bundle_p12(pw)
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
