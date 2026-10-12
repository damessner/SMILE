import { describe, it, expect } from 'vitest';
import { normalizeKnownSubject, normalizeSubject } from './subject.js';

describe('normalizeSubject', () => {
  it('normalizes core German variants to canonical D', () => {
    expect(normalizeSubject('D')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeSubject('SD')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeSubject('Deutsch')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeSubject('SMILE Deutsch')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeSubject('deutsch')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
  });

  it('normalizes core English variants to canonical E', () => {
    expect(normalizeSubject('E')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
    expect(normalizeSubject('SE')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
    expect(normalizeSubject('Englisch')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
    expect(normalizeSubject('English')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
    expect(normalizeSubject('SMILE English')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
    expect(normalizeSubject('SMILE_ENGLISCH')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
  });

  it('normalizes core Math variants to canonical M', () => {
    expect(normalizeSubject('M')).toEqual({ code: 'M', name: 'Mathematik', isCoreSmile: true });
    expect(normalizeSubject('SM')).toEqual({ code: 'M', name: 'Mathematik', isCoreSmile: true });
    expect(normalizeSubject('Mathematik')).toEqual({ code: 'M', name: 'Mathematik', isCoreSmile: true });
    expect(normalizeSubject('SMILE Mathematik')).toEqual({ code: 'M', name: 'Mathematik', isCoreSmile: true });
  });

  it('normalizes non-core subjects from WebUntis short codes and full names', () => {
    // Berufsorientierung
    expect(normalizeSubject('BO')).toEqual({ code: 'BO', name: 'Berufsorientierung', isCoreSmile: false });
    expect(normalizeSubject('Berufsorientierung')).toEqual({ code: 'BO', name: 'Berufsorientierung', isCoreSmile: false });

    // Physik
    expect(normalizeSubject('PH')).toEqual({ code: 'PH', name: 'Physik', isCoreSmile: false });
    expect(normalizeSubject('Physik')).toEqual({ code: 'PH', name: 'Physik', isCoreSmile: false });

    // Musik
    expect(normalizeSubject('MUS')).toEqual({ code: 'MUS', name: 'Musik', isCoreSmile: false });
    expect(normalizeSubject('Musik')).toEqual({ code: 'MUS', name: 'Musik', isCoreSmile: false });

    // Technik und Design
    expect(normalizeSubject('TUD')).toEqual({ code: 'TUD', name: 'Technik und Design', isCoreSmile: false });
    expect(normalizeSubject('Technik und Design')).toEqual({ code: 'TUD', name: 'Technik und Design', isCoreSmile: false });

    // Biologie
    expect(normalizeSubject('BUB')).toEqual({ code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false });
    expect(normalizeSubject('SBUB')).toEqual({ code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false });
    expect(normalizeSubject('Biologie und Umweltbildung')).toEqual({ code: 'BUB', name: 'Biologie und Umweltbildung', isCoreSmile: false });

    // Sport
    expect(normalizeSubject('BS')).toEqual({ code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false });
    expect(normalizeSubject('Bewegung und Sport')).toEqual({ code: 'BS', name: 'Bewegung und Sport', isCoreSmile: false });

    // Digitale Grundbildung
    expect(normalizeSubject('DigGB')).toEqual({ code: 'DIGGB', name: 'Digitale Grundbildung', isCoreSmile: false });
    expect(normalizeSubject('Digitale Grundbildung')).toEqual({ code: 'DIGGB', name: 'Digitale Grundbildung', isCoreSmile: false });

    // Geschichte
    expect(normalizeSubject('GPB')).toEqual({ code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false });
    expect(normalizeSubject('Geschichte und Politische Bildung')).toEqual({ code: 'GPB', name: 'Geschichte und Politische Bildung', isCoreSmile: false });

    // Geographie
    expect(normalizeSubject('GWB')).toEqual({ code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false });
    expect(normalizeSubject('Geographie und wirtschaftliche Bildung')).toEqual({ code: 'GWB', name: 'Geographie und wirtschaftliche Bildung', isCoreSmile: false });

    // Religion
    expect(normalizeSubject('R KATH')).toEqual({ code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false });
    expect(normalizeSubject('Katholische Religion')).toEqual({ code: 'RKATH', name: 'Katholische Religion', isCoreSmile: false });
    expect(normalizeSubject('R ISLA')).toEqual({ code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false });
    expect(normalizeSubject('Islamische Religion')).toEqual({ code: 'RISLA', name: 'Islamische Religion', isCoreSmile: false });

    // Förderunterricht
    expect(normalizeSubject('BFUD')).toEqual({ code: 'BFUD', name: 'Förderunterricht Deutsch', isCoreSmile: false });
    expect(normalizeSubject('Förderunterricht Deutsch')).toEqual({ code: 'BFUD', name: 'Förderunterricht Deutsch', isCoreSmile: false });
  });

  it('handles unknown subjects gracefully with fallback', () => {
    expect(normalizeSubject('Astronomie')).toEqual({
      code: 'ASTRONOMIE',
      name: 'Astronomie',
      isCoreSmile: false,
    });
    expect(normalizeSubject('')).toEqual({
      code: 'UNKNOWN',
      name: 'Unbekannt',
      isCoreSmile: false,
    });
    // `CANONICAL_MAP` is an ordinary object. An unknown key inherited from
    // Object.prototype must never masquerade as a real subject entry.
    expect(normalizeSubject('constructor')).toEqual({
      code: 'CONSTRUCTOR',
      name: 'constructor',
      isCoreSmile: false,
    });
  });
});

describe('normalizeKnownSubject', () => {
  it('normalizes known aliases to their canonical representation', () => {
    expect(normalizeKnownSubject('D')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeKnownSubject('sd')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeKnownSubject('smile deutsch')).toEqual({ code: 'D', name: 'Deutsch', isCoreSmile: true });
    expect(normalizeKnownSubject('M')).toEqual({ code: 'M', name: 'Mathematik', isCoreSmile: true });
    expect(normalizeKnownSubject('sm')).toEqual({ code: 'M', name: 'Mathematik', isCoreSmile: true });
    expect(normalizeKnownSubject('E')).toEqual({ code: 'E', name: 'Englisch', isCoreSmile: true });
    expect(normalizeKnownSubject('BO')).toEqual({ code: 'BO', name: 'Berufsorientierung', isCoreSmile: false });
  });

  it('rejects unknown subject codes and non-string or empty inputs', () => {
    expect(normalizeKnownSubject('Astronomie')).toBeNull();
    expect(normalizeKnownSubject('XYZ')).toBeNull();
    expect(normalizeKnownSubject('')).toBeNull();
    expect(normalizeKnownSubject('   ')).toBeNull();
    expect(normalizeKnownSubject(null)).toBeNull();
    expect(normalizeKnownSubject(undefined)).toBeNull();
    expect(normalizeKnownSubject(123)).toBeNull();
    expect(normalizeKnownSubject({})).toBeNull();
    expect(normalizeKnownSubject('constructor')).toBeNull();
  });
});
