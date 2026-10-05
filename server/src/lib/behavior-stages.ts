export interface BehaviorStage {
  level: number; // -10 to +10
  title: string;
  type: 'green' | 'neutral' | 'red';
  description: string;
  thresholdLabel: string;
  defaultGrade: 'Sehr gut' | 'Gut' | 'Zufriedenstellend' | 'Wenig zufriedenstellend';
}

export const BEHAVIOR_STAGES: readonly BehaviorStage[] = [
  // Grüner Bereich (Oben - von Spitze nach unten zur Mitte)
  {
    level: 10,
    title: 'Fairness Award',
    type: 'green',
    description: 'Höchste Auszeichnung für außergewöhnliches soziales Vorbildverhalten und Fairness.',
    thresholdLabel: '15+ Grüne Karten / Konferenzbeschluss',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 9,
    title: 'Eintrag auf Website',
    type: 'green',
    description: 'Öffentliche Ehrung auf der Schulhomepage oder an der Ehrentafel der Schule.',
    thresholdLabel: '12 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 8,
    title: 'Urkunde',
    type: 'green',
    description: 'Feierliche Übergabe einer offiziellen Auszeichnungs-Urkunde zum Semester.',
    thresholdLabel: '10 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 7,
    title: 'Schriftliche Anerkennung der Direktorin',
    type: 'green',
    description: 'Offizielles Anerkennungsschreiben der Schulleitung an Schüler/in und Eltern.',
    thresholdLabel: '8 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 6,
    title: 'Mündliches Lob der Direktorin',
    type: 'green',
    description: 'Persönliches Wertschätzungsgespräch und Lob durch die Schulleitung.',
    thresholdLabel: '6 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 5,
    title: 'Individuelle Goodies',
    type: 'green',
    description: 'Schulische Anerkennung (z.B. Hausaufgaben-Joker, freie Sitzplatzwahl, Sonderprivileg).',
    thresholdLabel: '5 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 4,
    title: 'Schriftliche Lobmitteilung',
    type: 'green',
    description: 'Schriftliche Würdigung im Mitteilungsheft oder per Brief an die Erziehungsberechtigten.',
    thresholdLabel: '4 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 3,
    title: 'Anerkennung vor der Klasse',
    type: 'green',
    description: 'Öffentliches Lob vor der gesamten Klassengemeinschaft durch den Klassenvorstand.',
    thresholdLabel: '3 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 2,
    title: 'Gespräch Lehrkraft + Schüler/in',
    type: 'green',
    description: 'Positives Vieraugengespräch zur Stärkung und Motivation.',
    thresholdLabel: '2 Grüne Karten',
    defaultGrade: 'Sehr gut',
  },
  {
    level: 1,
    title: 'Lob',
    type: 'green',
    description: 'Direktes verbales Lob im Unterricht für vorbildliches Verhalten.',
    thresholdLabel: '1 Grüne Karte',
    defaultGrade: 'Gut',
  },

  // Neutrale Basis (Mitte)
  {
    level: 0,
    title: 'Regulärer Schulalltag (Neutrale Basis)',
    type: 'neutral',
    description: 'Zuverlässiges, unauffälliges Regelverhalten im Unterrichtsalltag.',
    thresholdLabel: 'Regulärer Status',
    defaultGrade: 'Gut',
  },

  // Roter Bereich (Unten - von Mitte nach unten zur schärfsten Maßnahme)
  {
    level: -1,
    title: 'Ermahnung und Zurechtweisung',
    type: 'red',
    description: 'Mündliche Verwarnung und Erinnerung an die Klassen- und Schulregeln.',
    thresholdLabel: '1 Gelbe Karte',
    defaultGrade: 'Gut',
  },
  {
    level: -2,
    title: 'Gespräch Lehrkraft + Schüler/in',
    type: 'red',
    description: 'Klärendes pädagogisches Einzelgespräch zur Reflexion des Störverhaltens.',
    thresholdLabel: '2 Gelbe Karten',
    defaultGrade: 'Zufriedenstellend',
  },
  {
    level: -3,
    title: 'Eintrag ins Mitteilungsheft',
    type: 'red',
    description: 'Dokumentierte Benachrichtigung der Eltern im Mitteilungsheft (Mahnstufe 1).',
    thresholdLabel: '3 Gelbe Karten',
    defaultGrade: 'Zufriedenstellend',
  },
  {
    level: -4,
    title: 'Gespräch Lehrkraft + Eltern + Schüler/in',
    type: 'red',
    description: 'Einberufung eines Elterngesprächs mit KV und Fachlehrkraft zur Zielvereinbarung.',
    thresholdLabel: '4 Gelbe Karten',
    defaultGrade: 'Zufriedenstellend',
  },
  {
    level: -5,
    title: 'Wiedergutmachung, Aufträge f.d. Gemeinschaft',
    type: 'red',
    description: 'Pädagogischer Arbeitsauftrag (Lernwerkstatt Time-Out) oder Dienst an der Schulgemeinschaft.',
    thresholdLabel: '1 Rote Karte oder 1 Time-Out',
    defaultGrade: 'Wenig zufriedenstellend',
  },
  {
    level: -6,
    title: 'Ausschluss von Schulveranstaltungen',
    type: 'red',
    description: 'Befristeter Ausschluss von Wandertagen, Exkursionen oder Projektwochen.',
    thresholdLabel: '2 Rote Karten oder 2 Time-Outs',
    defaultGrade: 'Wenig zufriedenstellend',
  },
  {
    level: -7,
    title: 'Gespräch in der Direktion',
    type: 'red',
    description: 'Vorladung in die Schulleitung (SLC, MED) zur verbindlichen Vereinbarung.',
    thresholdLabel: '3 Time-Outs (Mahnstufe Direktion)',
    defaultGrade: 'Wenig zufriedenstellend',
  },
  {
    level: -8,
    title: 'Schriftliche Verwarnung',
    type: 'red',
    description: 'Förmliche Verwarnung durch die Schulleitung mit Androhung weiterer Konsequenzen.',
    thresholdLabel: '4 Time-Outs',
    defaultGrade: 'Wenig zufriedenstellend',
  },
  {
    level: -9,
    title: 'Kurzzeitsuspendierung',
    type: 'red',
    description: 'Vorübergehende Suspendierung vom Unterricht gem. § 49 SchUG.',
    thresholdLabel: '6 Time-Outs',
    defaultGrade: 'Wenig zufriedenstellend',
  },
  {
    level: -10,
    title: 'Suspendierung / Bildungsdirektion + Jugendamt',
    type: 'red',
    description: 'Schwere Eskalation: Einschaltung der Bildungsdirektion Tirol und der Jugendwohlfahrt.',
    thresholdLabel: '9 Time-Outs',
    defaultGrade: 'Wenig zufriedenstellend',
  },
] as const;

export interface PupilStageResult {
  currentStage: number; // -10 .. +10
  positiveStage: number; // 0 .. 10
  consequenceStage: number; // -10 .. 0
  stageInfo: BehaviorStage;
  behaviorGrade: 'Sehr gut' | 'Gut' | 'Zufriedenstellend' | 'Wenig zufriedenstellend';
  stats: {
    greenCount: number;
    yellowCount: number;
    redCount: number;
    timeoutCount: number;
  };
}

export function computePupilBehaviorStage(
  greenCount: number,
  yellowCount: number,
  redCount: number,
  timeoutCount: number
): PupilStageResult {
  // 1. Calculate positive stage (0 .. 10)
  let positiveStage = 0;
  if (greenCount >= 15) positiveStage = 10;
  else if (greenCount >= 12) positiveStage = 9;
  else if (greenCount >= 10) positiveStage = 8;
  else if (greenCount >= 8) positiveStage = 7;
  else if (greenCount >= 6) positiveStage = 6;
  else if (greenCount >= 5) positiveStage = 5;
  else if (greenCount >= 4) positiveStage = 4;
  else if (greenCount >= 3) positiveStage = 3;
  else if (greenCount >= 2) positiveStage = 2;
  else if (greenCount >= 1) positiveStage = 1;

  // 2. Calculate consequence stage (-10 .. 0)
  let consequenceStage = 0;
  if (timeoutCount >= 9) consequenceStage = -10;
  else if (timeoutCount >= 6) consequenceStage = -9;
  else if (timeoutCount >= 4) consequenceStage = -8;
  else if (timeoutCount >= 3 || redCount >= 3) consequenceStage = -7;
  else if (timeoutCount >= 2 || redCount >= 2) consequenceStage = -6;
  else if (timeoutCount >= 1 || redCount >= 1) consequenceStage = -5;
  else if (yellowCount >= 4) consequenceStage = -4;
  else if (yellowCount >= 3) consequenceStage = -3;
  else if (yellowCount >= 2) consequenceStage = -2;
  else if (yellowCount >= 1) consequenceStage = -1;

  // 3. Dominant stage for primary highlight
  let currentStage = 0;
  if (consequenceStage <= -3) {
    // Serious yellow warning or red card/timeout dominates
    currentStage = consequenceStage;
  } else if (positiveStage >= 2 && consequenceStage >= -1) {
    // Good engagement dominates mild warning
    currentStage = positiveStage;
  } else if (consequenceStage < 0) {
    currentStage = consequenceStage;
  } else {
    currentStage = positiveStage;
  }

  const stageInfo =
    BEHAVIOR_STAGES.find((s) => s.level === currentStage) ||
    BEHAVIOR_STAGES.find((s) => s.level === 0)!;

  // Determine Austrian Verhaltensnote
  let behaviorGrade: 'Sehr gut' | 'Gut' | 'Zufriedenstellend' | 'Wenig zufriedenstellend' = 'Gut';
  if (consequenceStage <= -5) {
    behaviorGrade = 'Wenig zufriedenstellend';
  } else if (consequenceStage <= -2) {
    behaviorGrade = 'Zufriedenstellend';
  } else if (positiveStage >= 2 && consequenceStage === 0) {
    behaviorGrade = 'Sehr gut';
  } else {
    behaviorGrade = 'Gut';
  }

  return {
    currentStage,
    positiveStage,
    consequenceStage,
    stageInfo,
    behaviorGrade,
    stats: {
      greenCount,
      yellowCount,
      redCount,
      timeoutCount,
    },
  };
}
