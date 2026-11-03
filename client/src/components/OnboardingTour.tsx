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
  ArrowRight,
  ArrowUp,
  ArrowDown,
  MousePointerClick,
} from 'lucide-react';
import { User } from '../types';

interface OnboardingTourProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  activeTab: 'schulalltag' | 'bewertung' | 'statistics';
  setActiveTab: (tab: 'schulalltag' | 'bewertung' | 'statistics') => void;
}

interface TourStep {
  targetSelector?: string;
  requiredTab?: 'schulalltag' | 'bewertung' | 'statistics';
  badge: string;
  badgeColor: string;
  title: string;
  subtitle: string;
  description: string;
  pointerText?: string;
  highlights: Array<{
    icon: string;
    title: string;
    text: string;
    border: string;
  }>;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  isOpen,
  onClose,
  currentUser,
  activeTab,
  setActiveTab,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const steps: TourStep[] = [
    {
      targetSelector: '[data-tour="welcome-logo"]',
      requiredTab: 'schulalltag',
      badge: 'Willkommen 🌟',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      title: 'Willkommen bei SMILE!',
      subtitle: 'Schüler-Miteinander & Individuelle Leistungs-Entwicklung',
      pointerText: '👋 Herzlich willkommen im SMILE-System!',
      description:
        'SMILE ist das moderne Begleitsystem für unsere Schule. Es verbindet direktes Verhaltens-Feedback im Unterricht mit einer stärkenorientierten Einstufung in 3 Entwicklungsstufen:',
      highlights: [
        {
          icon: '🔴',
          title: 'Lehrling',
          text: 'Benötigt gezielte Hilfestellung, klare Leitplanken und strukturierte Begleitung im Lernalltag.',
          border: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
        },
        {
          icon: '🔵',
          title: 'Geselle',
          text: 'Erfüllt die schulischen und sozialen Regelerwartungen zuverlässig, selbstständig und pflichtbewusst.',
          border: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
        },
        {
          icon: '🟡',
          title: 'Meister',
          text: 'Zeigt herausragende Eigeninitiative, Vorbildwirkung, soziale Reife und hohe Selbstständigkeit.',
          border: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
        },
      ],
    },
    {
      targetSelector: '[data-tour="nav-tabs"]',
      requiredTab: 'schulalltag',
      badge: 'Navigation 🧭',
      badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
      title: 'Die 3 Hauptbereiche von SMILE',
      subtitle: 'Hier schalten Sie schnell zwischen den Modulen um',
      pointerText: '👆 Hier klicken, um den Bereich zu wechseln',
      description: 'Über diese Menüleiste navigieren Sie durch die Kernbereiche der Schule:',
      highlights: [
        {
          icon: '📅',
          title: 'Schulalltag',
          text: 'Schnelles Feedback im Klassenzimmer mit Verhaltenskarten (Grün, Gelb, Rot) und Time-Out.',
          border: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        },
        {
          icon: '📋',
          title: 'Bewertung',
          text: 'Beobachtungsraster & Vorbereitung der Einstufungen für die Notenkonferenz.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
        {
          icon: '📊',
          title: 'Schulstatistik',
          text: 'Schulweite Übersicht und statistische Verteilung der Entwicklungsstufen.',
          border: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
        },
      ],
    },
    {
      targetSelector: '[data-tour="class-selector"]',
      requiredTab: 'schulalltag',
      badge: 'Klassen & LW 🏫',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      title: 'Klassen & Lernwerkstatt (LW)',
      subtitle: 'Automatischer Stundenplan-Abgleich',
      pointerText: '👆 Hier Klasse oder Lernwerkstatt auswählen',
      description:
        'SMILE erkennt anhand Ihres aktuellen Stundenplans automatisch die richtige Klasse. Sie können Klassen auch manuell auswählen:',
      highlights: [
        {
          icon: '⏰',
          title: 'Live-Stundenplan-Erkennung',
          text: 'Die aktuelle Unterrichtsstunde und Klasse werden automatisch hervorgehoben.',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '🏫',
          title: 'Klassen-Schnellwahl',
          text: 'Mit einem Klick auf die Buttons wechseln Sie sofort in die gewünschte Schulklasse.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
        {
          icon: '🕒',
          title: 'Lernwerkstatt (LW)',
          text: 'Zeigt alle Schüler, die sich aktuell im Time-Out-Raum befinden, mit Arbeitsauftrag.',
          border: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
        },
      ],
    },
    {
      targetSelector: '[data-tour="card-actions"]',
      requiredTab: 'schulalltag',
      badge: 'Sofort-Feedback 🟢🟡🔴',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      title: 'Verhaltenskarten im Unterricht',
      subtitle: 'Lob, Verwarnung, Time-Out & Cool-Down mit 1 Klick',
      pointerText: '👉 Hier Verhaltenskarten vergeben oder Schüler anklicken',
      description: 'In der Schülerliste können Sie direkt während der Stunde Karten vergeben:',
      highlights: [
        {
          icon: '★',
          title: 'Grüne Karte (Lob & Pluspunkte)',
          text: 'Für besonderes Engagement, Hilfsbereitschaft oder tolle Mitarbeit.',
          border: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
        },
        {
          icon: '▲',
          title: 'Gelbe Karte (Verwarnung)',
          text: 'Bei Regelverstößen. Ab 2 Gelben Karten schlägt das System Alarm beim Klassenvorstand; ab 3, 6, 9 aktiven Gelben gibt es zusätzlich einen Rangverlust.',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '●',
          title: 'Rote Karte & Time-Out',
          text: 'Die Rote Karte kostet sofort einen Rang. Ein Time-Out ist eine zusätzliche Konsequenz und erzeugt keine Rote Karte.',
          border: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
        },
        {
          icon: '❄',
          title: 'Cool-Down (Lernwerkstatt)',
          text: 'Auszeit zur Beruhigung ohne Rote Karte, ohne Rangverlust und ohne Eskalation. Eine Notiz ist optional.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
      ],
    },
    {
      targetSelector: '[data-tour="start-rating-button"]',
      requiredTab: 'bewertung',
      badge: 'Bewertung 📋',
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      title: 'Einstufung für die Konferenz',
      subtitle: 'Hauptfächer (D, M, E) & Nicht-Hauptfächer',
      pointerText: '👇 Hier Einstufung starten',
      description: 'Im Reiter „Bewertung“ erfassen Sie Ihre Einstufungen für die Notenkonferenz:',
      highlights: [
        {
          icon: '👑',
          title: 'Hauptfächer (Deutsch, Mathe, Englisch)',
          text: 'Füllen das standardmäßige 18-Kriterien-Raster mit Smileys aus oder nutzen die praktischen Sofort-Rang-Buttons (Lehrling, Geselle, Meister).',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '💡',
          title: 'Nicht-Hauptfächer (Nebenfächer)',
          text: 'Sie können für jeden Schüler ein optionales Rang-Voting für die Konferenz abgeben und bei Bedarf den Bogen für eigene Aufzeichnungen öffnen.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
        {
          icon: '📄',
          title: 'KEL-Bericht & Export',
          text: 'Druckfertige Übersichten für Elternsprechtage mit einem Klick als PDF erstellen.',
          border: 'border-purple-500/30 bg-purple-500/10 text-purple-300',
        },
      ],
    },
    {
      targetSelector: '[data-tour="conference-button"]',
      requiredTab: 'schulalltag',
      badge: 'Konferenz ⚖️',
      badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      title: 'Notenkonferenz & Beschluss',
      subtitle: 'Alle Lehrer-Stimmen im Überblick',
      pointerText: '👆 Schulleitung: Konferenz-Modus im Vollbild',
      description: 'In der Klassenkonferenz laufen alle Fächer transparent zusammen:',
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
          text: 'Die Schulleitung (SLC, MED) moderiert die Konferenz auf Großleinwand und fixiert die Beschlüsse.',
          border: 'border-slate-700 bg-slate-800/80 text-slate-300',
        },
      ],
    },
    {
      targetSelector: '[data-tour="help-button"]',
      requiredTab: 'schulalltag',
      badge: 'Startklar! 🚀',
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      title: 'Sie sind startklar!',
      subtitle: 'Hilfe ist jederzeit griffbereit',
      pointerText: '👆 Hier jederzeit Hilfe & Tour öffnen',
      description:
        'Alle Funktionen sind so gestaltet, dass sie Sie im Schulalltag entlasten und maximale Transparenz für Schüler und Eltern schaffen:',
      highlights: [
        {
          icon: '❓',
          title: 'Hilfe jederzeit aufrufen (?)',
          text: 'Sie können diese Einführung jederzeit über das Fragezeichen-Symbol (?) oben rechts in der Menüleiste erneut aufrufen.',
          border: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
        },
        {
          icon: '⚡',
          title: 'Live-Synchronisierung',
          text: 'Alle Eingaben und Karten werden automatisch und sicher in Echtzeit gespeichert.',
          border: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
        },
      ],
    },
  ];

  // Tab switching and element measurement
  useEffect(() => {
    if (!isOpen) return;

    const step = steps[currentStep];
    if (step.requiredTab && activeTab !== step.requiredTab) {
      setActiveTab(step.requiredTab);
    }

    const updatePosition = () => {
      if (!step.targetSelector) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(step.targetSelector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const r = el.getBoundingClientRect();
        setTargetRect(r);
      } else {
        setTargetRect(null);
      }
    };

    const timer = setTimeout(updatePosition, 140);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, currentStep, activeTab]);

  // Keyboard navigation
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
    if (currentUser?.username) {
      localStorage.setItem(`smile_tour_seen_${currentUser.username.toLowerCase()}`, 'true');
    }
    localStorage.setItem('smile_onboarding_seen', 'true');
    onClose();
  };

  const step = steps[currentStep];

  // Calculate layout
  const pad = 8;
  const cutout = targetRect
    ? {
        top: Math.max(0, targetRect.top - pad),
        left: Math.max(0, targetRect.left - pad),
        width: targetRect.width + pad * 2,
        height: targetRect.height + pad * 2,
      }
    : null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const cardWidth = Math.min(520, vw - 32);
  const cardEstimatedHeight = 440;

  let placement: 'top' | 'bottom' | 'center' = 'center';
  let cardTop = 0;
  let cardLeft = 16;

  if (cutout) {
    const spaceBelow = vh - (cutout.top + cutout.height);
    const spaceAbove = cutout.top;

    cardLeft = Math.max(16, Math.min(vw - cardWidth - 16, cutout.left + cutout.width / 2 - cardWidth / 2));

    if (spaceBelow >= 360) {
      cardTop = cutout.top + cutout.height + 16;
      placement = 'bottom';
    } else if (spaceAbove >= 360) {
      cardTop = Math.max(16, cutout.top - cardEstimatedHeight - 16);
      placement = 'top';
    } else {
      cardTop = Math.max(16, Math.min(vh - cardEstimatedHeight - 16, vh / 2 - cardEstimatedHeight / 2));
      placement = 'center';
    }
  }

  return (
    <div className="fixed inset-0 z-50 animate-fadeIn">
      {/* 1. Backdrop or Spotlight Cutout */}
      {cutout ? (
        <>
          {/* Spotlight highlight box with box-shadow dark overlay */}
          <div
            className="fixed z-50 pointer-events-none transition-all duration-300 ease-out rounded-2xl border-2 border-amber-400 ring-4 ring-amber-400/40"
            style={{
              top: `${cutout.top}px`,
              left: `${cutout.left}px`,
              width: `${cutout.width}px`,
              height: `${cutout.height}px`,
              boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.82)',
            }}
          >
            {/* Visual Pointer Arrow & Badge anchored on the highlight box */}
            {step.pointerText && (
              <div
                className={`absolute pointer-events-none flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 text-slate-950 font-black text-xs shadow-2xl shadow-amber-400/50 whitespace-nowrap animate-bounce z-50 ${
                  placement === 'bottom'
                    ? '-bottom-10 left-1/2 -translate-x-1/2'
                    : placement === 'top'
                    ? '-top-10 left-1/2 -translate-x-1/2'
                    : '-bottom-10 left-1/2 -translate-x-1/2'
                }`}
              >
                <span className="text-sm">
                  {placement === 'bottom' ? '👇' : placement === 'top' ? '👆' : '👉'}
                </span>
                <span>{step.pointerText}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Full Backdrop when no element is highlighted */
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md" />
      )}

      {/* 2. Floating Step Card */}
      <div
        className={`fixed z-50 flex flex-col ${
          cutout ? '' : 'inset-0 items-center justify-center p-4'
        }`}
        style={
          cutout
            ? {
                top: `${cardTop}px`,
                left: `${cardLeft}px`,
                width: `${cardWidth}px`,
                maxWidth: 'calc(100vw - 32px)',
              }
            : undefined
        }
      >
        <div className="relative w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
          {/* Directional Arrow Nub on Card pointing towards highlight box */}
          {cutout && placement === 'bottom' && (
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-b-8 border-b-slate-800" />
          )}
          {cutout && placement === 'top' && (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-x-8 border-x-transparent border-t-8 border-t-slate-800" />
          )}

          {/* Header Bar */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950/60">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
                <GraduationCap className="w-4.5 h-4.5" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-400 block leading-none">
                  SMILE Tour & Hilfestellung
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
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Badge & Title */}
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={`inline-block px-3 py-1 rounded-xl text-xs font-bold border ${step.badgeColor}`}
                >
                  {step.badge}
                </span>
                {cutout && (
                  <span className="px-2 py-0.5 rounded-lg bg-amber-400/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold flex items-center gap-1 animate-pulse">
                    <MousePointerClick className="w-3 h-3" />
                    <span>Hervorgehobener Bereich</span>
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-50 tracking-tight leading-tight">
                {step.title}
              </h2>
              <p className="text-xs font-semibold text-amber-400 mt-0.5">{step.subtitle}</p>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{step.description}</p>

            {/* Highlights */}
            <div className="space-y-2.5 pt-0.5">
              {step.highlights.map((h, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-2xl border transition flex items-start gap-3 ${h.border}`}
                >
                  <div className="text-lg flex-shrink-0 mt-0.5">{h.icon}</div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-slate-100">{h.title}</h4>
                    <p className="text-xs text-slate-300/90 mt-0.5 leading-relaxed">{h.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Navigation Bar */}
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-800 bg-slate-950/70">
            {/* Step Dots */}
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  aria-label={`Gehe zu Schritt ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${
                    i === currentStep ? 'w-6 bg-amber-400' : 'w-2 bg-slate-700 hover:bg-slate-600'
                  }`}
                />
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {currentStep > 0 && (
                <button
                  onClick={() => setCurrentStep((s) => s - 1)}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 font-bold text-xs flex items-center gap-1 transition"
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
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 transition active:scale-95"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>SMILE starten</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
