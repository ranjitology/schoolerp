import type { HTMLAttributes } from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const tones: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = 'neutral', ...props }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function statusTone(status: string): Tone {
  const value = status.toUpperCase();
  if (['ACTIVE', 'PAID', 'PRESENT', 'PUBLISHED', 'READY', 'OK'].includes(value)) return 'success';
  if (['TRIAL', 'PENDING', 'PARTIALLY_PAID', 'LATE', 'HALF_DAY', 'SCHEDULED'].includes(value)) {
    return 'warning';
  }
  if (['SUSPENDED', 'CANCELLED', 'ABSENT', 'OVERDUE', 'FAILED'].includes(value)) return 'danger';
  if (['ISSUED', 'DRAFT', 'LEAVE', 'INFO'].includes(value)) return 'info';
  return 'neutral';
}
