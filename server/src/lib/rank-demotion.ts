import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { behaviorCards } from '../db/schema.js';
import { getLatestRound } from './rounds.js';

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
