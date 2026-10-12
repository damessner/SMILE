import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, paginate, parsePageParams } from './pagination.js';

describe('parsePageParams', () => {
  it('uses limit 100 and offset 0 when the parameters are absent', () => {
    expect(parsePageParams({})).toEqual({ ok: true, page: { limit: 100, offset: 0 } });
    expect(parsePageParams(undefined)).toEqual({ ok: true, page: { limit: 100, offset: 0 } });
    expect(DEFAULT_PAGE_LIMIT).toBe(100);
  });

  it('accepts valid limit and offset values from the query string', () => {
    expect(parsePageParams({ limit: '25', offset: '50' })).toEqual({
      ok: true,
      page: { limit: 25, offset: 50 },
    });
    expect(parsePageParams({ limit: '1', offset: '0' })).toEqual({
      ok: true,
      page: { limit: 1, offset: 0 },
    });
  });

  it('accepts the maximum limit exactly', () => {
    expect(parsePageParams({ limit: String(MAX_PAGE_LIMIT) })).toEqual({
      ok: true,
      page: { limit: 500, offset: 0 },
    });
  });

  it('clamps a limit above the maximum down to 500 instead of rejecting it', () => {
    expect(parsePageParams({ limit: '501' })).toEqual({ ok: true, page: { limit: 500, offset: 0 } });
    expect(parsePageParams({ limit: '999999999' })).toEqual({
      ok: true,
      page: { limit: 500, offset: 0 },
    });
  });

  it('honours per-route default and maximum options', () => {
    expect(parsePageParams({}, { defaultLimit: 50 })).toEqual({
      ok: true,
      page: { limit: 50, offset: 0 },
    });
    expect(parsePageParams({ limit: '80' }, { maxLimit: 60 })).toEqual({
      ok: true,
      page: { limit: 60, offset: 0 },
    });
  });

  it.each([
    ['limit zero', { limit: '0' }],
    ['negative limit', { limit: '-5' }],
    ['fractional limit', { limit: '2.5' }],
    ['non-numeric limit', { limit: 'abc' }],
    ['trailing text in limit', { limit: '10abc' }],
    ['empty limit', { limit: '' }],
    ['repeated limit', { limit: ['1', '2'] }],
    ['negative offset', { offset: '-1' }],
    ['fractional offset', { offset: '1.5' }],
    ['non-numeric offset', { offset: 'x' }],
    ['empty offset', { offset: '' }],
    ['offset beyond the PostgreSQL range', { offset: '2147483648' }],
  ])('rejects %s', (_label, query) => {
    const result = parsePageParams(query);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^Ungültiger Wert für "(limit|offset)"/);
    }
  });
});

describe('paginate', () => {
  it('returns the requested window of an in-memory list', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(paginate(items, { limit: 2, offset: 0 })).toEqual(['a', 'b']);
    expect(paginate(items, { limit: 2, offset: 2 })).toEqual(['c', 'd']);
    expect(paginate(items, { limit: 2, offset: 4 })).toEqual(['e']);
    expect(paginate(items, { limit: 2, offset: 10 })).toEqual([]);
  });
});
