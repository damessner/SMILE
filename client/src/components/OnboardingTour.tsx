import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Sparkles,
  Award,
  Calendar,
  ClipboardList,
  Scale,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  X,
  Clock,
  HelpCircle,
  BookOpen,
  Users,
} from 'lucide-react';

interface OnboardingTourProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        handleFinish();
      } else if (e.key === 'ArrowRight' && currentStep < steps.length - 1) {
        setCurrentStep((s) => s + 1);
      } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        setCurrentStep((s) => s - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStep]);

  if (!isOpen) return null;

  const handleFinish = () => {
    localStorage.setItem('smile_onboarding_seen', 'true');
    onClose();
  };

  const steps = [
    {
      badge: 'Willkommen 🌟',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      title: 'Willkommen bei SMILE!',
      subtitle: 'Schüler-Miteinander & Individuelle Leistungs-Entwicklung',
      description:
        'SMILE ist das moderne Begleitsystem für unsere Schule. Es verbindet transparente Verhaltensrückmeldungen im Schulalltag mit einer stärkenorientierten Einstufung in 3 Entwicklungsstufen.',
      highlights: [
        {
          icon: '🔴',
          title: 'Lehrling',
          text: 'Benötigt gezielte Hilfestellung, klare Leitplanken und strukturierte Begleitung im Lernalltag.',
          border: 'border-rose-500/30 bg-rose-500/10',
        },
        {
          icon: '🔵',
          title: 'Geselle',
          text: 'Erfüllt die schulischen und sozialen Regelerwartungen zuverlässig, selbstständig und pflichtbewusst.',
          border: 'border-blue-500/30 bg-blue-500/10',
        },
        {
          icon: '🟡',
          title: 'Meister',
          text: 'Zeigt herausragende Eigeninitiative, Vorbildwirkung, soziale Reife und hohe Selbstständigkeit.',
          border: 'border-amber-400/30 bg-amber-400/10',
        },
      ],
    },
    {
      badge: 'Schulalltag 🟢🟡🔴',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      title: 'Verhaltenskarten & Time-Out',
      subtitle: 'Direktes Feedback im Unterricht',
      description:
        'Im Reiter „Schulalltag“ sehen Sie Ihre Klassen auf einen Blick. Karten können mit einem Klick vergeben und begründet werden:',
      highlights: [
        {
          icon: '★',
          title: 'Grüne Karte (Lob & Anerkennung)',
          text: 'Für besonderes Engagement, Hilfsbereitschaft oder tolle Arbeitsleistungen. Sammelt Pluspunkte für den Schüler.',
          border: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        },
        {
          icon: '▲',
          title: 'Gelbe Karte (Verwarnung)',
          text: 'Bei Regelverstößen oder Störungen. Ab 3 Gelben Karten schlägt das System automatisch Alarm beim Klassenvorstand.',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '●',
          title: 'Rote Karte & Time-Out',
          text: 'Schwere Verstöße ziehen eine automatische Rückstufung nach sich. Bei Bedarf kann ein Schüler in den Time-Out-Raum geschickt werden.',
          border: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
        },
      ],
    },
    {
      badge: 'Bewertung 📋',
      badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      title: 'Beobachtung & Ränge',
      subtitle: 'Hauptfächer und Nicht-Hauptfächer',
      description:
        'Im Reiter „Bewertung“ erfassen Sie Ihre Beobachtungen für die anstehende Klassenkonferenz:',
      highlights: [
        {
          icon: '👑',
          title: 'Hauptfächer (Deutsch, Mathe, Englisch)',
          text: 'Die Lehrkräfte der Kernfächer füllen das standardmäßige 18-Kriterien-Raster mit Smileys aus oder nutzen die praktischen Sofort-Rang-Buttons.',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '💡',
          title: 'Nicht-Hauptfächer (Nebenfächer)',
          text: 'Sie können für jeden Schüler ein optionales Rang-Voting für die Konferenz abgeben und bei Bedarf den detaillierten Bogen für eigene Notizen öffnen.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
        {
          icon: '📄',
          title: 'KEL-Bericht & 1-Seiten-Export',
          text: 'Druckfertige Übersichten für Eltern-Lehrer-Schüler-Gespräche stehen jederzeit als PDF bereit.',
          border: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
        },
      ],
    },
    {
      badge: 'Konferenz ⚖️',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      title: 'Notenkonferenz & Beschluss',
      subtitle: 'Alle Stimmen im Überblick',
      description:
        'In der Konferenz laufen alle Daten nahtlos zusammen – für faire, nachvollziehbare und fundierte Entscheidungen:',
      highlights: [
        {
          icon: '📊',
          title: 'Abstimmung & Lehrer-Voten',
          text: 'Alle abgegebenen Bewertungen und Rang-Voten der Fachlehrkräfte sind übersichtlich aggregiert sichtbar.',
          border: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
        },
        {
          icon: '🔒',
          title: 'Sperre & Konferenz-Modus',
          text: 'Die Schulleitung (SLC, MED) kann die Abstimmung einfrieren und die Beschlüsse offiziell bestätigen.',
          border: 'border-slate-700 bg-slate-800/80 text-slate-300',
        },
        {
          icon: '🎯',
          title: 'Klassenstatistik',
          text: 'Statistiken über die Rangverteilung (Lehrling / Geselle / Meister) können schulweit ausgewertet werden.',
          border: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        },
      ],
    },
    {
      badge: 'Bereit! 🚀',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      title: 'Sie sind startklar!',
      subtitle: 'Willkommen im SMILE-System',
      description:
        'Alle Funktionen sind so gestaltet, dass sie Sie im Schulalltag entlasten und maximale Transparenz für Schüler und Eltern schaffen.',
      highlights: [
        {
          icon: '❓',
          title: 'Hilfe jederzeit verfügbar',
          text: 'Sie können diese Einführung jederzeit über das Fragezeichen-Symbol (?) oben rechts in der Menüleiste erneut aufrufen.',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '📱',
          title: 'Tablet & Desktop optimiert',
          text: 'SMILE funktioniert nahtlos auf Tablets im Klassenzimmer sowie am Laptop und Desktop-PC.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
      ],
    },
  ];

  const step = steps[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
              <GraduationCap className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-400 block leading-none">
                SMILE Einführung
              </span>
              <span className="text-sm font-bold text-slate-100">
                Schritt {currentStep + 1} von {steps.length}
              </span>
            </div>
          </div>

          <button
            onClick={handleFinish}
            title="Tour schließen"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1 bg-slate-800">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Badge & Title */}
          <div>
            <span
              className={`inline-block px-3 py-1 rounded-xl text-xs font-bold border mb-2 ${step.badgeColor}`}
            >
              {step.badge}
            </span>
            <h2 className="text-2xl font-black text-slate-50 tracking-tight">{step.title}</h2>
            <p className="text-xs font-semibold text-amber-400 mt-0.5">{step.subtitle}</p>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{step.description}</p>

          {/* Highlight Cards */}
          <div className="space-y-3 pt-1">
            {step.highlights.map((h, i) => (
              <div
                key={i}
                className={`p-3.5 rounded-2xl border transition flex items-start gap-3.5 ${h.border}`}
              >
                <div className="text-xl flex-shrink-0 mt-0.5">{h.icon}</div>
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-slate-100">{h.title}</h4>
                  <p className="text-xs text-slate-300/90 mt-0.5 leading-relaxed">{h.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Navigation Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/60">
          {/* Step Dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i)}
                aria-label={`Gehe zu Schritt ${i + 1}`}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  i === currentStep
                    ? 'w-6 bg-amber-400'
                    : 'bg-slate-700 hover:bg-slate-600'
                }`}
              />
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={() => setCurrentStep((s) => s - 1)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 font-bold text-xs flex items-center gap-1.5 transition"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Zurück</span>
              </button>
            )}

            {currentStep < steps.length - 1 ? (
              <button
                onClick={() => setCurrentStep((s) => s + 1)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition active:scale-95"
              >
                <span>Weiter</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>SMILE jetzt starten</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
