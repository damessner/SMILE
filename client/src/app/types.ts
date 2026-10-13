export type AppTab = 'schulalltag' | 'bewertung' | 'statistics';

/** The pupil whose card drawer is open. */
export interface CardDrawerTarget {
  pupilId: number;
  name: string;
}
