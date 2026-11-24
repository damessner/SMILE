import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'info';
export type ButtonSize = 'sm' | 'md' | 'lg';

/*
  Variants consume the --btn-* component tokens (see index.css), so the light
  theme and beamer mode re-theme every button without touching this file.
*/
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-(--btn-primary-bg) hover:bg-(--btn-primary-bg-hover) text-(--btn-primary-fg) shadow-md',
  secondary:
    'bg-(--btn-secondary-bg) hover:bg-(--btn-secondary-bg-hover) text-(--btn-secondary-fg) border border-(--btn-secondary-border)',
  ghost: 'bg-transparent hover:bg-(--btn-ghost-bg-hover) text-(--btn-secondary-fg) border border-transparent',
  danger: 'bg-(--btn-danger-bg) hover:bg-(--btn-danger-bg-hover) text-(--btn-danger-fg) shadow-md',
  success: 'bg-(--btn-success-bg) hover:bg-(--btn-success-bg-hover) text-(--btn-success-fg) shadow-md',
  info: 'bg-(--btn-info-bg) hover:bg-(--btn-info-bg-hover) text-(--btn-info-fg) shadow-md',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 text-sm rounded-lg',
  md: 'min-h-[44px] px-3.5 text-sm rounded-xl',
  lg: 'min-h-[52px] px-5 text-base rounded-2xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The one button primitive: 44px touch target by default, pressable + focus ring. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`pressable focus-ring inline-flex items-center justify-center gap-2 font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    />
  );
});
