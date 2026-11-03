/**
 * Subject-scoped reads of a pupil's evaluation data.
 *
 * Every helper here is handed the subject codes that are *in scope* and reads
 * only those evaluations. It must never widen that scope on its own: the grid
 * renders one rubric per subject and the rank it computes from those cells is
 * submitted for the active subject.
 *
 * `BeobachtungsGrid` used to look through the active subject and then, if it
 * found nothing, scan every evaluation the pupil had in every subject. That
 * fallback showed one teacher another's ratings, fed them into the rank, and
 * paired the wrong evaluation's `version` with the active subject's write - so
 * the optimistic-concurrency guard matched zero rows and reported a conflict on
 * a cell nobody else had touched.
 */

/**
 * Alias -> canonical subject code, ported from `server/src/utils/subject.ts`
 * (`CANONICAL_MAP`, the authority for subject naming). Keys are pre-normalized
 * by `normalizeSubjectKey`; the 108 server aliases collapse to 95 distinct keys
 * because forms that differ only in separators or umlaut spelling resolve to
 * the same subject (`r kath`/`rkath`, `smile_deutsch`/`smile deutsch`,
 * `förderunterricht mathematik`/`foerderunterricht mathematik`, ...).
 *
 * This is a deliberate copy: the client cannot import from the server tree
 * (separate tsconfigs, Vite bundling versus Node ESM). Regenerate it from
 * `CANONICAL_MAP` whenever that table changes - a code dropped here stops that
 * subject from matching, and the pupil's grid renders empty rather than wrong.
 */
const SUBJECT_ALIASES: Record<string, string> = {
  // D - Deutsch
  d: 'D',
  sd: 'D',
  deutsch: 'D',
  smiledeutsch: 'D',
  bfud: 'D',
  foerderunterrichtdeutsch: 'D',
  besondererfoerderunterrichtdeutsch: 'D',
  // E - Englisch
  e: 'E',
  se: 'E',
  englisch: 'E',
  english: 'E',
  smileenglisch: 'E',
  smileenglish: 'E',
  // M - Mathematik
  m: 'M',
  sm: 'M',
  mathematik: 'M',
  smilemathematik: 'M',
  // BO - Berufsorientierung
  bo: 'BO',
  berufsorientierung: 'BO',
  // PH - Physik
  ph: 'PH',
  physik: 'PH',
  // MUS - Musik
  mus: 'MUS',
  me: 'MUS',
  musik: 'MUS',
  musikerziehung: 'MUS',
  // TUD - Technik und Design
  tud: 'TUD',
  tw: 'TUD',
  txw: 'TUD',
  technikunddesign: 'TUD',
  technischeswerken: 'TUD',
  textileswerken: 'TUD',
  // BUB - Biologie und Umweltbildung
  bub: 'BUB',
  sbub: 'BUB',
  biologieundumweltbildung: 'BUB',
  smilebiologie: 'BUB',
  biologie: 'BUB',
  // BS - Bewegung und Sport
  bs: 'BS',
  bsp: 'BS',
  bspk: 'BS',
  bspm: 'BS',
  bewegungundsport: 'BS',
  leibesuebungen: 'BS',
  // CH - Chemie
  ch: 'CH',
  chemie: 'CH',
  // DIGGB - Digitale Grundbildung
  diggb: 'DIGGB',
  dig: 'DIGGB',
  digitalegrundbildung: 'DIGGB',
  informatik: 'DIGGB',
  // EH - Ernährung und Haushalt
  eh: 'EH',
  ernaehrungundhaushalt: 'EH',
  haushaltsoekonomie: 'EH',
  // GPB - Geschichte und Politische Bildung
  gpb: 'GPB',
  sgpb: 'GPB',
  geschichteundpolitischebildung: 'GPB',
  smilegeschichte: 'GPB',
  geschichte: 'GPB',
  // GWB - Geographie und wirtschaftliche Bildung
  gwb: 'GWB',
  sgwb: 'GWB',
  geographieundwirtschaftlichebildung: 'GWB',
  smilegeographie: 'GWB',
  geographie: 'GWB',
  // GZ - Geometrisches Zeichnen
  gz: 'GZ',
  geometrischeszeichnen: 'GZ',
  // ITAL - Italienisch
  ital: 'ITAL',
  it: 'ITAL',
  italienisch: 'ITAL',
  // KUG - Kunst und Gestaltung
  kug: 'KUG',
  be: 'KUG',
  kunstundgestaltung: 'KUG',
  bildnerischeerziehung: 'KUG',
  // DAZ - Deutsch als Zweitsprache
  daz: 'DAZ',
  deutschalszweitsprache: 'DAZ',
  // RKATH - Katholische Religion
  rkath: 'RKATH',
  rk: 'RKATH',
  katholischereligion: 'RKATH',
  religionkatholisch: 'RKATH',
  // RISLA - Islamische Religion
  risla: 'RISLA',
  ri: 'RISLA',
  islamischereligion: 'RISLA',
  religionislamisch: 'RISLA',
  // REV - Evangelische Religion
  rev: 'REV',
  re: 'REV',
  evangelischereligion: 'REV',
  religionevangelisch: 'REV',
  // BFUR - Foerderunterricht Religion
  bfur: 'BFUR',
  foerderunterrichtreligion: 'BFUR',
  // BFUM - Foerderunterricht Mathematik
  bfum: 'BFUM',
  foerderunterrichtmathematik: 'BFUM',
  // BFUE - Foerderunterricht Englisch
  bfue: 'BFUE',
  foerderunterrichtenglisch: 'BFUE',
  // SL - Soziales Lernen
  sl: 'SL',
  sozialeslernen: 'SL',
  // ZI - Zusatzfoerderung
  zi: 'ZI',
  zusatzfoerderung: 'ZI',
  // LW - Lernwerkstatt
  lw: 'LW',
  lernwerkstatt: 'LW',
};

/**
 * Reduce a subject code or name to a comparable form: lowercase, transliterate
 * umlauts and eszett the way `server/src/utils/subject.ts` does, then drop
 * everything that is not alphanumeric. `SD`, `sd`, `smile-deutsch` and
 * `Deutsch` all end up as one comparable key.
 */
function normalizeSubjectKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/** Canonical code for a subject, falling back to the normalized raw value. */
function subjectIdentity(raw: string): string {
  const key = normalizeSubjectKey(raw);
  // hasOwn, not a plain lookup: an unknown subject must never resolve to a value
  // inherited from Object.prototype ('constructor' is the only such key that
  // survives normalization). Defence in depth - the answer is the same either
  // way, because both sides of a comparison normalize identically, so no test
  // through this module's API can distinguish the two.
  return Object.hasOwn(SUBJECT_ALIASES, key) ? SUBJECT_ALIASES[key] : key;
}

/**
 * True when two subject codes or names denote the same subject. Resolves both
 * sides through `SUBJECT_ALIASES`, so it is case-, whitespace- and
 * separator-insensitive and works on full German subject names as well as on
 * short codes.
 */
export function isSubjectMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return subjectIdentity(a) === subjectIdentity(b);
}

/**
 * Find one rubric item as the teacher sees it, searching only `codes` in order.
 * Returns null when none of the subjects in scope holds that item - deliberately,
 * so an unrated pupil shows empty cells rather than another subject's ratings.
 *
 * Alias-equivalent duplicate evaluations (legacy `SD` beside `D`, both permitted
 * by the unique key on the literal `subject_code` string) resolve to the newest
 * item by `updatedAt`, with equal timestamps tie-broken by the lexicographically
 * greater evaluation id - exactly the rule `scoreSubject` applies. The displayed
 * cell, the counted rating and the version a write carries must follow one rule.
 *
 * Generic in the item type so callers keep the full item (`rating`, `version`)
 * in the inferred return type.
 */
export function findItemForSubjects<T extends { itemKey: string; updatedAt?: string | Date }>(
  evaluations: Array<{ subjectCode: string; id?: string; items?: T[] }>,
  codes: string[],
  itemKey: string
): T | null {
  for (const code of codes) {
    const candidates: Array<{ item: T; timestamp: number; evaluationId: string }> = [];

    for (const evaluation of evaluations) {
      if (!isSubjectMatch(evaluation.subjectCode, code)) continue;
      for (const item of evaluation.items ?? []) {
        if (item.itemKey !== itemKey) continue;
        const ts = item.updatedAt ? new Date(item.updatedAt).getTime() : Number.NaN;
        candidates.push({
          item,
          timestamp: Number.isNaN(ts) ? 0 : ts,
          evaluationId: String(evaluation.id ?? ''),
        });
      }
    }

    if (candidates.length > 0) return pickNewest(candidates).item;
  }
  return null;
}

/**
 * The version a write for one subject must expect, or 0 when that subject has no
 * item row. Zero represents absence, so a concurrent first insert is not mistaken
 * for an allowed update of the row another writer has just created.
 *
 * Every subject's write must carry its own version. Resolving one version for
 * the whole grid and sending it for every subject makes the server's
 * `UPDATE ... WHERE version = $4` match zero rows for all but the first subject
 * - a CONFLICT on cells nobody else touched.
 */
export function itemVersionForSubject<T extends { itemKey: string; version: number }>(
  evaluations: Array<{ subjectCode: string; items?: T[] }>,
  code: string,
  itemKey: string
): number {
  // `??`, not `||`: version 0 is a legitimate value to send, and it is also the
  // one value that would match the row.
  return findItemForSubjects(evaluations, [code], itemKey)?.version ?? 0;
}

/**
 * True when the pupil has a submitted evaluation for `code`. Scoped to the one
 * subject: a pupil submitted in Deutsch is still open in Mathematik.
 */
export function hasSubmittedForSubject(
  evaluations: Array<{ subjectCode: string; isSubmitted?: boolean }>,
  code: string
): boolean {
  return evaluations.some((e) => isSubjectMatch(e.subjectCode, code) && e.isSubmitted);
}

/**
 * True when the pupil has a submitted evaluation for *every* subject in
 * `codes`. Callers that show one pupil across several subjects pass all of them
 * and get one verdict; callers showing a single subject pass just that one.
 *
 * An empty `codes` is false, never vacuously true: a caller holding no subject
 * set has not established that anything is done.
 *
 * The unscoped alternative - `evaluations.some(e => e.isSubmitted)` - marks a
 * pupil who submitted only Deutsch as done while their Mathematik evaluation
 * is still open, and the teacher skips them.
 */
export function isPupilFullySubmitted(
  evaluations: Array<{ subjectCode: string; isSubmitted?: boolean }>,
  codes: string[]
): boolean {
  return codes.length > 0 && codes.every((code) => hasSubmittedForSubject(evaluations, code));
}

export type AssessmentRank = 'Lehrling' | 'Geselle' | 'Meister';

export interface ScoredSubjectResult {
  subjectCode: string;
  positiveCount: number;
  totalRated: number;
  rank: AssessmentRank | null;
}

const POSITIVE_RATINGS = new Set(['crown', 'smile', '++', '+']);

/**
 * Newest `updatedAt` wins; equal timestamps tie-break by the lexicographically
 * greater evaluation id. Never by rating value, so a lookup cannot be biased
 * toward a positive or negative outcome. Shared by `scoreSubject` and
 * `findItemForSubjects` so display, scoring and write versions agree.
 */
function pickNewest<T extends { timestamp: number; evaluationId: string }>(candidates: T[]): T {
  return [...candidates].sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return b.evaluationId.localeCompare(a.evaluationId);
  })[0]!;
}

function isPositiveRating(rating?: string): boolean {
  return typeof rating === 'string' && POSITIVE_RATINGS.has(rating);
}

function isCountedRating(rating?: string): boolean {
  return typeof rating === 'string' && rating.trim() !== '' && rating !== 'n.b.';
}

/**
 * The rank boundaries a subject's raster is judged against.
 *
 * Delivered by the server (`GET /api/classes/:classId/pupils` carries them as
 * `rubricConfig`, sourced from `server/src/config.ts`), because those values are
 * what `server/src/lib/ranking.ts` uses to decide the rank it stores. Keeping a
 * second, client-side copy of the numbers is how a deployment that raised
 * RANK_THRESHOLD_MEISTER ends up showing Meister on screen while the server
 * still stores Lehrling.
 *
 * The definitions live in `./rubricConfig` alongside the active-value accessor
 * so there is exactly one place that knows the shipped defaults.
 */
export type { RankThresholds } from './rubricConfig';
export {
  DEFAULT_RANK_THRESHOLDS,
  activeRankThresholds,
  setActiveRubricConfig,
  resetActiveRubricConfig,
  type RubricConfig,
} from './rubricConfig';

import { activeRankThresholds, type RankThresholds } from './rubricConfig';

/**
 * Score observation items strictly for one canonical subject and bounded to the
 * configured rubric keys.
 *
 * Distinct rubric keys are counted at most once (bounded by [0, rubricItemKeys.length]).
 * Duplicate alias-equivalent evaluations and duplicate item keys resolve deterministically
 * by newest `updatedAt`; equal timestamps tie-break by lexicographically greater evaluation id.
 * An evaluation with no rated rubric items returns `rank: null` rather than an automatic Lehrling.
 */
export function scoreSubject(
  evaluations: Array<{
    subjectCode: string;
    id: string;
    items?: Array<{ itemKey: string; rating: string; updatedAt?: string | Date }>;
  }>,
  subjectCode: string,
  rubricItemKeys: readonly string[],
  // Evaluated at call time, not at module load: the roster response swaps the
  // live config in between renders.
  thresholds: RankThresholds = activeRankThresholds(),
): ScoredSubjectResult {
  const matchingEvals = evaluations.filter((e) => isSubjectMatch(e.subjectCode, subjectCode));
  const distinctKeys = [...new Set(rubricItemKeys)];

  let positiveCount = 0;
  let totalRated = 0;

  for (const key of distinctKeys) {
    const candidates: Array<{ rating: string; timestamp: number; evaluationId: string }> = [];

    for (const ev of matchingEvals) {
      if (!ev.items) continue;
      for (const it of ev.items) {
        if (it.itemKey === key) {
          const ts = it.updatedAt ? new Date(it.updatedAt).getTime() : 0;
          candidates.push({
            rating: it.rating,
            timestamp: Number.isNaN(ts) ? 0 : ts,
            evaluationId: String(ev.id ?? ''),
          });
        }
      }
    }

    if (candidates.length === 0) continue;

    const winner = pickNewest(candidates);
    if (isCountedRating(winner.rating)) {
      totalRated++;
      if (isPositiveRating(winner.rating)) {
        positiveCount++;
      }
    }
  }

  let rank: AssessmentRank | null = null;
  if (totalRated > 0) {
    if (positiveCount >= thresholds.meister) rank = 'Meister';
    else if (positiveCount >= thresholds.geselle) rank = 'Geselle';
    else rank = 'Lehrling';
  }

  return {
    // Canonical, not the raw argument: callers key rows and React lists by
    // subjectCode, and echoing an alias ('SD') would render one pupil as two
    // subjects next to 'D'.
    subjectCode: subjectIdentity(subjectCode),
    positiveCount,
    totalRated,
    rank,
  };
}

