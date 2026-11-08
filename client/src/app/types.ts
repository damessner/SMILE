export type AppTab = 'schulalltag' | 'webuntis' | 'statistics' | 'bewertung';

/** The pupil whose card drawer is open. */
export interface CardDrawerTarget {
  pupilId: number;
  name: string;
}
