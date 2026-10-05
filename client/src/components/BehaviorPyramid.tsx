import React, { useState } from 'react';
import {
  Trophy,
  Award,
  Crown,
  Star,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  FileText,
  UserCheck,
  ChevronRight,
  Info,
} from 'lucide-react';
import { BehaviorStage, PupilStageResult } from '../types';

interface BehaviorPyramidProps {
  stages: BehaviorStage[];
  calculation?: PupilStageResult | null;
  onSelectStage?: (stage: BehaviorStage) => void;
  selectedStageLevel?: number | null;
}

export const BehaviorPyramid: React.FC<BehaviorPyramidProps> = ({
  stages,
  calculation,
  onSelectStage,
  selectedStageLevel,
}) => {
  const [hoveredLevel, setHoveredLevel] = useState<number | null>(null);

  // Group stages
  const greenStages = stages.filter((s) => s.type === 'green').sort((a, b) => b.level - a.level); // +10 to +1
  const neutralStage = stages.find((s) => s.type === 'neutral') || {
    level: 0,
    title: 'Regulärer Schulalltag (Neutrale Basis)',
    type: 'neutral' as const,
    description: 'Zuverlässiges, unauffälliges Regelverhalten im Unterrichtsalltag.',
    thresholdLabel: 'Regulärer Status',
    defaultGrade: 'Gut' as const,
  };
  const redStages = stages.filter((s) => s.type === 'red').sort((a, b) => b.level - a.level); // -1 to -10

  const activeCurrent = calculation?.currentStage ?? 0;
  const activePositive = calculation?.positiveStage ?? 0;
  const activeConsequence = calculation?.consequenceStage ?? 0;

  // Calculate width percentage for diamond / pyramid shape
  // Middle (0) is 100%. Extreme tips (+10 and -10) taper down to 42%.
  const getWidthPercent = (level: number) => {
    const abs = Math.abs(level);
    // 0 -> 100%, 10 -> 42%
    return Math.max(40, Math.round(100 - abs * 5.8));
  };

  // Get background and border colors for green steps
  const getGreenStyles = (level: number, isActive: boolean, isSelected: boolean) => {
    if (isSelected) {
      return 'bg-emerald-600/90 text-slate-50 border-emerald-300 ring-2 ring-emerald-400 shadow-lg shadow-emerald-950/50 scale-[1.02]';
    }
    if (isActive) {
      return 'bg-gradient-to-r from-emerald-600 to-teal-500 text-slate-50 border-emerald-300 ring-2 ring-emerald-400 ring-offset-2 ring-offset-slate-950 shadow-md shadow-emerald-500/30 animate-pulse';
    }
    switch (level) {
      case 10:
        return 'bg-emerald-950/80 text-emerald-100 border-emerald-600/70 hover:bg-emerald-900/90';
      case 9:
        return 'bg-emerald-900/75 text-emerald-100 border-emerald-600/60 hover:bg-emerald-900/90';
      case 8:
        return 'bg-emerald-900/60 text-emerald-200 border-emerald-700/60 hover:bg-emerald-800/80';
      case 7:
        return 'bg-emerald-900/50 text-emerald-200 border-emerald-700/50 hover:bg-emerald-800/70';
      case 6:
        return 'bg-emerald-900/40 text-emerald-200 border-emerald-700/40 hover:bg-emerald-800/60';
      case 5:
        return 'bg-emerald-900/35 text-emerald-200 border-emerald-700/40 hover:bg-emerald-800/50';
      case 4:
        return 'bg-emerald-900/30 text-emerald-300 border-emerald-800/50 hover:bg-emerald-800/50';
      case 3:
        return 'bg-emerald-900/25 text-emerald-300 border-emerald-800/40 hover:bg-emerald-800/40';
      case 2:
        return 'bg-emerald-900/20 text-emerald-300 border-emerald-800/35 hover:bg-emerald-800/40';
      case 1:
      default:
        return 'bg-emerald-900/15 text-emerald-300 border-emerald-800/30 hover:bg-emerald-800/35';
    }
  };

  // Get background and border colors for red steps
  const getRedStyles = (level: number, isActive: boolean, isSelected: boolean) => {
    if (isSelected) {
      return 'bg-rose-700/90 text-slate-50 border-rose-300 ring-2 ring-rose-400 shadow-lg shadow-rose-950/50 scale-[1.02]';
    }
    if (isActive) {
      return 'bg-gradient-to-r from-rose-700 to-red-600 text-slate-50 border-rose-300 ring-2 ring-rose-400 ring-offset-2 ring-offset-slate-950 shadow-md shadow-rose-500/30 animate-pulse';
    }
    switch (level) {
      case -1:
        return 'bg-amber-950/30 text-amber-300 border-amber-800/40 hover:bg-amber-900/40';
      case -2:
        return 'bg-amber-950/40 text-amber-200 border-amber-800/50 hover:bg-amber-900/50';
      case -3:
        return 'bg-orange-950/45 text-orange-200 border-orange-800/50 hover:bg-orange-900/55';
      case -4:
        return 'bg-orange-950/55 text-orange-100 border-orange-700/60 hover:bg-orange-900/65';
      case -5:
        return 'bg-rose-950/50 text-rose-200 border-rose-800/50 hover:bg-rose-900/60';
      case -6:
        return 'bg-rose-950/60 text-rose-200 border-rose-800/60 hover:bg-rose-900/70';
      case -7:
        return 'bg-rose-950/70 text-rose-100 border-rose-700/70 hover:bg-rose-900/80';
      case -8:
        return 'bg-rose-950/80 text-rose-100 border-rose-700/80 hover:bg-rose-900/90';
      case -9:
        return 'bg-red-950/90 text-red-100 border-red-600/85 hover:bg-red-900/90';
      case -10:
      default:
        return 'bg-red-950 text-red-100 border-red-500 hover:bg-red-900';
    }
  };

  const currentGrade = calculation?.behaviorGrade ?? 'Gut';

  return (
    <div className="w-full flex flex-col items-center select-none">
      {/* Legend & Current Grade Highlight Banner */}
      <div className="w-full max-w-4xl mb-4 bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 shadow-md flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            Verhaltensbeurteilung:
          </span>
          <span
            className={`px-3 py-1 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm ${
              currentGrade === 'Sehr gut'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 ring-1 ring-emerald-400/30'
                : currentGrade === 'Gut'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-400/40'
                : currentGrade === 'Zufriedenstellend'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40'
                : 'bg-rose-500/20 text-rose-300 border border-rose-400/40 ring-1 ring-rose-400/30'
            }`}
          >
            {currentGrade === 'Sehr gut' ? (
              <Crown className="w-3.5 h-3.5" />
            ) : currentGrade === 'Gut' ? (
              <Star className="w-3.5 h-3.5" />
            ) : currentGrade === 'Zufriedenstellend' ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" />
            )}
            <span>Verhaltensnote: {currentGrade}</span>
          </span>
        </div>

        {calculation?.stats && (
          <div className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold text-[11px]"
              title="Grüne Karten gesamt"
            >
              🟢 {calculation.stats.greenCount} Grün
            </span>
            <span
              className="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold text-[11px]"
              title="Gelbe Karten gesamt"
            >
              🟡 {calculation.stats.yellowCount} Gelb
            </span>
            <span
              className="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/35 font-bold text-[11px]"
              title="Rote Karten gesamt"
            >
              🔴 {calculation.stats.redCount} Rot
            </span>
            <span
              className="px-2 py-0.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/35 font-bold text-[11px]"
              title="Time-Out Einsätze"
            >
              ⏱️ {calculation.stats.timeoutCount} Time-Out
            </span>
          </div>
        )}
      </div>

      {/* Main Container: Left Scale (Verhaltensnote) + Diamond Pyramid */}
      <div className="w-full max-w-4xl flex items-stretch gap-2 md:gap-4">
        {/* Left Vertical Scale: Verhaltensnote bracket */}
        <div className="w-16 md:w-28 flex flex-col justify-between py-1 text-[11px] font-bold">
          {/* Sehr gut (+10 down to +2) */}
          <div
            className={`flex-1 rounded-xl p-1.5 flex flex-col items-center justify-center text-center transition border ${
              currentGrade === 'Sehr gut'
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold shadow-sm'
                : 'bg-slate-900/40 text-slate-500 border-slate-800/80 hover:text-emerald-400'
            }`}
            title="Sehr gut: Vorbildliches Verhalten und Engagement (+2 bis +10)"
          >
            <Crown className="w-4 h-4 mb-0.5" />
            <span className="leading-tight">Sehr gut</span>
          </div>

          <div className="h-1.5" />

          {/* Gut (+1 down to -1, including 0) */}
          <div
            className={`h-24 md:h-28 rounded-xl p-1.5 flex flex-col items-center justify-center text-center transition border ${
              currentGrade === 'Gut'
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-bold shadow-sm'
                : 'bg-slate-900/40 text-slate-500 border-slate-800/80 hover:text-sky-400'
            }`}
            title="Gut: Zuverlässiges Regelverhalten (+1 bis -1)"
          >
            <Star className="w-4 h-4 mb-0.5" />
            <span className="leading-tight">Gut</span>
          </div>

          <div className="h-1.5" />

          {/* Zufriedenstellend (-2 down to -4) */}
          <div
            className={`h-24 md:h-28 rounded-xl p-1.5 flex flex-col items-center justify-center text-center transition border ${
              currentGrade === 'Zufriedenstellend'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold shadow-sm'
                : 'bg-slate-900/40 text-slate-500 border-slate-800/80 hover:text-amber-400'
            }`}
            title="Zufriedenstellend: Wiederholte Regelverstöße / Mitteilungsheft (-2 bis -4)"
          >
            <AlertTriangle className="w-4 h-4 mb-0.5" />
            <span className="leading-tight text-[10px] md:text-[11px]">Zufrieden-stellend</span>
          </div>

          <div className="h-1.5" />

          {/* Wenig zufriedenstellend (-5 down to -10) */}
          <div
            className={`flex-1 rounded-xl p-1.5 flex flex-col items-center justify-center text-center transition border ${
              currentGrade === 'Wenig zufriedenstellend'
                ? 'bg-rose-500/25 text-rose-300 border-rose-500/45 font-bold shadow-sm'
                : 'bg-slate-900/40 text-slate-500 border-slate-800/80 hover:text-rose-400'
            }`}
            title="Wenig zufriedenstellend: Schwerwiegende Verstöße, Time-Outs, Direktion (-5 bis -10)"
          >
            <ShieldAlert className="w-4 h-4 mb-0.5" />
            <span className="leading-tight text-[10px] md:text-[11px]">Wenig zufrieden-stellend</span>
          </div>
        </div>

        {/* Center: Stepped Double Pyramid (Diamond / Rautenform) */}
        <div className="flex-1 flex flex-col items-center justify-center space-y-1 py-1">
          {/* Top Half: Green Stages (+10 down to +1) */}
          {greenStages.map((stage) => {
            const width = getWidthPercent(stage.level);
            const isDominant = activeCurrent === stage.level;
            const isReached = activePositive === stage.level;
            const isSelected = selectedStageLevel === stage.level;
            const styles = getGreenStyles(stage.level, isDominant || isReached, isSelected);

            return (
              <button
                key={stage.level}
                onClick={() => onSelectStage?.(stage)}
                onMouseEnter={() => setHoveredLevel(stage.level)}
                onMouseLeave={() => setHoveredLevel(null)}
                style={{ width: `${width}%` }}
                className={`group relative h-9 px-3 rounded-lg border text-xs font-semibold flex items-center justify-between transition-all duration-150 ${styles}`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    +{stage.level}
                  </span>
                  <span className="truncate">{stage.title}</span>
                  {stage.level === 10 && <Trophy className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0 text-[11px] opacity-80 group-hover:opacity-100">
                  <span className="hidden sm:inline text-[10px] text-emerald-300/80">
                    {stage.thresholdLabel}
                  </span>
                  {isDominant && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-bold text-[10px] flex items-center gap-0.5 shadow-sm">
                      <Star className="w-2.5 h-2.5 fill-current" /> Aktuell
                    </span>
                  )}
                  {isReached && !isDominant && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-400 text-slate-950 font-bold text-[10px] flex items-center gap-0.5 shadow-sm">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Erreicht
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {/* Neutral Baseline (0) */}
          <button
            onClick={() => onSelectStage?.(neutralStage)}
            onMouseEnter={() => setHoveredLevel(0)}
            onMouseLeave={() => setHoveredLevel(null)}
            style={{ width: '100%' }}
            className={`h-9 px-3 rounded-lg border text-xs font-semibold flex items-center justify-between transition-all duration-150 ${
              selectedStageLevel === 0
                ? 'bg-slate-700 text-slate-50 border-slate-400 ring-2 ring-slate-400'
                : activeCurrent === 0
                ? 'bg-slate-800 text-slate-200 border-slate-600 ring-1 ring-slate-400 shadow-sm'
                : 'bg-slate-950/70 text-slate-400 border-slate-800 hover:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                0
              </span>
              <span className="font-bold text-slate-300">{neutralStage.title}</span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <span className="hidden sm:inline">Normalitätsbereich</span>
              {activeCurrent === 0 && (
                <span className="px-1.5 py-0.5 rounded bg-sky-400 text-slate-950 font-bold text-[10px]">
                  Aktuelle Basis
                </span>
              )}
            </div>
          </button>

          {/* Bottom Half: Red Stages (-1 down to -10) */}
          {redStages.map((stage) => {
            const width = getWidthPercent(stage.level);
            const isDominant = activeCurrent === stage.level;
            const isReached = activeConsequence === stage.level;
            const isSelected = selectedStageLevel === stage.level;
            const styles = getRedStyles(stage.level, isDominant || isReached, isSelected);

            return (
              <button
                key={stage.level}
                onClick={() => onSelectStage?.(stage)}
                onMouseEnter={() => setHoveredLevel(stage.level)}
                onMouseLeave={() => setHoveredLevel(null)}
                style={{ width: `${width}%` }}
                className={`group relative h-9 px-3 rounded-lg border text-xs font-semibold flex items-center justify-between transition-all duration-150 ${styles}`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="w-5 h-5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/30 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                    {stage.level}
                  </span>
                  <span className="truncate">{stage.title}</span>
                  {stage.level <= -7 && <ShieldAlert className="w-3.5 h-3.5 text-rose-300 flex-shrink-0" />}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0 text-[11px] opacity-80 group-hover:opacity-100">
                  <span className="hidden sm:inline text-[10px] text-rose-300/80">
                    {stage.thresholdLabel}
                  </span>
                  {isDominant && (
                    <span className="px-1.5 py-0.5 rounded bg-rose-500 text-slate-50 font-bold text-[10px] flex items-center gap-0.5 shadow-sm animate-pulse">
                      <AlertTriangle className="w-2.5 h-2.5" /> Aktive Mahnung
                    </span>
                  )}
                  {isReached && !isDominant && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-bold text-[10px] flex items-center gap-0.5 shadow-sm">
                      <AlertTriangle className="w-2.5 h-2.5" /> Erreicht
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
