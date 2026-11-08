import { describe, expect, it } from 'vitest';
import { config } from '../../config.js';
import {
  decryptSecret,
  decryptSecretDetailed,
  encryptSecret,
  hasDedicatedCredentialKey,
} from './crypto.js';

describe('WebUntis Credential Crypto (AES-256-GCM)', () => {
  it('encrypts and decrypts a plaintext password successfully', () => {
    const original = 'MySecretTeacherPassword2026!';
    const payload = encryptSecret(original);

    expect(payload.encrypted).toBeTruthy();
    expect(payload.iv).toBeTruthy();
    expect(payload.authTag).toBeTruthy();
    expect(payload.encrypted).not.toEqual(original);

    const decrypted = decryptSecret(payload.encrypted, payload.iv, payload.authTag);
    expect(decrypted).toBe(original);
  });

  it('generates different IVs for each encryption of the same plaintext', () => {
    const text = 'RepeatPassword123';
    const p1 = encryptSecret(text);
    const p2 = encryptSecret(text);

    expect(p1.iv).not.toEqual(p2.iv);
    expect(p1.encrypted).not.toEqual(p2.encrypted);

    expect(decryptSecret(p1.encrypted, p1.iv, p1.authTag)).toBe(text);
    expect(decryptSecret(p2.encrypted, p2.iv, p2.authTag)).toBe(text);
  });

  it('fails decryption if ciphertext is tampered with', () => {
    const payload = encryptSecret('SensitiveUntisSecret');
    const tampered = payload.encrypted.slice(0, -2) + 'aa';

    expect(() => decryptSecret(tampered, payload.iv, payload.authTag)).toThrow();
  });

  it('fails decryption if authTag is tampered with', () => {
    const payload = encryptSecret('SensitiveUntisSecret');
    const tamperedTag = payload.authTag.slice(0, -2) + 'bb';

    expect(() => decryptSecret(payload.encrypted, payload.iv, tamperedTag)).toThrow();
  });

  it('rejects empty input on encrypt', () => {
    expect(() => encryptSecret('')).toThrow(/empty/i);
  });

  it('still reads a legacy JWT-derived secret after a dedicated key is added', () => {
    const cfg = config.webuntis as { credentialKey: string };
    const original = cfg.credentialKey;
    try {
      cfg.credentialKey = '';
      expect(hasDedicatedCredentialKey()).toBe(false);
      const legacy = encryptSecret('LegacySecret123!');

      cfg.credentialKey = 'dedicated-credential-key-that-is-at-least-32-chars';
      expect(hasDedicatedCredentialKey()).toBe(true);

      const migrated = decryptSecretDetailed(legacy.encrypted, legacy.iv, legacy.authTag);
      expect(migrated.plaintext).toBe('LegacySecret123!');
      expect(migrated.usedLegacyKey).toBe(true);

      const fresh = encryptSecret('FreshSecret123!');
      const current = decryptSecretDetailed(fresh.encrypted, fresh.iv, fresh.authTag);
      expect(current.plaintext).toBe('FreshSecret123!');
      expect(current.usedLegacyKey).toBe(false);
    } finally {
      cfg.credentialKey = original;
    }
  });
});
