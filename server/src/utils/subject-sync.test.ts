import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CANONICAL_MAP } from './subject.js';

/**
 * The client cannot import the server's subject table (separate tsconfigs, Vite
 * bundling versus Node ESM), so `client/src/lib/pupilItems.ts` carries a
 * hand-ported copy of `CANONICAL_MAP` (`SUBJECT_ALIASES`). A dropped alias is
 * silent data loss: the subject stops matching and the pupil's grid renders
 * empty rather than wrong. This test fails the moment the two tables disagree,
 * in either direction.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSource = readFileSync(
  path.resolve(here, '../../../client/src/lib/pupilItems.ts'),
  'utf-8',
);

/** Mirrors `normalizeSubjectKey` in the client copy. */
function normalizeClientKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

function clientAliases(): Map<string, string> {
  const start = clientSource.indexOf('const SUBJECT_ALIASES');
  const end = clientSource.indexOf('};', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = clientSource.slice(start, end);
  const map = new Map<string, string>();
  for (const m of block.matchAll(/([a-z0-9]+):\s*'([A-Z0-9]+)'/g)) {
    map.set(m[1]!, m[2]!);
  }
  return map;
}

describe('client SUBJECT_ALIASES stays in sync with server CANONICAL_MAP', () => {
  const client = clientAliases();

  it('extracted both tables (guard against a silent regex no-op)', () => {
    expect(client.size).toBeGreaterThan(50);
    expect(Object.keys(CANONICAL_MAP).length).toBeGreaterThan(50);
  });

  it('every server alias resolves to the same code in the client table', () => {
    const mismatches: string[] = [];
    for (const [alias, entry] of Object.entries(CANONICAL_MAP)) {
      const key = normalizeClientKey(alias);
      const clientCode = client.get(key);
      if (clientCode !== entry.code) {
        mismatches.push(
          `${alias} -> ${key}: server ${entry.code}, client ${clientCode ?? 'missing'}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('every client alias comes from a server alias (no client-only entries)', () => {
    const serverKeys = new Set(Object.keys(CANONICAL_MAP).map(normalizeClientKey));
    const extra = [...client.keys()].filter((key) => !serverKeys.has(key));
    expect(extra).toEqual([]);
  });
});
