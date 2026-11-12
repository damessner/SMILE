import React from 'react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Consistent empty/error panel: icon, headline, one line of guidance, optional action. */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => (
  <div className={`surface-1 rounded-2xl px-6 py-14 text-center text-slate-400 ${className}`}>
    {icon && <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-800/70 text-slate-400">{icon}</div>}
    <p className="text-base font-bold text-slate-200">{title}</p>
    {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);