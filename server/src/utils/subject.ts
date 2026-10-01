export interface NormalizedSubject {
  code: 'D' | 'M' | 'E' | string;
  name: string;
  isCoreSmile: boolean;
}

export function normalizeSubject(rawName: string): NormalizedSubject {
  const s = rawName.trim().toLowerCase();
  if (s === 'deutsch' || s === 'smile deutsch' || s === 'd' || s === 'sd') {
    return { code: 'D', name: 'Deutsch (D / SD)', isCoreSmile: true };
  }
  if (s === 'englisch' || s === 'smile english' || s === 'e' || s === 'se') {
    return { code: 'E', name: 'Englisch (E / SE)', isCoreSmile: true };
  }
  if (s === 'mathematik' || s === 'smile mathematik' || s === 'm' || s === 'sm') {
    return { code: 'M', name: 'Mathematik (M / SM)', isCoreSmile: true };
  }
  return {
    code: rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
    name: rawName.trim(),
    isCoreSmile: false,
  };
}
