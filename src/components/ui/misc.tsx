import * as React from 'react';

import { cn } from '@/lib/utils';
import { initials as toInitials } from '@/lib/utils';

/** Small status/label pill. */
export function Badge({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline';
}) {
  const variants = {
    default: 'bg-primary/10 text-primary ring-primary/20',
    secondary: 'bg-secondary text-secondary-foreground ring-border',
    success: 'bg-success/10 text-success ring-success/20',
    warning: 'bg-warning/10 text-warning ring-warning/25',
    destructive: 'bg-destructive/10 text-destructive ring-destructive/20',
    outline: 'text-muted-foreground ring-border',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Loading placeholder with a shimmer sweep. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('shimmer rounded-md bg-muted', className)} {...props} />
  );
}

/**
 * Deterministic colour avatar.
 *
 * The hue is derived from the name so the same person keeps the same colour
 * across sessions without storing anything.
 */
export function Avatar({
  name,
  className,
  size = 'default',
}: {
  name: string;
  className?: string;
  size?: 'sm' | 'default';
}) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        size === 'sm' ? 'size-6 text-[10px]' : 'size-8 text-xs',
        className,
      )}
      style={{ backgroundColor: `hsl(${hue} 62% 45%)` }}
    >
      {toInitials(name)}
    </span>
  );
}

/** Centred empty-state block for lists with nothing in them. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="rounded-full bg-muted p-3">
          <Icon className="size-6 text-muted-foreground" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Inline form/system error message with consistent styling. */
export function ErrorText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return (
    <p role="alert" className={cn('text-sm text-destructive', className)}>
      {children}
    </p>
  );
}
