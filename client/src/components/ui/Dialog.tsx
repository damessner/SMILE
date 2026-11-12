import React from 'react';
import { useDialogA11y } from './useDialogA11y';

interface DialogProps {
  onClose: () => void;
  /** id of the heading that names the dialog. */
  labelledBy: string;
  children: React.ReactNode;
  /** 'center' for a modal card; 'sheet' for a bottom sheet on phones. */
  align?: 'center' | 'sheet';
  panelClassName?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Modal shell: dark scrim (independent of the light/dark theme), focus trap,
 * Escape-to-close and focus restoration. Consumers own the panel markup, so an
 * existing modal can adopt this without restyling its contents.
 */
export const Dialog: React.FC<DialogProps> = ({
  onClose,
  labelledBy,
  children,
  align = 'center',
  panelClassName = '',
  initialFocusRef,
}) => {
  const { dialogRef, handleKeyDown } = useDialogA11y({
    onClose,
    labelledBy,
    initialFocusRef,
  });

  return (
    <div
      className={`fixed inset-0 z-50 scrim flex justify-center p-4 ${align === 'sheet' ? 'items-end sm:items-center' : 'items-center'}`}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
};
