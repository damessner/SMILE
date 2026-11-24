import React from 'react';

export type ChipTone = 'neutral' | 'green' | 'amber' | 'rose' | 'sky' | 'orange' | 'muted';

/*
  Tones consume the --chip-* component tokens: fg is the semantic color (the
  light theme darkens it automatically), bg/border are translucent mixes.
*/
const TONE: Record<ChipTone, string> = {
  neutral: 'bg-(--chip-neutral-bg) border-(--chip-neutral-border) text-(--chip-neutral-fg)',
  muted: 'bg-(--chip-muted-bg) border-(--chip-muted-border) text-(--chip-muted-fg)',
  green: 'bg-(--chip-green-bg) border-(--chip-green-border) text-(--chip-green-fg)',
  amber: 'bg-(--chip-amber-bg) border-(--chip-amber-border) text-(--chip-amber-fg)',
  rose: 'bg-(--chip-rose-bg) border-(--chip-rose-border) text-(--chip-rose-fg)',
  sky: 'bg-(--chip-sky-bg) border-(--chip-sky-border) text-(--chip-sky-fg)',
  orange: 'bg-(--chip-orange-bg) border-(--chip-orange-border) text-(--chip-orange-fg)',
};

export interface ChipProps {
  tone?: ChipTone;
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/** Small status pill. text-2xs (11px) is the legibility floor for this UI. */
export const Chip: React.FC<ChipProps> = ({ tone = 'neutral', icon, title, className = '', children }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-2xs font-bold leading-tight ${TONE[tone]} ${className}`}
  >
    {icon}
    <span>{children}</span>
  </span>
);
