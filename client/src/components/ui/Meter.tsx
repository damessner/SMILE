import React from 'react';

export interface MeterProps {
  /** 0–100. Rendered into the --meter-value custom property (lint-legal inline style). */
  value: number;
  /** Vertical bar: height follows the value instead of width. */
  vertical?: boolean;
  /** Wrap in a .meter-track (rounded, surface-colored) — the common progress-bar case. */
  track?: boolean;
  className?: string;
  title?: string;
  /** Optional label rendered inside the fill (e.g. the count on a bar chart). */
  children?: React.ReactNode;
}

/**
 * Distribution / progress bar fill.
 *
 * With `track` it renders track + fill (a standalone progress bar). Without it
 * (`bare`) it renders only the fill, for stacked segment bars where the caller
 * owns the track — pass the segment's color via className as usual.
 *
 * The only inline style is a custom-property assignment; the size itself is
 * applied by .meter-fill in index.css, so theme and motion stay in CSS.
 */
export const Meter: React.FC<MeterProps> = ({
  value,
  vertical = false,
  track = false,
  className = '',
  title,
  children,
}) => {
  const fill = (
    <div
      className={`meter-fill${vertical ? ' meter-fill-vertical' : ''} ${className}`}
      style={{ '--meter-value': `${Math.max(0, Math.min(100, value))}%` } as React.CSSProperties}
      title={title}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      {children}
    </div>
  );
  if (!track) return fill;
  return <div className="meter-track h-full w-full">{fill}</div>;
};
