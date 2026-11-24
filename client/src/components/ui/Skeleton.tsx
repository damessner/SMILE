import React from 'react';

interface SkeletonProps {
  className?: string;
}

/** One loading placeholder block; compose several for a card/list skeleton. */
export const Skeleton: React.FC<SkeletonProps> = ({ className = 'h-4 w-full' }) => (
  <div aria-hidden="true" className={`skeleton rounded-xl ${className}`} />
);

/** A stack of text lines, last one short — reads as a paragraph placeholder. */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className = '',
}) => (
  <div aria-hidden="true" className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, index) => (
      <div
        key={index}
        className={`skeleton h-3.5 rounded-lg ${index === lines - 1 ? 'w-2/3' : 'w-full'}`}
      />
    ))}
  </div>
);
