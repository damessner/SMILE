import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { userWebuntisAccounts } from '../../db/schema.js';
import { decryptSecretDetailed, encryptSecret, hasDedicatedCredentialKey } from './crypto.js';

export interface ReencryptResult {
  scanned: number;
  reencrypted: number;
  failed: number;
}

/**
 * Upgrade secrets that are still encrypted with the legacy JWT-derived key.
 *
 * When `WEBUNTIS_CREDENTIAL_KEY` was introduced, existing rows kept the old
 * key. `decryptSecretDetailed()` can still read them, but a later rotation of
 * JWT_SECRET would make them permanently unreadable. This runs once at boot,
 * after migrations, and rewrites every legacy row with the dedicated key.
 *
 * Rows that fail to decrypt are left untouched and reported: deleting them
 * would silently unlink a teacher, and rewriting them would destroy the only
 * copy of a credential that an operator may still be able to recover.
 */
export async function reencryptLegacySecrets(
  log: (message: string) => void = (message) => console.warn(message),
): Promise<ReencryptResult> {
  const result: ReencryptResult = { scanned: 0, reencrypted: 0, failed: 0 };
  if (!hasDedicatedCredentialKey()) {
    // Nothing to migrate to: encryption and decryption both use the JWT key.
    return result;
  }

  const rows = await db
    .select({
      id: userWebuntisAccounts.id,
      encryptedSecret: userWebuntisAccounts.encryptedSecret,
      secretIv: userWebuntisAccounts.secretIv,
      secretAuthTag: userWebuntisAccounts.secretAuthTag,
    })
    .from(userWebuntisAccounts);

  for (const row of rows) {
    result.scanned += 1;
    try {
      const { plaintext, usedLegacyKey } = decryptSecretDetailed(
        row.encryptedSecret,
        row.secretIv,
        row.secretAuthTag,
      );
      if (!usedLegacyKey) continue;

      const encrypted = encryptSecret(plaintext);
      await db
        .update(userWebuntisAccounts)
        .set({
          encryptedSecret: encrypted.encrypted,
          secretIv: encrypted.iv,
          secretAuthTag: encrypted.authTag,
          updatedAt: new Date(),
        })
        .where(eq(userWebuntisAccounts.id, row.id));
      result.reencrypted += 1;
    } catch {
      result.failed += 1;
      log(
        '[WebUntis] Ein gespeichertes Zugangspasswort konnte nicht mit dem neuen ' +
          'WEBUNTIS_CREDENTIAL_KEY entschlüsselt werden. Die Lehrkraft muss das Konto ' +
          'erneut verknüpfen.',
      );
    }
  }

  return result;
}
