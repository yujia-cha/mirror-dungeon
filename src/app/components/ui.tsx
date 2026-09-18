/**
 * Small shared presentational pieces, grey-only. Acquisition certainty is told apart by fill and
 * dash (확정 = solid ink + check, 가능 = dashed + waves), never by hue.
 */
import type { ReactNode } from 'react';
import { Check, Combine, Star, Lock, TriangleAlert, Waves, Hourglass, ChevronDown } from 'lucide-react';

export type BadgeTone = 'sure' | 'maybe' | 'fuse' | 'start' | 'hard' | 'alert' | 'approx' | 'neutral';

const BADGE_BASE =
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs font-medium flex-none';
const BADGE_TONE: Record<BadgeTone, { className: string; icon: ReactNode }> = {
  sure: { className: 'bg-ink text-ink-fg border border-ink', icon: <Check size={11} aria-hidden /> },
  maybe: { className: 'border border-dashed border-line-strong text-fg-2', icon: <Waves size={11} aria-hidden /> },
  fuse: { className: 'border border-line-strong bg-surface text-fg-2', icon: <Combine size={11} aria-hidden /> },
  start: { className: 'border border-line-strong bg-surface text-fg-2', icon: <Star size={11} aria-hidden /> },
  hard: { className: 'border border-line bg-surface-2 text-fg-2', icon: <Lock size={11} aria-hidden /> },
  alert: { className: 'border-[1.5px] border-fg bg-surface text-fg', icon: <TriangleAlert size={11} aria-hidden /> },
  approx: { className: 'border border-line-strong bg-surface-2 text-fg', icon: <Hourglass size={11} aria-hidden /> },
  neutral: { className: 'border border-line bg-surface-2 text-fg-2', icon: null },
};

export function Badge({ tone, children, title }: { tone: BadgeTone; children: ReactNode; title?: string }) {
  const { className, icon } = BADGE_TONE[tone];
  return (
    <span className={`${BADGE_BASE} ${className}`} title={title}>
      {icon}
      {children}
    </span>
  );
}

export function Chip({
  children,
  on = false,
  title,
  className = '',
}: {
  children: ReactNode;
  on?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs ${
        on ? 'border-ink bg-ink text-ink-fg' : 'border-line bg-surface-2 text-fg-2'
      } ${className}`}
    >
      {children}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  type = 'button',
  title,
  ariaLabel,
  className = '',
  size = 'md',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  ariaLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-ink text-ink-fg border-ink hover:opacity-90',
    secondary: 'bg-surface text-fg border-line-strong hover:bg-surface-2',
    ghost: 'bg-transparent text-fg-2 border-transparent hover:bg-surface-2',
    danger: 'bg-surface text-fg border-[1.5px] border-fg hover:bg-surface-2',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex ${size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm'} flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border font-medium transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-fg-3 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  label,
  className = '',
  expanded,
  controls,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  className?: string;
  /** For a button that opens a panel: its open state and the panel's id. */
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
      className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-sm border ${expanded ? 'border-ink bg-ink text-ink-fg' : 'border-line bg-surface text-fg-2 hover:bg-surface-2'} ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  variant = 'default',
  className = '',
  testId,
}: {
  children: ReactNode;
  variant?: 'default' | 'dashed' | 'strong';
  className?: string;
  testId?: string;
}) {
  const border =
    variant === 'dashed'
      ? 'border border-dashed border-line-strong'
      : variant === 'strong'
        ? 'border-[1.5px] border-fg'
        : 'border border-line shadow-card';
  return (
    <section data-testid={testId} className={`rounded-md bg-surface ${border} ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold text-fg">{children}</h2>
      {right ? <span className="text-xs text-fg-3">{right}</span> : null}
    </div>
  );
}

export function Notice({ children, icon, strong = false }: { children: ReactNode; icon?: ReactNode; strong?: boolean }) {
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        strong ? 'border-line-strong bg-surface-2 text-fg' : 'border-line bg-surface text-fg-2'
      }`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function Toast({ children, tone = 'done' }: { children: ReactNode; tone?: 'done' | 'alert' }) {
  const alert = tone === 'alert';
  return (
    <div
      role="status"
      data-testid="toast"
      data-tone={tone}
      className={`fixed bottom-[68px] left-4 right-4 z-30 flex items-center gap-2 rounded-md px-3.5 py-2.5 text-sm font-medium shadow-pop lg:bottom-6 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 ${
        alert ? 'border-[1.5px] border-fg bg-surface text-fg' : 'bg-ink text-ink-fg'
      }`}
    >
      {alert ? <TriangleAlert size={14} aria-hidden /> : <Check size={14} aria-hidden />}
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block rounded-sm bg-surface-3 ${className}`} />;
}

/** A native select styled as a filter chip, so keyboard and screen readers get the real control. */
export function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  value: T | 'all';
  options: { value: T; label: string }[];
  onChange: (value: T | 'all') => void;
  allLabel: string;
}) {
  const on = value !== 'all';
  const current = options.find((o) => o.value === value)?.label;
  return (
    <label
      className={`relative inline-flex h-7 flex-none items-center gap-1 rounded-full border px-2.5 text-xs font-medium ${
        on ? 'border-ink bg-ink text-ink-fg' : 'border-line-strong bg-surface text-fg-2'
      }`}
    >
      <span>{on ? `${label} · ${current}` : label}</span>
      <ChevronDown size={12} aria-hidden />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T | 'all')}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="all">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex overflow-hidden rounded-sm border border-line-strong">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`flex h-[30px] min-w-[30px] items-center justify-center whitespace-nowrap px-2 font-num text-xs ${
              on ? 'bg-ink text-ink-fg' : 'bg-surface text-fg-2 hover:bg-surface-2'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
