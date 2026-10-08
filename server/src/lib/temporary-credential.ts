import { randomInt } from 'crypto';
import { LEAKED_SECRETS } from '../config.js';

/**
 * One-time credential generation for administrator-issued first-login passwords.
 *
 * Why generated rather than typed by the administrator: the old deployment handed every
 * account the same value, so the app cannot tell "who set this password" from "who reused
 * the published default". A per-issuance random value means every handover is distinct and
 * an administrator never invents a weak one by hand.
 *
 * The value is intentionally *not* a long random string. It has to be read aloud or copied
 * off a printed handover sheet, so it avoids characters that are ambiguous in both contexts
 * (0/O, 1/l/I) and avoids symbols that break copy/paste from a printed page.
 */

/** Uppercase minus I/O, lowercase minus l/o, digits minus 0/1. */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';

function pick(alphabet: string): string {
  return alphabet[randomInt(0, alphabet.length)];
}

/** Alphanumeric only, so the value survives a print/QR/screenshot handover. */
export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(12, Math.min(64, length));
  // Guarantee the character classes `validateNewPassword` requires instead of rejecting
  // candidates in a loop: a rejection loop biases towards patterns that avoid repeats.
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  const all = UPPER + LOWER + DIGITS;
  while (chars.length < size) {
    chars.push(pick(all));
  }
  // Fisher-Yates so the guaranteed classes are not always in the first three positions,
  // which would make every issued password share a recognisable prefix.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const password = chars.join('');
  // A generated value hitting a known-leaked literal is astronomically unlikely, but the
  // cost of the check is nil and the consequence would be re-arming a banned credential.
  if (LEAKED_SECRETS.has(password)) {
    throw new Error('Generated credential collided with a banned value.');
  }
  return password;
}