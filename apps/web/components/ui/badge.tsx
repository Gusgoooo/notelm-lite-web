import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const styles =
    variant === 'secondary'
      ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
      : variant === 'outline'
        ? 'border border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-300'
        : 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900';
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        styles,
        className
      )}
      {...props}
    />
  );
}
