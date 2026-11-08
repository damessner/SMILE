import crypto from 'crypto';
import { config, jwtSecret } from '../../config.js';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'smile:webuntis:credential-vault:v1';
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const KEY_INFO = 'smile:aes-key';

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', secret, SALT, KEY_INFO, 32));
}

function jwtDerivedSecret(): string {
  try {
    return jwtSecret();
  } catch (err) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      return 'test_fallback_jwt_secret_for_unit_tests_32chars_long!';
    }
    throw err;
  }
}

/**
 * Current encryption key.
 *
 * Prefers WEBUNTIS_CREDENTIAL_KEY so rotating JWT_SECRET — which
 * docs/SECURITY.md instructs operators to do — does not destroy every stored
 * WebUntis credential.
 */
function currentKey(): Buffer {
  const dedicated = config.webuntis.credentialKey?.trim();
  if (dedicated) return deriveKey(dedicated);
  return deriveKey(jwtDerivedSecret());
}

/** Key used before WEBUNTIS_CREDENTIAL_KEY existed, kept only for migration. */
function legacyKey(): Buffer {
  return deriveKey(jwtDerivedSecret());
}

/**
 * Encrypt a plaintext secret (password or login key) using AES-256-GCM.
 * Always uses the current (dedicated) key.
 */
export function encryptSecret(plaintext: string): EncryptedPayload {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty secret.');
  }

  const key = currentKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptWithKey(key: Buffer, payload: EncryptedPayload): string {
  const ivBuf = Buffer.from(payload.iv, 'base64');
  const authTagBuf = Buffer.from(payload.authTag, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuf);

  decipher.setAuthTag(authTagBuf);

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, 'base64')),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Decrypt an AES-256-GCM payload. Accepts either an EncryptedPayload object or
 * separate (encrypted, iv, authTag) strings.
 *
 * Falls back to the legacy JWT-derived key exactly once, and only while
 * WEBUNTIS_CREDENTIAL_KEY is configured. `reencryptLegacySecrets()` upgrades
 * such rows at boot; this fallback exists so an upgrade does not lock every
 * teacher out of WebUntis.
 */
export function decryptSecret(
  payloadOrEncrypted: EncryptedPayload | string,
  iv?: string,
  authTag?: string,
): string {
  return decryptSecretDetailed(payloadOrEncrypted, iv, authTag).plaintext;
}

export function decryptSecretDetailed(
  payloadOrEncrypted: EncryptedPayload | string,
  iv?: string,
  authTag?: string,
): { plaintext: string; usedLegacyKey: boolean } {
  let payload: EncryptedPayload;
  if (typeof payloadOrEncrypted === 'string') {
    if (!iv || !authTag) {
      throw new Error('iv and authTag must be provided when passing encrypted string.');
    }
    payload = { encrypted: payloadOrEncrypted, iv, authTag };
  } else {
    payload = payloadOrEncrypted;
  }

  try {
    return { plaintext: decryptWithKey(currentKey(), payload), usedLegacyKey: false };
  } catch (err) {
    if (!config.webuntis.credentialKey?.trim()) throw err;
    return { plaintext: decryptWithKey(legacyKey(), payload), usedLegacyKey: true };
  }
}

/** True when a dedicated key is configured, i.e. the legacy fallback is enabled. */
export function hasDedicatedCredentialKey(): boolean {
  return Boolean(config.webuntis.credentialKey?.trim());
}
