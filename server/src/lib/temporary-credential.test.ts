import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword } from './temporary-credential.js';
import { LEAKED_SECRETS } from '../config.js';

/**
 * Mirrors the rule in routes/auth.ts. Duplicated deliberately: this module must not import
 * the route (which pulls in the database pool), and a copy that drifts fails loudly here.
 */
function satisfiesPasswordPolicy(password: string): boolean {
  if (password.length < 12) return false;
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
}

describe('generateTemporaryPassword', () => {
  it('produces a value the password policy accepts', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(satisfiesPasswordPolicy(generateTemporaryPassword())).toBe(true);
    }
  });

  it('never issues a previously published credential', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(LEAKED_SECRETS.has(generateTemporaryPassword())).toBe(false);
    }
  });

  it('never reuses a value across issuances', () => {
    // Two accounts handed the same password is precisely the defect being replaced, so
    // uniqueness per issuance is a hard requirement rather than a probabilistic nicety.
    const issued = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      issued.add(generateTemporaryPassword());
    }
    expect(issued.size).toBe(500);
  });

  it('stays transcribable by hand', () => {
    // 0/O, 1/l/I and symbols cannot be read reliably from a printed sheet or a phone call,
    // which is how these credentials are actually delivered.
    for (let i = 0; i < 200; i += 1) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^[A-Za-z0-9]+$/);
      expect(password).not.toMatch(/[0O1lI]/);
    }
  });

  it('honours the requested length within bounds', () => {
    expect(generateTemporaryPassword(20)).toHaveLength(20);
    // Below the policy floor and above the sane ceiling are clamped, never honoured.
    expect(generateTemporaryPassword(4)).toHaveLength(12);
    expect(generateTemporaryPassword(500)).toHaveLength(64);
  });

  it('does not leak the character-class guarantees into a fixed prefix', () => {
    // If the shuffled result always began upper/lower/digit in that order, every issued
    // credential would share a recognisable shape.
    const prefixes = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      prefixes.add(generateTemporaryPassword().slice(0, 3));
    }
    expect(prefixes.size).toBeGreaterThan(10);
  });
});