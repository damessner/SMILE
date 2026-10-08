export interface NormalizedSubject {
  code: 'D' | 'M' | 'E' | string;
  name: string;
  isCoreSmile: boolean;
}

const CANONICAL_MAP: Record<string, { code: string; name: string; isCoreSmile: boolean }> = {
  // Core SMILE subjects (German, English, Math)
  'd': { code: 'D', name: 'Deutsch', isCoreSmile: true },
  'sd': { code: 'D', name: 'Deutsch', isCoreSmile: true },
  'deutsch': { code: 'D', name: 'Deutsch', isCoreSmile: true },
  'smile deutsch': { code: 'D', name: 'Deutsch', isCoreSmile: true },
  'smile_deutsch': { code: 'D', name: 'Deutsch', isCoreSmile: true },

  'e': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'se': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'englisch': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'english': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'smile englisch': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'smile english': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'smile_englisch': { code: 'E', name: 'Englisch', isCoreSmile: true },
  'smile_english': { code: 'E', name: 'Englisch', isCoreSmile: true },

  'm': { code: 'M', name: 'Mathematik', isCoreSmile: true },
  'sm': { code: 'M', name: 'Mathematik', isCoreSmile: true },
  'mathematik': { code: 'M', name: 'Mathematik', isCoreSmile: true },
  'smile mathematik': { code: 'M', name: 'Mathematik', isCoreSmile: true },
  'smile_mathematik': { code: 'M', name: 'Mathematik', isCoreSmile: true },

  // Non-core subjects (WebUntis short codes and administrative full names)
  'bo': { code: 'BO', name: 'Berufsorientierung', isCoreSmile: false },
  'berufsorientierung': { code: 'BO', name: 'Berufsorientierung', isCoreSmile: false },

  'ph': { code: 'PH', name: 'Physik', isCoreSmile: false },
  'physik': { code: 'PH', name: 'Physik', isCoreSmile: false },

  'mus': { code: 'MUS', name: 'Musik', isCoreSmile: false },
  'me': { code: 'MUS', name: 'Musik', isCoreSmile: false },
  'musik': { code: 'MUS', name: 'Musik', isCoreSmile: false },
  'musikerziehung': { code: 'MUS', name: 'Musik', isCoreSmile: false },

  'tud': { code: 'TUD', name: 'Technik und Design', isCoreSmile: false },
  'tw': { code: 'TUD', name: 'Technik und Design', isCoreSmile: false },
  'txw': { code: 'TUD', name: 'Technik und Design', isCoreSmile: false },
  'technik und design': { code: 'TUD', name: 'Technik und Design', isCoreSmile: false },
  'technisches werken': { code: 'TUD', name: 'Technik und Design', isCoreSmile: false },
  'textiles werken': { code: 'TUD', name: 'Technik und Design', isCoreSmile: false },

  'bub': { code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false },
  'sbub': { code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false },
  'biologie und umweltbildung': { code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false },
  'smile biologie': { code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false },
  'biologie': { code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false },

  'bs': { code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false },
  'bsp': { code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false },
  'bspk': { code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false },
  'bspm': { code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false },
  'bewegung und sport': { code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false },
  'leibesuebungen': { code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false },

  'ch': { code: 'CH', name: 'Chemie', isCoreSmile: false },
  'chemie': { code: 'CH', name: 'Chemie', isCoreSmile: false },

  'diggb': { code: 'DIGGB', name: 'Digitale Grundbildung', isCoreSmile: false },
  'dig': { code: 'DIGGB', name: 'Digitale Grundbildung', isCoreSmile: false },
  'digitale grundbildung': { code: 'DIGGB', name: 'Digitale Grundbildung', isCoreSmile: false },
  'informatik': { code: 'DIGGB', name: 'Digitale Grundbildung', isCoreSmile: false },

  'eh': { code: 'EH', name: 'Ernährung und Haushalt', isCoreSmile: false },
  'ernährung und haushalt': { code: 'EH', name: 'Ernährung und Haushalt', isCoreSmile: false },
  'ernaehrung und haushalt': { code: 'EH', name: 'Ernährung und Haushalt', isCoreSmile: false },
  'haushaltsökonomie': { code: 'EH', name: 'Ernährung und Haushalt', isCoreSmile: false },

  'gpb': { code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false },
  'sgpb': { code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false },
  'geschichte und politische bildung': { code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false },
  'smile geschichte': { code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false },
  'geschichte': { code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false },

  'gwb': { code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false },
  'sgwb': { code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false },
  'geographie und wirtschaftliche bildung': { code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false },
  'smile geographie': { code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false },
  'geographie': { code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false },

  'gz': { code: 'GZ', name: 'Geometrisches Zeichnen', isCoreSmile: false },
  'geometrisches zeichnen': { code: 'GZ', name: 'Geometrisches Zeichnen', isCoreSmile: false },

  'ital': { code: 'ITAL', name: 'Italienisch', isCoreSmile: false },
  'it': { code: 'ITAL', name: 'Italienisch', isCoreSmile: false },
  'italienisch': { code: 'ITAL', name: 'Italienisch', isCoreSmile: false },

  'kug': { code: 'KUG', name: 'Kunst und Gestaltung', isCoreSmile: false },
  'be': { code: 'KUG', name: 'Kunst und Gestaltung', isCoreSmile: false },
  'kunst und gestaltung': { code: 'KUG', name: 'Kunst und Gestaltung', isCoreSmile: false },
  'bildnerische erziehung': { code: 'KUG', name: 'Kunst und Gestaltung', isCoreSmile: false },

  'daz': { code: 'DAZ', name: 'Deutsch als Zweitsprache', isCoreSmile: false },
  'deutsch als zweitsprache': { code: 'DAZ', name: 'Deutsch als Zweitsprache', isCoreSmile: false },

  'rkath': { code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false },
  'r kath': { code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false },
  'rk': { code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false },
  'katholische religion': { code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false },
  'religion katholisch': { code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false },

  'risla': { code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false },
  'r isla': { code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false },
  'ri': { code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false },
  'islamische religion': { code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false },
  'religion islamisch': { code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false },

  'rev': { code: 'REV', name: 'Evangelische Religion', isCoreSmile: false },
  'r ev': { code: 'REV', name: 'Evangelische Religion', isCoreSmile: false },
  're': { code: 'REV', name: 'Evangelische Religion', isCoreSmile: false },
  'evangelische religion': { code: 'REV', name: 'Evangelische Religion', isCoreSmile: false },
  'religion evangelisch': { code: 'REV', name: 'Evangelische Religion', isCoreSmile: false },

  'bfud': { code: 'BFUD', name: 'Förderunterricht Deutsch', isCoreSmile: false },
  'förderunterricht deutsch': { code: 'BFUD', name: 'Förderunterricht Deutsch', isCoreSmile: false },
  'foerderunterricht deutsch': { code: 'BFUD', name: 'Förderunterricht Deutsch', isCoreSmile: false },

  'bfur': { code: 'BFUR', name: 'Förderunterricht Religion', isCoreSmile: false },
  'förderunterricht religion': { code: 'BFUR', name: 'Förderunterricht Religion', isCoreSmile: false },
  'foerderunterricht religion': { code: 'BFUR', name: 'Förderunterricht Religion', isCoreSmile: false },

  'bfum': { code: 'BFUM', name: 'Förderunterricht Mathematik', isCoreSmile: false },
  'förderunterricht mathematik': { code: 'BFUM', name: 'Förderunterricht Mathematik', isCoreSmile: false },
  'foerderunterricht mathematik': { code: 'BFUM', name: 'Förderunterricht Mathematik', isCoreSmile: false },

  'bfue': { code: 'BFUE', name: 'Förderunterricht Englisch', isCoreSmile: false },
  'förderunterricht englisch': { code: 'BFUE', name: 'Förderunterricht Englisch', isCoreSmile: false },
  'foerderunterricht englisch': { code: 'BFUE', name: 'Förderunterricht Englisch', isCoreSmile: false },

  'sl': { code: 'SL', name: 'Soziales Lernen', isCoreSmile: false },
  'soziales lernen': { code: 'SL', name: 'Soziales Lernen', isCoreSmile: false },

  'zi': { code: 'ZI', name: 'Zusatzförderung', isCoreSmile: false },
  'zusatzförderung': { code: 'ZI', name: 'Zusatzförderung', isCoreSmile: false },
  'zusatzfoerderung': { code: 'ZI', name: 'Zusatzförderung', isCoreSmile: false },

  'lw': { code: 'LW', name: 'Lernwerkstatt', isCoreSmile: false },
  'lernwerkstatt': { code: 'LW', name: 'Lernwerkstatt', isCoreSmile: false },
};

function lookupCanonical(value: string): NormalizedSubject | undefined {
  // Do not let Object.prototype keys (for example "constructor") masquerade as
  // known subjects. The alias table is data, not an object-property namespace.
  return Object.hasOwn(CANONICAL_MAP, value) ? CANONICAL_MAP[value] : undefined;
}

export function normalizeSubject(rawName: string): NormalizedSubject {
  if (!rawName) {
    return { code: 'UNKNOWN', name: 'Unbekannt', isCoreSmile: false };
  }

  const s = rawName.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  const sNoSpace = s.replace(/\s+/g, '');
  const sUnder = s.replace(/\s+/g, '_');

  const direct = lookupCanonical(s);
  if (direct) return direct;
  const withoutSpaces = lookupCanonical(sNoSpace);
  if (withoutSpaces) return withoutSpaces;
  const underscored = lookupCanonical(sUnder);
  if (underscored) return underscored;

  const sAscii = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const ascii = lookupCanonical(sAscii);
  if (ascii) return ascii;

  return {
    code: rawName.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
    name: rawName.trim(),
    isCoreSmile: false,
  };
}

/**
 * Strict write normalizer: returns the canonical subject if raw is recognized in the
 * alias table, or null for unknown subject strings / non-strings.
 */
export function normalizeKnownSubject(raw: unknown): NormalizedSubject | null {
  if (typeof raw !== 'string' || !raw.trim()) {
    return null;
  }

  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  const sNoSpace = s.replace(/\s+/g, '');
  const sUnder = s.replace(/\s+/g, '_');

  const direct = lookupCanonical(s);
  if (direct) return direct;
  const withoutSpaces = lookupCanonical(sNoSpace);
  if (withoutSpaces) return withoutSpaces;
  const underscored = lookupCanonical(sUnder);
  if (underscored) return underscored;

  const sAscii = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  const ascii = lookupCanonical(sAscii);
  if (ascii) return ascii;

  return null;
}
