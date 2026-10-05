import { describe, expect, it } from 'vitest';
import { BEHAVIOR_STAGES, computePupilBehaviorStage } from './behavior-stages.js';

describe('BEHAVIOR_STAGES definitions', () => {
  it('contains exactly 21 stages from -10 to +10', () => {
    expect(BEHAVIOR_STAGES).toHaveLength(21);
    const levels = BEHAVIOR_STAGES.map((s) => s.level);
    for (let i = -10; i <= 10; i++) {
      expect(levels).toContain(i);
    }
  });

  it('has the exact green peak: Fairness Award at +10 and Urkunde at +8', () => {
    const stage10 = BEHAVIOR_STAGES.find((s) => s.level === 10);
    expect(stage10?.title).toBe('Fairness Award');
    expect(stage10?.type).toBe('green');

    const stage8 = BEHAVIOR_STAGES.find((s) => s.level === 8);
    expect(stage8?.title).toBe('Urkunde');
  });

  it('has the exact red consequences: Mitteilungsheft at -3 and Direktion at -7', () => {
    const stageMinus3 = BEHAVIOR_STAGES.find((s) => s.level === -3);
    expect(stageMinus3?.title).toBe('Eintrag ins Mitteilungsheft');
    expect(stageMinus3?.type).toBe('red');

    const stageMinus7 = BEHAVIOR_STAGES.find((s) => s.level === -7);
    expect(stageMinus7?.title).toBe('Gespräch in der Direktion');
    expect(stageMinus7?.type).toBe('red');

    const stageMinus10 = BEHAVIOR_STAGES.find((s) => s.level === -10);
    expect(stageMinus10?.title).toBe('Suspendierung / Bildungsdirektion + Jugendamt');
  });
});

describe('computePupilBehaviorStage', () => {
  it('returns neutral stage 0 with Gut for zero cards', () => {
    const res = computePupilBehaviorStage(0, 0, 0, 0);
    expect(res.currentStage).toBe(0);
    expect(res.positiveStage).toBe(0);
    expect(res.consequenceStage).toBe(0);
    expect(res.behaviorGrade).toBe('Gut');
  });

  it('computes positive stage +1 for 1 green card', () => {
    const res = computePupilBehaviorStage(1, 0, 0, 0);
    expect(res.positiveStage).toBe(1);
    expect(res.currentStage).toBe(1);
    expect(res.stageInfo.title).toBe('Lob');
    expect(res.behaviorGrade).toBe('Gut');
  });

  it('computes positive stage +2 with Sehr gut for 2 green cards without warnings', () => {
    const res = computePupilBehaviorStage(2, 0, 0, 0);
    expect(res.positiveStage).toBe(2);
    expect(res.currentStage).toBe(2);
    expect(res.stageInfo.title).toBe('Gespräch Lehrkraft + Schüler/in');
    expect(res.behaviorGrade).toBe('Sehr gut');
  });

  it('computes positive stage +10 for 15+ green cards', () => {
    const res = computePupilBehaviorStage(16, 0, 0, 0);
    expect(res.positiveStage).toBe(10);
    expect(res.currentStage).toBe(10);
    expect(res.stageInfo.title).toBe('Fairness Award');
    expect(res.behaviorGrade).toBe('Sehr gut');
  });

  it('computes warning stage -1 for 1 yellow card', () => {
    const res = computePupilBehaviorStage(0, 1, 0, 0);
    expect(res.consequenceStage).toBe(-1);
    expect(res.currentStage).toBe(-1);
    expect(res.stageInfo.title).toBe('Ermahnung und Zurechtweisung');
    expect(res.behaviorGrade).toBe('Gut');
  });

  it('computes consequence stage -3 (Mitteilungsheft) for 3 yellow cards', () => {
    const res = computePupilBehaviorStage(0, 3, 0, 0);
    expect(res.consequenceStage).toBe(-3);
    expect(res.currentStage).toBe(-3);
    expect(res.stageInfo.title).toBe('Eintrag ins Mitteilungsheft');
    expect(res.behaviorGrade).toBe('Zufriedenstellend');
  });

  it('computes consequence stage -5 for 1 red card or 1 timeout', () => {
    const resRed = computePupilBehaviorStage(0, 0, 1, 0);
    expect(resRed.consequenceStage).toBe(-5);
    expect(resRed.stageInfo.title).toBe('Wiedergutmachung, Aufträge f.d. Gemeinschaft');
    expect(resRed.behaviorGrade).toBe('Wenig zufriedenstellend');

    const resTimeout = computePupilBehaviorStage(0, 0, 0, 1);
    expect(resTimeout.consequenceStage).toBe(-5);
  });

  it('computes consequence stage -7 (Direktion) for 3 timeouts', () => {
    const res = computePupilBehaviorStage(0, 0, 0, 3);
    expect(res.consequenceStage).toBe(-7);
    expect(res.currentStage).toBe(-7);
    expect(res.stageInfo.title).toBe('Gespräch in der Direktion');
    expect(res.behaviorGrade).toBe('Wenig zufriedenstellend');
  });

  it('computes consequence stage -10 for 9 timeouts', () => {
    const res = computePupilBehaviorStage(0, 0, 0, 9);
    expect(res.consequenceStage).toBe(-10);
    expect(res.currentStage).toBe(-10);
    expect(res.stageInfo.title).toBe('Suspendierung / Bildungsdirektion + Jugendamt');
    expect(res.behaviorGrade).toBe('Wenig zufriedenstellend');
  });

  it('resolves dominant stage correctly: serious consequence dominates positive points', () => {
    // 5 green cards (+5 Goodies) but 3 yellow cards (-3 Mitteilungsheft)
    const res = computePupilBehaviorStage(5, 3, 0, 0);
    expect(res.positiveStage).toBe(5);
    expect(res.consequenceStage).toBe(-3);
    expect(res.currentStage).toBe(-3); // Consequence dominates
    expect(res.behaviorGrade).toBe('Zufriedenstellend');
  });

  it('resolves dominant stage correctly: positive engagement dominates mild 1 yellow card', () => {
    // 4 green cards (+4) and 1 yellow card (-1)
    const res = computePupilBehaviorStage(4, 1, 0, 0);
    expect(res.positiveStage).toBe(4);
    expect(res.consequenceStage).toBe(-1);
    expect(res.currentStage).toBe(4); // Positive dominates mild 1 yellow
  });
});
