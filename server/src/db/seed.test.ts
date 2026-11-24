import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

/**
 * seed.ts runs `seed()` as soon as it is imported and needs a live database, so these
 * are source-level checks of the account-creation policy rather than a behaviour run:
 * every new account must be hashed from the one shared INITIAL_USER_PASSWORD and must be
 * flagged mustChangePassword.
 */
describe('seed account policy', () => {
  const source = readFileSync(new URL('./seed.ts', import.meta.url), 'utf8');

  it('reads the shared start password from INITIAL_USER_PASSWORD', () => {
    expect(source).toMatch(/initialBootstrapPassword\(\)/);
    expect(source).toMatch(/const bootstrapPassword = initialBootstrapPassword\(\);/);
  });

  it('hashes the admin account from the start password unless ADMIN_PASSWORD is set', () => {
    expect(source).toContain('passwordHash: await bcrypt.hash(adminPassword ?? bootstrapPassword, BCRYPT_ROUNDS)');
    expect(source).toMatch(/role: 'admin',\s*mustChangePassword: true/);
  });

  it('hashes every new teacher account from the same start password and flags it', () => {
    expect(source).toContain('passwordHash: await bcrypt.hash(bootstrapPassword, BCRYPT_ROUNDS)');
    expect(source).toMatch(/passwordHash: await bcrypt\.hash\(bootstrapPassword, BCRYPT_ROUNDS\),\s*role,\s*teacherId: t\.id,\s*mustChangePassword: true/);
  });

  it('never resets the password of an existing account', () => {
    expect(source).toMatch(/Keep the existing password hash/);
    const updates = source.match(/\.update\(users\)[\s\S]*?\.where\(/g) ?? [];
    for (const update of updates) {
      expect(update).not.toMatch(/passwordHash/);
    }
  });

  it('does not depend on the reverted per-account credentials file', () => {
    expect(source).not.toMatch(/seed-credentials/);
  });

  it('detects homeroom teachers with kvFieldMatches, never a substring test', () => {
    // A bare `field.includes(shortName)` would seed any teacher whose short
    // name occurs inside an unrelated homeroom field as head_teacher. The seed
    // must use the same exact/parenthesised/separator matcher as the runtime
    // KV check in guards.ts.
    expect(source).not.toMatch(/\.includes\(t\.shortName\)/);
    expect(source).toMatch(/kvFieldMatches\(field, t\)/);
    expect(source).toMatch(/import \{[^}]*kvFieldMatches[^}]*\} from '\.\.\/lib\/guards\.js'/);
  });
});
