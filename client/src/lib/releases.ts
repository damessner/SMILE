/**
 * Release notes for the "Was ist neu?" notice and the help menu (?) under
 * "Versionsverlauf".
 *
 * Maintenance: add the new release at the TOP of RELEASES. The newest entry is
 * the current version (`LATEST_RELEASE`); every teacher who has not yet seen it
 * gets a one-time notice after login. Older entries are a curated summary of
 * the git history.
 */

export type ReleaseNoteKind = 'feature' | 'improvement' | 'fix' | 'security';

export interface ReleaseNote {
  kind: ReleaseNoteKind;
  title: string;
  text?: string;
}

export interface Release {
  version: string;
  /** ISO date (YYYY-MM-DD) of the release. */
  date: string;
  title: string;
  summary: string;
  notes: ReleaseNote[];
}

export const RELEASES: Release[] = [
  {
    version: '2.0.0',
    date: '2026-11-12',
    title: 'Klassen-Schnellwahl & Änderungsinfos',
    summary:
      'Der schulweite Überblick lässt sich jetzt direkt pro Klasse öffnen. Neu ist außerdem der Hinweis „Was ist neu?“ nach einem Update sowie der vollständige Versionsverlauf unter dem Fragezeichen.',
    notes: [
      {
        kind: 'feature',
        title: 'Klassen-Buttons statt Überschrift',
        text: 'Im Bereich „Alle Klassen“ wählt man die Klasse jetzt mit einem Tipp auf den passenden Klassen-Button. Die Kennzahlen oben beziehen sich dann nur noch auf diese Klasse.',
      },
      {
        kind: 'feature',
        title: '„Was ist neu?“-Hinweis',
        text: 'Nach einem Update erscheint einmalig ein kurzes Fenster mit den wichtigsten Neuerungen. Es wird pro Lehrer*in und Version nur ein einziges Mal angezeigt.',
      },
      {
        kind: 'feature',
        title: 'Versionsverlauf unter (?)',
        text: 'Das Fragezeichen oben rechts zeigt jetzt alle Releases und Changelogs der letzten Wochen – inklusive Einstieg in die Einführungstour.',
      },
      {
        kind: 'improvement',
        title: 'Klarere Kennzahlen',
        text: 'Die Kacheln im schulweiten Überblick zeigen nur noch die ausgewählte Klasse, sobald eine Klasse aktiv ist. „Alle“ liefert weiterhin den gesamten Schulüberblick.',
      },
      {
        kind: 'improvement',
        title: 'Barrierearme Dialoge',
        text: 'Neue Fenster halten den Fokus im Dialog, schließen mit Escape und geben den Fokus danach an die auslösende Stelle zurück.',
      },
    ],
  },
  {
    version: '1.9.0',
    date: '2026-11-09',
    title: 'Sicherheits-Review & Stabilität',
    summary:
      'Die Befunde aus dem kritischen Sicherheits-Review sind umgesetzt; der Client verhält sich bei Fehlern und Verbindungsabbrüchen ruhiger.',
    notes: [
      {
        kind: 'security',
        title: 'Sicherheitslücken geschlossen',
        text: 'Kritische Befunde aus dem Review (Rechteprüfung, Sitzungsführung, Eingabeprüfung) wurden behoben.',
      },
      {
        kind: 'fix',
        title: 'Stabile Sitzungen',
        text: 'Abgelaufene Sitzungen und fehlgeschlagene Ladevorgänge führen nicht mehr zu hängenden Ansichten.',
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-11-08',
    title: 'WebUntis im Schulalltag',
    summary:
      'Der Stundenplan von WebUntis ist integriert: aktuelle Klasse, Fach, Vertretungen und Klassenbuch-Ereignisse werden direkt im Schulalltag berücksichtigt.',
    notes: [
      {
        kind: 'feature',
        title: 'WebUntis-Integration',
        text: 'Stundenplan, Klassen und Fächer werden automatisch geladen; die aktuelle Stunde wird erkannt und hervorgehoben.',
      },
      {
        kind: 'feature',
        title: 'Wochenkalender & Vertretungen',
        text: 'Wochenansicht mit Blättern zwischen Schulwochen, Statusanzeigen für Stunden und aufgelöste Vertretungen.',
      },
      {
        kind: 'feature',
        title: 'Aufsichten & Dienste',
        text: 'Dienst-Slots (MM, SPR, Aufsicht) erscheinen im Stundenplan; Anwesenheitshinweise helfen im Schulalltag.',
      },
      {
        kind: 'improvement',
        title: 'Outbox mit Wiederholung',
        text: 'Nicht gesendete Einträge landen in einer Outbox und werden automatisch erneut versucht.',
      },
      {
        kind: 'fix',
        title: 'Zeitzonen-Versatz behoben',
        text: 'Die Wochentagszuordnung rutschte rund um Mitternacht (UTC) in den falschen Tag – das ist korrigiert.',
      },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-11-07',
    title: 'Schulstatistik, Kartenzähler & iOS-App',
    summary:
      'Die Schulstatistik ist ein sachliches Dashboard geworden, der Schulalltag zeigt Kartenzähler, und die native iOS-/iPadOS-App ist dazugekommen.',
    notes: [
      {
        kind: 'feature',
        title: 'Neues Statistik-Dashboard',
        text: 'Verteilung der Einstufungen, Karten und Time-Outs auf einen Blick – ohne geschätzte Werte.',
      },
      {
        kind: 'feature',
        title: 'Kartenzähler im Schulalltag',
        text: 'Grün, Gelb und Rot je Schüler*in sind direkt sichtbar; die Bewertungsansicht lässt sich ein- und ausblenden.',
      },
      {
        kind: 'feature',
        title: 'Native iOS-/iPadOS-App',
        text: 'Erste native App für iPads und iPhones, inklusive Build-Pipeline.',
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-11-03',
    title: 'Gelbe Karten & Time-Outs',
    summary:
      'Die Gelbe-Karten-Eskalation ist verbindlicher geregelt, Time-Outs sind von der Roten Karte entkoppelt und können nachträglich erfasst werden.',
    notes: [
      {
        kind: 'feature',
        title: 'Rangverlust nach drei Gelben Karten',
        text: 'Drei aktive Gelbe Karten führen zum Rangverlust; die Konferenz nutzt weiterhin die bestätigten Endränge.',
      },
      {
        kind: 'improvement',
        title: 'Time-Out ohne Rote Karte',
        text: 'Ein Time-Out erzeugt keine Rote Karte mehr und ist eine eigenständige Konsequenz.',
      },
      {
        kind: 'feature',
        title: 'Nachträgliche Time-Outs',
        text: 'Time-Outs lassen sich für vergangene Stunden nachtragen – doppelte Einträge verhindert das System.',
      },
    ],
  },
];

/** The most recent release: what the one-time "Was ist neu?" notice shows. */
export const LATEST_RELEASE: Release = RELEASES[0]!;

export const CURRENT_APP_VERSION = LATEST_RELEASE.version;

/** Formats an ISO release date for the German UI (e.g. 12.11.2026). */
export function formatReleaseDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const WHATS_NEW_STORAGE_PREFIX = 'smile_whatsnew_seen';

/** Storage key that remembers "this user has seen this release". */
export function whatsNewStorageKey(username: string, version: string = CURRENT_APP_VERSION): string {
  return `${WHATS_NEW_STORAGE_PREFIX}_${username.trim().toLowerCase()}_${version}`;
}

/**
 * Has this user already dismissed the notice for the current release?
 *
 * Missing/unknown users and unavailable storage report "seen": the notice is a
 * courtesy, and a storage exception must never block the app.
 */
export function hasSeenLatestRelease(username?: string | null): boolean {
  if (!username || username.trim() === '') return true;
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(whatsNewStorageKey(username)) === 'true';
  } catch {
    return true;
  }
}

/**
 * Remember that the notice was shown. Called as soon as it opens, so a reload
 * while it is visible does not show it again: "once, then gone".
 */
export function markLatestReleaseSeen(username?: string | null): void {
  if (!username || username.trim() === '') return;
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(whatsNewStorageKey(username), 'true');
  } catch {
    // Private mode / disabled site data: the notice was shown, which is enough.
  }
}
