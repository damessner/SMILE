/**
 * Canonical tally for active behaviour cards and Lernwerkstatt incidents.
 *
 * Cool-Downs insert a note-only `behavior_cards` row (`card_type = 'cooldown'`) so the
 * card drawer can display them alongside cards, plus a `timeout_incidents` row
 * (`kind = 'cooldown'`) for Lernwerkstatt visibility. Overview and statistics endpoints must
 * count `cooldown` from `timeout_incidents` only, matching the weekly digest.
 */
export interface BehaviorCounts {
  green: number;
  yellow: number;
  red: number;
  timeout: number;
  cooldown: number;
}

export function tallyBehaviorCounts(
  cards: ReadonlyArray<{ cardType: string }>,
  incidents: ReadonlyArray<{ kind?: string | null }>,
): BehaviorCounts {
  let green = 0;
  let yellow = 0;
  let red = 0;
  let timeout = 0;
  let cooldown = 0;

  for (const card of cards) {
    if (card.cardType === 'green') green += 1;
    else if (card.cardType === 'yellow') yellow += 1;
    else if (card.cardType === 'red') red += 1;
  }

  for (const incident of incidents) {
    if (incident.kind === 'cooldown') cooldown += 1;
    else if (incident.kind === 'timeout' || incident.kind == null) timeout += 1;
  }

  return { green, yellow, red, timeout, cooldown };
}
