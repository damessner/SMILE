import { describe, expect, it } from 'vitest';
import {
  effectiveCardDemotionSteps,
  isCardInRound,
  totalCardDemotionSteps,
  yellowDemotionSteps,
} from './rank-demotion.js';

describe('yellow card rank demotion', () => {
  it('adds one step at 3, 6, 9 ... yellow cards', () => {
    expect(yellowDemotionSteps(0, 3)).toBe(0);
    expect(yellowDemotionSteps(2, 3)).toBe(0);
    expect(yellowDemotionSteps(3, 3)).toBe(1);
    expect(yellowDemotionSteps(5, 3)).toBe(1);
    expect(yellowDemotionSteps(6, 3)).toBe(2);
    expect(yellowDemotionSteps(9, 3)).toBe(3);
  });

  it('combines yellow steps with an active red card', () => {
    expect(totalCardDemotionSteps(0, 0, 3)).toBe(0);
    expect(totalCardDemotionSteps(1, 0, 3)).toBe(1);
    expect(totalCardDemotionSteps(0, 3, 3)).toBe(1);
    expect(totalCardDemotionSteps(1, 3, 3)).toBe(2);
    expect(totalCardDemotionSteps(1, 6, 3)).toBe(3);
  });
});

describe('effectiveCardDemotionSteps', () => {
  const round = {
    startsOn: new Date('2026-09-14T00:00:00Z'),
    endsOn: new Date('2027-02-15T00:00:00Z'),
  };
  const confirmedAt = new Date('2026-11-03T13:25:35Z');

  it('applies 3 yellow cards issued after conference confirmation', () => {
    const cards = [
      { cardType: 'yellow', createdAt: new Date('2026-11-04T07:55:10Z') },
      { cardType: 'yellow', createdAt: new Date('2026-11-06T09:41:27Z') },
      { cardType: 'yellow', createdAt: new Date('2026-11-17T06:51:59Z') },
      { cardType: 'green', createdAt: new Date('2026-11-16T11:25:34Z') },
      // Revoked card must not count.
      {
        cardType: 'yellow',
        createdAt: new Date('2026-11-04T07:47:39Z'),
        revokedAt: new Date('2026-11-04T07:54:30Z'),
      },
    ];
    expect(effectiveCardDemotionSteps(cards, round, confirmedAt, 3)).toBe(1);
  });

  it('applies a red card issued after conference confirmation', () => {
    const cards = [{ cardType: 'red', createdAt: new Date('2026-11-12T09:10:32Z') }];
    expect(effectiveCardDemotionSteps(cards, round, confirmedAt, 3)).toBe(1);
  });

  it('does not double-demote for cards already active at confirmation time', () => {
    const cards = [
      { cardType: 'red', createdAt: new Date('2026-10-20T10:00:00Z') },
      { cardType: 'yellow', createdAt: new Date('2026-10-21T10:00:00Z') },
      { cardType: 'yellow', createdAt: new Date('2026-10-22T10:00:00Z') },
      { cardType: 'yellow', createdAt: new Date('2026-10-23T10:00:00Z') },
    ];
    expect(effectiveCardDemotionSteps(cards, round, confirmedAt, 3)).toBe(0);
  });

  it('counts cumulative yellow cards across confirmation when crossing threshold post-conference', () => {
    // 2 yellows before conference (0 steps at confirmation) + 1 yellow after = 3 -> 1 step.
    const cards = [
      { cardType: 'yellow', createdAt: new Date('2026-10-20T10:00:00Z') },
      { cardType: 'yellow', createdAt: new Date('2026-10-25T10:00:00Z') },
      { cardType: 'yellow', createdAt: new Date('2026-11-05T10:00:00Z') },
    ];
    expect(effectiveCardDemotionSteps(cards, round, confirmedAt, 3)).toBe(1);
  });

  it('applies a post-confirmation red card even if a prior red card existed before confirmation', () => {
    const cards = [
      { cardType: 'red', createdAt: new Date('2026-10-20T10:00:00Z') },
      { cardType: 'red', createdAt: new Date('2026-11-12T10:00:00Z') },
    ];
    expect(effectiveCardDemotionSteps(cards, round, confirmedAt, 3)).toBe(1);
  });

  it('counts all in-round cards when no conference decision is confirmed yet', () => {
    const cards = [
      { cardType: 'yellow', createdAt: new Date('2026-11-04T07:55:10Z') },
      { cardType: 'yellow', createdAt: new Date('2026-11-06T09:41:27Z') },
      { cardType: 'yellow', createdAt: new Date('2026-11-17T06:51:59Z') },
      { cardType: 'yellow', createdAt: new Date('2025-11-01T10:00:00Z') }, // out of round
    ];
    expect(effectiveCardDemotionSteps(cards, round, null, 3)).toBe(1);
    expect(isCardInRound(new Date('2025-11-01T10:00:00Z'), round)).toBe(false);
  });
});
