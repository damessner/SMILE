import React from 'react';

export type ChipTone = 'neutral' | 'green' | 'amber' | 'rose' | 'sky' | 'orange' | 'muted';

const TONE: Record<ChipTone, string> = {
  neutral: 'border-slate-700 bg-slate-800 text-slate-300',
  muted: 'border-slate-700/70 bg-slate-900 text-slate-400',
  green: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  amber: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  rose: 'border-rose-500/30 bg-rose-500/15 text-rose-300',
  sky: 'border-sky-500/30 bg-sky-500/15 text-sky-300',
  orange: 'border-orange-500/30 bg-orange-500/15 text-orange-300',
};

export interface ChipProps {
  tone?: ChipTone;
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/** Small status pill. 11px is the legibility floor for this UI, not 9–10px. */
export const Chip: React.FC<ChipProps> = ({ tone = 'neutral', icon, title, className = '', children }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold leading-tight ${TONE[tone]} ${className}`}
  >
    {icon}
    <span>{children}</span>
  </span>
);