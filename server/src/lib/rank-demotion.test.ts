import { describe, expect, it } from 'vitest';
import { totalCardDemotionSteps, yellowDemotionSteps } from './rank-demotion.js';

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
