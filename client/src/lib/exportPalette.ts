/**
 * Palette for the standalone HTML exports (conference protocol, class reports).
 *
 * A downloaded/printed file has no stylesheet, so it cannot read the app's CSS
 * variables. These values mirror the LIGHT theme tokens in index.css
 * (semantic remap of the slate ramp) — keep the two in sync when the light
 * theme changes. This file is the allowlisted home for hex literals in
 * client/src (see scripts/lint-design.mjs).
 */
export const exportPalette = {
  ink: '#0f172a', // headings / strong text (light-theme slate-900 role)
  body: '#334155', // secondary text
  muted: '#64748b', // captions (WCAG AA on white)
  faint: '#475569', // meta rows
  border: '#cbd5e1', // hairline strong
  surface: '#f1f5f9', // table header, chip fill
  surfaceAlt: '#f8fafc', // stats card
  track: '#e2e8f0', // empty bar background
  badgeBg: '#fef3c7',
  badgeFg: '#78350f',
  badgeBorder: '#fcd34d',
  // Vote categories (Lehrling / Geselle / Meister)
  rose: '#f43f5e',
  roseBg: '#fff1f2',
  roseCardBg: '#ffe4e6',
  roseCardFg: '#9f1239',
  roseCardBorder: '#fda4af',
  blue: '#3b82f6',
  blueBg: '#eff6ff',
  amber: '#fbbf24',
  amberBg: '#fffbeb',
  amberCardBg: '#fef9c3',
  amberCardFg: '#854d0e',
  amberCardBorder: '#fde047',
} as const;
