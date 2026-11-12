import React, { useCallback, useEffect as useEffectFn, useRef } from 'react';

/**
 * Keyboard and focus behaviour shared by every modal surface.
 *
 * The app has ~20 hand-rolled overlays. Each one needs the same four things: the
 * overlay must be a dialog to assistive technology, focus must move into it, Tab must
 * not walk into the page behind it, and closing must put focus back where it was.
 * Putting that in one hook keeps the behaviour identical and testable.
 *
 * Usage:
 *   const { dialogRef, handleKeyDown, initialFocusRef } = useDialogA11y({
 *     onClose, labelledBy: 'settings-title',
 *   });
 *   <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title"
 *        tabIndex={-1} onKeyDown={handleKeyDown}> ... </div>
 */
export interface DialogA11yOptions {
  onClose: () => void;
  /** id of the element that names the dialog (usually its heading). */
  labelledBy: string;
  /** Optional element to focus instead of the first focusable child. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useDialogA11y({ onClose, labelledBy, initialFocusRef }: DialogA11yOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fallbackFocusRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffectFn(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Prefer the caller's explicit target, then the nested ref it attached, then the
    // first focusable element, and finally the dialog container itself so focus never
    // stays on the page behind an overlay.
    const explicit = initialFocusRef?.current ?? fallbackFocusRef.current;
    const firstFocusable =
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? null;
    (explicit ?? firstFocusable ?? dialogRef.current)?.focus();
    return () => {
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) previous.focus();
    };
    // Focus is captured once per mount; re-running would steal focus on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === root)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return { dialogRef, handleKeyDown, initialFocusRef: fallbackFocusRef, labelledBy };
}