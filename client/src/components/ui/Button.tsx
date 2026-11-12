import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'info';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700',
  ghost: 'bg-transparent hover:bg-slate-800 text-slate-300 border border-transparent',
  danger: 'bg-rose-600 hover:bg-rose-500 text-slate-50 shadow-md',
  success: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-md',
  info: 'bg-sky-600 hover:bg-sky-500 text-slate-50 shadow-md',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 text-xs rounded-lg',
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