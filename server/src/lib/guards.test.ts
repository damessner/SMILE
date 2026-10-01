import { describe, expect, it } from 'vitest';
import { kvFieldMatches, parseIdParam } from './guards.js';

/**
 * Homeroom matching is a security boundary: it decides who may edit a class roster and
 * who may confirm conference ranks. The previous implementation used
 * `field.includes(shortName)`, which granted that authority whenever a teacher's short
 * name happened to be a substring of an unrelated name.
 */
describe('kvFieldMatches', () => {
  const zia = { shortName: 'ZIA', fullName: 'Alfred Zimmermann' };

  it('matches the whole field holding just the short name', () => {
    expect(kvFieldMatches('ZIA', zia)).toBe(true);
    expect(kvFieldMatches('zia', zia)).toBe(true);
  });

  it('matches the whole field holding the full name', () => {
    expect(kvFieldMatches('Alfred Zimmermann', zia)).toBe(true);
  });

  it('matches the parenthesised short code form used by the export', () => {
    expect(kvFieldMatches('Alfred Zimmermann (ZIA)', zia)).toBe(true);
    expect(kvFieldMatches('Alfred Zimmermann (zia)', zia)).toBe(true);
  });

  it('matches when the short code trails the name without parentheses', () => {
    expect(kvFieldMatches('Alfred Zimmermann ZIA', zia)).toBe(true);
  });

  it('matches one teacher out of several in a combined field', () => {
    expect(kvFieldMatches('Alfred Zimmermann (ZIA) / Maria Meier (MED)', zia)).toBe(true);
    expect(kvFieldMatches('Anna Auer / Alfred Zimmermann (ZIA)', zia)).toBe(true);
  });

  // The regression that motivated this module.
  it('does NOT match on an incidental substring', () => {
    const z = { shortName: 'Z', fullName: 'Zoe Ziegler' };
    expect(kvFieldMatches('Karin Ziegler', z)).toBe(false);
    expect(kvFieldMatches('Alfred Zimmermann', z)).toBe(false);
  });

  it('does not match a different teacher', () => {
    expect(kvFieldMatches('Maria Meier (MED)', zia)).toBe(false);
    expect(kvFieldMatches('Bernhard Roth', zia)).toBe(false);
  });

  it('handles empty and null fields', () => {
    expect(kvFieldMatches(null, zia)).toBe(false);
    expect(kvFieldMatches(undefined, zia)).toBe(false);
    expect(kvFieldMatches('', zia)).toBe(false);
    expect(kvFieldMatches('   ', zia)).toBe(false);
  });
});

describe('parseIdParam', () => {
  it('accepts positive integers', () => {
    expect(parseIdParam('42')).toBe(42);
    expect(parseIdParam('7')).toBe(7);
  });

  // NaN previously reached parameterised SQL via /timetable/teacher/:teacherId.
  it('rejects non-numeric input instead of forwarding NaN', () => {
    expect(parseIdParam('abc')).toBeNull();
    expect(parseIdParam('')).toBeNull();
    expect(parseIdParam('1 OR 1=1')).toBeNull();
  });

  it('rejects zero and negative values', () => {
    expect(parseIdParam('0')).toBeNull();
    expect(parseIdParam('-5')).toBeNull();
  });

  it('rejects trailing garbage rather than taking the leading integer', () => {
    // parseInt('12abc') === 12, which silently accepted a malformed segment.
    expect(parseIdParam('12abc')).toBeNull();
    expect(parseIdParam('12 13')).toBeNull();
    expect(parseIdParam(' 12')).toBeNull();
  });

  it('rejects unsafe integers', () => {
    expect(parseIdParam('99999999999999999999')).toBeNull();
  });
});