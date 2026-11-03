/**
 * Shared `limit` / `offset` query parsing for list endpoints.
 *
 * Contract (identical for every list route):
 *  - Both parameters are optional. Omitting them yields `defaultLimit` (100 unless a
 *    route states otherwise) and offset 0, so a client that sends no parameters gets the
 *    same array shape it always did, bounded by the default.
 *  - `limit` above `maxLimit` is clamped down to `maxLimit`, not rejected.
 *  - `limit` must be an integer >= 1, `offset` an integer >= 0. Anything else
 *    (empty, signed, fractional, non-numeric, repeated as an array) is rejected so the
 *    caller can answer 400 with the German message returned here.
 */

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

/** Largest offset accepted; keeps the value well inside what PostgreSQL OFFSET takes. */
export const MAX_PAGE_OFFSET = 2_147_483_647;

/** Digits only, no sign, whitespace or decimal point. Length keeps the value a safe integer. */
const DIGITS = /^[0-9]{1,15}$/;

export interface PageRequest {
  limit: number;
  offset: number;
}

export interface PageOptions {
  /** Used when `limit` is absent. Defaults to {@link DEFAULT_PAGE_LIMIT}. */
  defaultLimit?: number;
  /** Upper bound; larger requested values are clamped to it. Defaults to {@link MAX_PAGE_LIMIT}. */
  maxLimit?: number;
}

export type PageParseResult =
  | { ok: true; page: PageRequest }
  | { ok: false; error: string };

const LIMIT_ERROR = 'Ungültiger Wert für "limit": eine ganze Zahl ab 1 wird erwartet.';
const OFFSET_ERROR = 'Ungültiger Wert für "offset": eine ganze Zahl ab 0 wird erwartet.';

/** Returns the non-negative integer for a digit string or safe integer, otherwise null. */
function readWholeNumber(raw: unknown, max: number): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 && raw <= max ? raw : null;
  }
  if (typeof raw === 'string' && DIGITS.test(raw)) {
    const parsed = Number(raw);
    return parsed <= max ? parsed : null;
  }
  return null;
}

/**
 * Parse `limit` and `offset` from a request's query object.
 *
 * Pure: it never touches the reply. Routes call it and answer 400 with `error` when
 * `ok` is false.
 */
export function parsePageParams(query: unknown, options: PageOptions = {}): PageParseResult {
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_PAGE_LIMIT;
  const params = (query !== null && typeof query === 'object' ? query : {}) as Record<string, unknown>;

  let limit = Math.min(defaultLimit, maxLimit);
  if (params.limit !== undefined) {
    const requested = readWholeNumber(params.limit, Number.MAX_SAFE_INTEGER);
    if (requested === null || requested < 1) return { ok: false, error: LIMIT_ERROR };
    limit = Math.min(requested, maxLimit);
  }

  let offset = 0;
  if (params.offset !== undefined) {
    const requested = readWholeNumber(params.offset, MAX_PAGE_OFFSET);
    if (requested === null) return { ok: false, error: OFFSET_ERROR };
    offset = requested;
  }

  return { ok: true, page: { limit, offset } };
}

/** Slice an already-loaded array to the requested page. */
export function paginate<T>(items: readonly T[], page: PageRequest): T[] {
  return items.slice(page.offset, page.offset + page.limit);
}
