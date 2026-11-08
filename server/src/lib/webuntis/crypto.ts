import crypto from 'crypto';
import { jwtSecret } from '../../config.js';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'smile:webuntis:credential-vault:v1';
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM

/**
 * Derive a stable 256-bit encryption key from JWT_SECRET and application salt.
 */
function getDerivedKey(): Buffer {
  let secret: string;
  try {
    secret = jwtSecret();
  } catch (err) {
    if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
      secret = 'test_fallback_jwt_secret_for_unit_tests_32chars_long!';
    } else {
      throw err;
    }
  }

  const derived = crypto.hkdfSync('sha256', secret, SALT, 'smile:aes-key', 32);
  return Buffer.from(derived);
}

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt a plaintext secret (password or login key) using AES-256-GCM.
 */
export function encryptSecret(plaintext: string): EncryptedPayload {
  if (!plaintext) {
    throw new Error('Cannot encrypt empty secret.');
  }

  const key = getDerivedKey();
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

/**
 * Decrypt an AES-256-GCM encrypted payload back into plaintext.
 * Accepts either an EncryptedPayload object or separate (encrypted, iv, authTag) strings.
 */
export function decryptSecret(
  payloadOrEncrypted: EncryptedPayload | string,
  iv?: string,
  authTag?: string,
): string {
  let payload: EncryptedPayload;
  if (typeof payloadOrEncrypted === 'string') {
    if (!iv || !authTag) {
      throw new Error('iv and authTag must be provided when passing encrypted string.');
    }
    payload = { encrypted: payloadOrEncrypted, iv, authTag };
  } else {
    payload = payloadOrEncrypted;
  }

  const key = getDerivedKey();
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
