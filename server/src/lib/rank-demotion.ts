import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { behaviorCards } from '../db/schema.js';
import { getLatestRound } from './rounds.js';

export interface RoundWindow {
  startsOn?: Date | string | null;
  endsOn?: Date | string | null;
}

export interface CardDemotionInput {
  cardType: string;
  createdAt?: Date | string | null;
  revokedAt?: Date | string | null;
}

function toTimestampMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Whether a card falls within the observation round window. */
export function isCardInRound(
  createdAt: Date | string | null | undefined,
  round: RoundWindow | null | undefined,
): boolean {
  const startMs = toTimestampMs(round?.startsOn);
  const endMs = toTimestampMs(round?.endsOn);
  if (startMs === null && endMs === null) return true;
  const createdMs = toTimestampMs(createdAt);
  if (createdMs === null) return false;
  if (startMs !== null && createdMs < startMs) return false;
  if (endMs !== null && createdMs > endMs) return false;
  return true;
}

/**
 * Rank demotion from cards.
 *
 * A red card is one step. Every `YELLOW_CARD_RANK_LOSS_THRESHOLD` active yellow
 * cards in the current observation round add another step. The steps combine and
 * never demote below Lehrling.
 */
export function yellowDemotionSteps(
  yellowCount: number,
  threshold: number = config.yellowCardRankLossThreshold,
): number {
  if (threshold <= 0) return 0;
  return Math.floor(Math.max(0, yellowCount) / threshold);
}

export function totalCardDemotionSteps(
  redCardCount: number,
  yellowCount: number,
  threshold: number = config.yellowCardRankLossThreshold,
): number {
  return (redCardCount > 0 ? 1 : 0) + yellowDemotionSteps(yellowCount, threshold);
}

/**
 * Card demotion steps applicable to a pupil's rank.
 *
 * When a conference decision has not yet been confirmed (`confirmedAt == null`),
 * all active red cards and active in-round yellow cards apply.
 *
 * Once the conference confirms a rank at `confirmedAt`, cards already active at
 * `confirmedAt` were part of the conference suggestion and must not demote the
 * confirmed rank a second time. Only demotion thresholds reached *after*
 * `confirmedAt` (a post-confirmation red card, or crossing the yellow-card
 * threshold into a new step after `confirmedAt`) reduce the rank further.
 */
export function effectiveCardDemotionSteps(
  cards: ReadonlyArray<CardDemotionInput>,
  round: RoundWindow | null | undefined,
  confirmedAt?: Date | string | null,
  threshold: number = config.yellowCardRankLossThreshold,
): number {
  const active = cards.filter((c) => c.revokedAt == null);
  const confirmMs = toTimestampMs(confirmedAt);

  if (confirmMs === null) {
    const redCount = active.filter((c) => c.cardType === 'red').length;
    const yellowInRoundCount = active.filter(
      (c) => c.cardType === 'yellow' && isCardInRound(c.createdAt, round),
    ).length;
    return totalCardDemotionSteps(redCount, yellowInRoundCount, threshold);
  }

  const redAfterConfirm = active.filter((c) => {
    if (c.cardType !== 'red') return false;
    const createdMs = toTimestampMs(c.createdAt);
    return createdMs !== null && createdMs > confirmMs;
  }).length;

  const yellowInRound = active.filter(
    (c) => c.cardType === 'yellow' && isCardInRound(c.createdAt, round),
  );
  const yellowAtConfirmCount = yellowInRound.filter((c) => {
    const createdMs = toTimestampMs(c.createdAt);
    return createdMs !== null && createdMs <= confirmMs;
  }).length;

  const yellowStepsSinceConfirm = Math.max(
    0,
    yellowDemotionSteps(yellowInRound.length, threshold) -
      yellowDemotionSteps(yellowAtConfirmCount, threshold),
  );

  return (redAfterConfirm > 0 ? 1 : 0) + yellowStepsSinceConfirm;
}

/** Active yellow cards for a pupil in the current observation round. */
export async function countActiveYellowCards(
  pupilId: number,
  classId: number,
): Promise<number> {
  const round = await getLatestRound();
  const conditions = [
    eq(behaviorCards.pupilId, pupilId),
    eq(behaviorCards.classId, classId),
    eq(behaviorCards.cardType, 'yellow'),
    isNull(behaviorCards.revokedAt),
  ];
  if (round?.startsOn) conditions.push(gte(behaviorCards.createdAt, round.startsOn));
  if (round?.endsOn) conditions.push(lte(behaviorCards.createdAt, round.endsOn));

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(behaviorCards)
    .where(and(...conditions));
  return row?.count ?? 0;
}
