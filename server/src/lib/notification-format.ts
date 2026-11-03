import { normalizeSubject } from '../utils/subject.js';

/** Subject code plus the canonical display name, without duplicating a bare code. */
export function subjectLabel(code: string): string {
  const name = normalizeSubject(code).name;
  return name && name !== code ? `${code} (${name})` : code;
}

/** School-local timestamp for staff notifications. */
export function formatViennaTime(date: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Vienna',
  }).format(date);
}
