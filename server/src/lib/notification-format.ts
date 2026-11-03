/** School-local timestamp for staff notifications. */
export function formatViennaTime(date: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  }).format(date);
}
