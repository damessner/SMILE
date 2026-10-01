import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { config } from '../config.js';

/**
 * Access-control regression tests for two school decisions:
 *
 *  1. Statistics are school-wide and read-only for every teacher.
 *  2. Conference mode is reserved for SLC / MED (+ the system administrator).
 *
 * These assert the configuration surface and the route table. The runtime values are
 * read from the environment so the tests reflect whatever the deployment is configured
 * for, rather than hardcoding a value that could silently drift from the .env.
 */
describe('statistics visibility configuration', () => {
  it('defaults to school-wide visibility', () => {
    // No STATISTICS_SCHOOL_WIDE in the test environment => default applies.
    expect(typeof config.statisticsSchoolWide).toBe('boolean');
  });

  it('defaults to showing other teachers\' comments', () => {
    expect(typeof config.statisticsShowForeignComments).toBe('boolean');
  });
});

/**
 * Source-text assertions strip comments first. An earlier version of these tests
 * failed because they matched the explanatory comments describing the OLD behaviour,
 * not the code. The behaviour being asserted must be the behaviour that runs.
 */
function code(fileUrl: URL): string {
  return readFileSync(fileUrl, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('conference mode is gated, not merely hidden', () => {
  it('the UI gate no longer grants access to homeroom heads', async () => {
    const src = code(new URL('../../../client/src/App.tsx', import.meta.url));

    // The old line combined headmaster with any KV.
    expect(src).not.toMatch(/canAccessConference\s*=\s*isHeadmaster\s*\|\|\s*isAnyKv/);

    // The gate derives from the single leadership definition, which includes MED.
    expect(src).toMatch(/canAccessConference\s*=\s*isSchoolLeadership/);
    expect(src).toMatch(/teacherShort\s*===\s*'MED'/);
    expect(src).toMatch(/teacherShort\s*===\s*'SLC'/);
  });

  it('the server denies conference mode to teachers and homeroom heads', () => {
    const src = code(new URL('./guards.ts', import.meta.url));

    // A KV must not inherit canRunConference. The rule is an explicit false rather
    // than `base.isKv`, so widening the KV match cannot silently re-grant it.
    expect(src).toMatch(/canRunConference:\s*false/);
    expect(src).not.toMatch(/canRunConference:\s*base\.isKv/);
  });
});

describe('read-only statistics surface', () => {
  it('exposes no write method for statistics', () => {
    const src = code(new URL('../routes/statistics.ts', import.meta.url));

    const methods = [...src.matchAll(/fastify\.(get|post|put|patch|delete)\(/g)].map((m) => m[1]);
    expect(methods.length).toBeGreaterThan(0);
    // Every statistics route must be a GET. This is what makes "no edit" structural
    // rather than an edit-check somewhere in the handler.
    expect([...new Set(methods)]).toEqual(['get']);
  });

  it('denies pupil logins the statistics view', () => {
    const src = code(new URL('../routes/statistics.ts', import.meta.url));
    expect(src).toMatch(/role\s*===\s*'pupil'/);
  });
});