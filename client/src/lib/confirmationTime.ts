/**
 * How a recorded conference decision is labelled in the UI.
 *
 * The missing case matters: `confirmedAt` is null when the instant was never written,
 * and rendering today's date there asserts that the decision was taken now. That is a
 * different claim from "we do not know when", which is what the absence actually means.
 */
export function formatConfirmationTimestamp(dateStr?: string | null): string {
  if (!dateStr) {
    return 'Zeitpunkt nicht gespeichert';
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) {
    return 'Beschluss erfasst';
  }
  return `${parsed.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${parsed.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}