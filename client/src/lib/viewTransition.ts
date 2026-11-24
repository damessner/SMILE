/**
 * View Transitions wrapper (StyleX `viewTransitionClass` analog).
 *
 * Runs `update` inside document.startViewTransition when the API exists
 * (Safari/iPadOS 18+) and the user has not asked for reduced motion; otherwise
 * it runs the update directly. Call it around state changes that should
 * cross-fade: tab switches, theme toggle.
 */
export function withViewTransition(update: () => void): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    update();
    return;
  }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  if (reduced || typeof doc.startViewTransition !== 'function') {
    update();
    return;
  }
  doc.startViewTransition(update);
}
