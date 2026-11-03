import { beforeEach, describe, expect, it } from 'vitest';

import {
  resetActiveRubricConfig,
  setActiveRubricConfig,
  activeRankThresholds,
  activeRubricItemCount,
  quickGradeFills,
} from './rubricConfig';

describe('active rubric config', () => {
  beforeEach(() => {
    resetActiveRubricConfig();
  });

  it('falls back to the shipped thresholds and 18 items before any response', () => {
    // The very first render, and every test that renders without a roster
    // payload, still has to produce the same numbers as before this wiring.
    expect(activeRankThresholds()).toEqual({ meister: 14, geselle: 8 });
    expect(activeRubricItemCount()).toBe(18);
  });

  it('adopts the thresholds the server delivered', () => {
    setActiveRubricConfig({ meister: 20, geselle: 12, itemCount: 24, aggregation: 'total' });

    expect(activeRankThresholds()).toEqual({ meister: 20, geselle: 12 });
    expect(activeRubricItemCount()).toBe(24);
  });

  it('ignores a payload missing a threshold rather than scoring against undefined', () => {
    // A deployment that answers with a partial config must not turn every
    // comparison into `positiveCount >= undefined`, which is always false and
    // would silently demote the whole class to Lehrling.
    setActiveRubricConfig({ meister: 20, itemCount: 24 });

    expect(activeRankThresholds()).toEqual({ meister: 14, geselle: 8 });
  });

  it('ignores a threshold that cannot order the ranks', () => {
    // The server validates meister > geselle (server/src/config.ts:350-357).
    // A response that violates it is unusable, so the last good config stands.
    setActiveRubricConfig({ meister: 8, geselle: 14, itemCount: 18, aggregation: 'total' });

    expect(activeRankThresholds()).toEqual({ meister: 14, geselle: 8 });
  });

  it('ignores a non-positive item count', () => {
    setActiveRubricConfig({ meister: 14, geselle: 8, itemCount: 0, aggregation: 'total' });

    expect(activeRubricItemCount()).toBe(18);
  });

  it('keeps the previous config when a later response carries none', () => {
    setActiveRubricConfig({ meister: 20, geselle: 12, itemCount: 24, aggregation: 'total' });
    setActiveRubricConfig(null);

    expect(activeRankThresholds()).toEqual({ meister: 20, geselle: 12 });
    expect(activeRubricItemCount()).toBe(24);
  });

  it('accepts a lowered configuration as readily as a raised one', () => {
    // Both directions are real deployments: a school may soften the bar as
    // easily as raise it, and only one of the two directions regresses.
    setActiveRubricConfig({ meister: 10, geselle: 5, itemCount: 18, aggregation: 'normalized' });

    expect(activeRankThresholds()).toEqual({ meister: 10, geselle: 5 });
  });

  it('tolerates a fully empty payload', () => {
    setActiveRubricConfig({});

    expect(activeRankThresholds()).toEqual({ meister: 14, geselle: 8 });
    expect(activeRubricItemCount()).toBe(18);
  });
});

describe('quickGradeFills', () => {
  beforeEach(() => {
    resetActiveRubricConfig();
  });

  const ITEMS_18 = 18;

  it('fills exactly the Meister threshold with crowns so the rank lands on the bar', () => {
    // A one-click Meister must clear the meister threshold and nothing more:
    // padding beyond it would make the teacher's own raster look inflated.
    const fills = quickGradeFills('Meister', ITEMS_18);

    expect(fills.filter((f) => f === 'crown')).toHaveLength(14);
    expect(fills.every((f) => f === 'crown' || f === 'smile')).toBe(true);
  });

  it('fills a Geselle strictly between the two thresholds', () => {
    // Exactly `geselle` positives would put one accidental edit below the bar
    // and flip the computed rank to Lehrling, so the fill carries mid-band slack.
    const fills = quickGradeFills('Geselle', ITEMS_18);

    expect(fills.filter((f) => f === 'smile')).toHaveLength(11);
    expect(fills[10]).toBe('smile');
    expect(fills[11]).toBe('struggle');
  });

  it('fills a Lehrling comfortably below the Geselle threshold', () => {
    const fills = quickGradeFills('Lehrling', ITEMS_18);

    expect(fills.filter((f) => f === 'smile')).toHaveLength(4);
    expect(fills[3]).toBe('smile');
    expect(fills[4]).toBe('struggle');
  });

  it('derives the fills from a raised threshold pair', () => {
    setActiveRubricConfig({ meister: 20, geselle: 12, itemCount: 24, aggregation: 'total' });

    // 20 crowns, then the mid-band slack at 12 + 4 = 16, then half of 12.
    expect(quickGradeFills('Meister', 24).filter((f) => f === 'crown')).toHaveLength(20);
    expect(quickGradeFills('Geselle', 24).filter((f) => f === 'smile')).toHaveLength(16);
    expect(quickGradeFills('Lehrling', 24).filter((f) => f === 'smile')).toHaveLength(6);
  });

  it('derives the fills from a lowered threshold pair', () => {
    setActiveRubricConfig({ meister: 10, geselle: 5, itemCount: 18, aggregation: 'total' });

    expect(quickGradeFills('Meister', 18).filter((f) => f === 'crown')).toHaveLength(10);
    expect(quickGradeFills('Geselle', 18).filter((f) => f === 'smile')).toHaveLength(7);
    expect(quickGradeFills('Lehrling', 18).filter((f) => f === 'smile')).toHaveLength(2);
  });

  it('never produces a fill that scores a different rank than the one clicked', () => {
    // The strongest property: whatever the configuration, the raster a
    // one-click grade produces must come back as that same rank.
    for (const [meister, geselle] of [[14, 8], [20, 12], [10, 5], [30, 20]]) {
      setActiveRubricConfig({ meister, geselle, itemCount: 30, aggregation: 'total' });
      for (const rank of ['Lehrling', 'Geselle', 'Meister'] as const) {
        const fills = quickGradeFills(rank, 30);
        const positives = fills.filter((f) => f !== 'struggle').length;
        const expected = positives >= meister ? 'Meister' : positives >= geselle ? 'Geselle' : 'Lehrling';
        expect(expected).toBe(rank);
      }
    }
  });

  it('clamps the fill to the number of items that exist', () => {
    // A rubric with fewer items than the meister threshold still fills every
    // cell; the resulting count is simply whatever the raster can hold.
    const fills = quickGradeFills('Meister', 6);

    expect(fills).toHaveLength(6);
    expect(fills.every((f) => f === 'crown')).toBe(true);
  });
});
