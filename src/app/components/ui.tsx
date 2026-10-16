/**
 * The component library (M105, docs/design/system.md §7). Every interactive piece the app repeats
 * lives here with its states, so a screen composes these instead of restyling a `<button>`:
 *
 * - Button — primary · secondary · ghost · danger; Default · Hover · Pressed · Focus · Disabled · Loading
 * - IconButton — the same, plus Selected (a menu or panel it opened)
 * - CloseButton — ✕, square (sheets, pickers, fields) or a small round badge (tile corners)
 * - LinkButton — a name that opens its details: always underlined, so a touch reader sees it is one
 * - TextField — Default · Hover · Focus · Filled (clear ✕) · Error · Disabled
 * - TextArea — the same frame, multi-line, with a visible label (M127)
 * - Checkbox · FilterSelect — native controls, styled, with the focus ring kept
 * - Card · SectionTitle · Notice · Toast · Badge · Chip · Skeleton — static
 *
 * A touch screen gets 44px targets (`touch:`), a mouse the dense 24px minimum. Grey only: state is
 * told by fill, frame and marks, never by hue alone.
 */
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Combine,
  Hourglass,
  Loader2,
  Lock,
  Star,
  TriangleAlert,
  Waves,
  X,
} from 'lucide-react';

export type BadgeTone = 'sure' | 'maybe' | 'fuse' | 'start' | 'hard' | 'alert' | 'approx' | 'neutral';

const BADGE_BASE =
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-caption-strong flex-none';
const BADGE_TONE: Record<BadgeTone, { className: string; icon: ReactNode }> = {
  sure: {
    className: 'bg-primary text-primary-fg border border-primary',
    icon: <Check size={11} aria-hidden />,
  },
  maybe: {
    className: 'border border-dashed border-border-strong text-fg-muted',
    icon: <Waves size={11} aria-hidden />,
  },
  fuse: {
    className: 'border border-border-strong bg-surface text-fg-muted',
    icon: <Combine size={11} aria-hidden />,
  },
  start: {
    className: 'border border-border-strong bg-surface text-fg-muted',
    icon: <Star size={11} aria-hidden />,
  },
  hard: {
    className: 'border border-border bg-surface-muted text-fg-muted',
    icon: <Lock size={11} aria-hidden />,
  },
  alert: {
    className: 'border-2 border-fg bg-surface text-fg',
    icon: <TriangleAlert size={11} aria-hidden />,
  },
  approx: {
    className: 'border border-border-strong bg-surface-muted text-fg',
    icon: <Hourglass size={11} aria-hidden />,
  },
  neutral: { className: 'border border-border bg-surface-muted text-fg-muted', icon: null },
};

export function Badge({
  tone,
  children,
  title,
  ariaLabel,
}: {
  tone: BadgeTone;
  children: ReactNode;
  title?: string;
  /** For a badge whose visible text is a bare number: the sentence it stands for. */
  ariaLabel?: string;
}) {
  const { className, icon } = BADGE_TONE[tone];
  return (
    <span className={`${BADGE_BASE} ${className}`} title={title} aria-label={ariaLabel}>
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
      className={`inline-flex h-[22px] flex-none items-center gap-1 whitespace-nowrap rounded-full border px-2 text-caption ${
        on ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface-muted text-fg-muted'
      } ${className}`}
    >
      {children}
    </span>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Hover and Pressed per variant. `enabled:` keeps a disabled button from reacting; Disabled itself is
 * one look for every variant (muted fill, subtle text, plain border) so it reads the same anywhere.
 */
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg border-primary enabled:hover:bg-primary/90 enabled:active:bg-primary/80',
  secondary:
    'bg-surface text-fg border-border-control enabled:hover:bg-surface-muted enabled:active:bg-surface-sunken',
  ghost:
    'bg-transparent text-fg-muted border-transparent enabled:hover:bg-surface-muted enabled:hover:text-fg enabled:active:bg-surface-sunken',
  // Destructive, said by weight rather than hue (direction A): a 2px ink frame.
  danger:
    'bg-surface text-fg border-2 border-fg enabled:hover:bg-surface-muted enabled:active:bg-surface-sunken',
};
const BUTTON_SIZE = {
  sm: 'h-7 px-3 text-caption-strong',
  md: 'h-9 px-3 text-label',
  lg: 'h-10 px-4 text-label',
} as const;
const BUTTON_DISABLED =
  'disabled:border-border disabled:bg-surface-muted disabled:text-fg-subtle aria-busy:cursor-progress';

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  loading = false,
  type = 'button',
  title,
  ariaLabel,
  className = '',
  size = 'md',
  pressed,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Working on it: a spinner leads, the label stays, the width does not move, presses are ignored. */
  loading?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  ariaLabel?: string;
  className?: string;
  size?: keyof typeof BUTTON_SIZE;
  /** A toggle button: its on state (`aria-pressed`). */
  pressed?: boolean;
  testId?: string;
}) {
  return (
    <button
      type={type}
      onClick={loading ? undefined : onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      data-testid={testId}
      className={`inline-flex ${BUTTON_SIZE[size]} flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border transition-colors duration-150 touch:min-h-11 touch:min-w-11 ${BUTTON_DISABLED} ${BUTTON_VARIANT[variant]} ${className}`}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

const ICON_BUTTON_SIZE = { md: 'size-9', lg: 'size-10' } as const;

export function IconButton({
  children,
  onClick,
  label,
  size = 'md',
  disabled = false,
  className = '',
  expanded,
  controls,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  /** md 36px (headers, toolbars), lg 40px (paging a sheet). 44px on touch either way. */
  size?: keyof typeof ICON_BUTTON_SIZE;
  disabled?: boolean;
  className?: string;
  /** For a button that opens a panel or menu: its open state (Selected) and the panel's id. */
  expanded?: boolean;
  controls?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled}
      data-testid={testId}
      className={`inline-flex ${ICON_BUTTON_SIZE[size]} flex-none items-center justify-center rounded-sm border transition-colors duration-150 touch:size-11 disabled:border-border disabled:text-fg-subtle ${
        expanded
          ? 'border-border-strong bg-surface-muted text-fg'
          : 'border-border bg-surface text-fg-muted enabled:hover:bg-surface-muted enabled:hover:text-fg enabled:active:bg-surface-sunken'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * ✕. `square` is a 36px ghost button (a sheet's, a picker's, a field's clear). `badge` is the small
 * round mark in a tile's corner: 16px to see, 24px to press (44px on touch) through a pseudo-element,
 * so the tile's layout does not grow. The caller places a badge (`absolute …`); it sets no position of
 * its own, so the two cannot fight over it. The label names what it closes or removes.
 */
export function CloseButton({
  label,
  onClick,
  variant = 'square',
  size = 'md',
  className = '',
  testId,
}: {
  label: string;
  onClick: () => void;
  variant?: 'square' | 'badge';
  /** The square's size: md 36px (sheets, pickers), sm 24px (inside a compact row or a field). 44px on touch. */
  size?: 'sm' | 'md';
  className?: string;
  testId?: string;
}) {
  if (variant === 'badge') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        data-testid={testId}
        // The border shrinks the pseudo-element's box by 1px a side, hence -inset-[5px] for 24px.
        className={`inline-flex size-4 flex-none items-center justify-center rounded-full border border-border bg-surface text-fg-muted after:absolute after:-inset-[5px] after:content-[''] hover:bg-surface-muted hover:text-fg touch:after:-inset-[15px] ${className}`}
      >
        <X size={10} strokeWidth={2.5} aria-hidden />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={`inline-flex ${size === 'sm' ? 'size-6' : 'size-9'} flex-none items-center justify-center rounded-sm text-fg-muted transition-colors duration-150 hover:bg-surface-muted hover:text-fg active:bg-surface-sunken touch:size-11 ${className}`}
    >
      <X size={size === 'sm' ? 12 : 14} aria-hidden />
    </button>
  );
}

/**
 * A name that opens its details sheet. Always underlined (faintly, darker on hover): a hover-only
 * underline left touch readers with what looked like plain text.
 */
export function LinkButton({
  children,
  onClick,
  ariaLabel,
  muted = false,
  className = '',
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  ariaLabel?: string;
  /** A secondary action (「목표 비우기」): subtle text, full text on hover. */
  muted?: boolean;
  /** The type role and layout (`text-caption …`); the link look is added here. */
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      data-testid={testId}
      data-link
      className={`underline decoration-border-strong underline-offset-2 transition-colors duration-150 hover:decoration-fg ${muted ? 'text-fg-subtle hover:text-fg' : 'text-fg'} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A text field: optional leading icon, the input, a clear ✕ once it holds text (Filled), and an
 * error line under it. The input drops its own outline, so the frame shows focus instead
 * (`focus-within`) — the keyboard always sees where it is. 36px, 44px on touch; the text is the
 * input role (16px on touch, so iOS does not zoom in).
 */
export function TextField({
  value,
  onChange,
  label,
  placeholder,
  icon,
  onClear,
  clearLabel,
  error,
  errorId,
  disabled = false,
  numeric = false,
  className = '',
  inputRef,
  inputProps,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name (the field has no visible label; the placeholder says the same). */
  label: string;
  placeholder?: string;
  icon?: ReactNode;
  /** Show the clear ✕ while the field holds text. */
  onClear?: () => void;
  clearLabel?: string;
  /** An error sentence: the frame turns `danger` and the sentence shows under it with an icon. */
  error?: string | null;
  errorId?: string;
  disabled?: boolean;
  /** Tabular figures, for codes and numbers. */
  numeric?: boolean;
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Anything else the input needs (combobox ARIA, key handlers, focus handlers). */
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'placeholder' | 'disabled'>;
  testId?: string;
}) {
  const invalid = Boolean(error);
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label
        className={`flex h-9 min-w-0 items-center gap-2 rounded-sm border bg-surface px-3 transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus touch:min-h-11 ${
          invalid ? 'border-danger' : 'border-border-control hover:border-fg-subtle'
        } ${disabled ? 'bg-surface-muted text-fg-subtle' : ''}`}
        data-testid={testId}
      >
        {icon ? <span className="flex flex-none text-fg-subtle">{icon}</span> : null}
        <input
          {...inputProps}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid && errorId ? errorId : undefined}
          disabled={disabled}
          className={`min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed ${numeric ? 'font-num' : ''}`}
        />
        {onClear && value !== '' && !disabled ? (
          <CloseButton label={clearLabel ?? label} onClick={onClear} size="sm" className="-mr-1" />
        ) : null}
      </label>
      {invalid ? (
        <p id={errorId} className="flex items-center gap-1 text-caption text-fg" role="alert">
          <CircleAlert size={12} className="flex-none text-danger" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A multi-line field (M127): the `TextField` frame — `border-control`, `sm` radius, the frame shows
 * focus (`focus-within`), `danger` and an error line under it for Error, muted for Disabled — around
 * a native textarea that grows from `rows` and is resized by the reader only vertically. The text
 * is the input role, so a touch screen gets 16px (no iOS zoom). The label is visible: a form of
 * several fields needs to say which is which, not leave it to placeholders.
 */
export function TextArea({
  id,
  value,
  onChange,
  label,
  placeholder,
  rows = 5,
  maxLength,
  required = false,
  error,
  disabled = false,
  className = '',
  testId,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The visible label above the field, which is also its accessible name. */
  label: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  /** An error sentence: the frame turns `danger` and the sentence shows under it with an icon. */
  error?: string | null;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const invalid = Boolean(error);
  const errorId = `${id}-error`;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-label text-fg">
        {label}
      </label>
      <div
        className={`flex min-w-0 rounded-sm border bg-surface transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${
          invalid ? 'border-danger' : 'border-border-control hover:border-fg-subtle'
        } ${disabled ? 'bg-surface-muted text-fg-subtle' : ''}`}
      >
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          maxLength={maxLength}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          disabled={disabled}
          data-testid={testId}
          className="min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed"
        />
      </div>
      {invalid ? (
        <p id={errorId} className="flex items-center gap-1 text-caption text-fg" role="alert">
          <CircleAlert size={12} className="flex-none text-danger" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A checkbox with its label: the native box (accent `primary`), the whole label the target — 44px
 * tall on touch.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
  className = '',
  testId,
  ariaLabel,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`inline-flex min-h-6 items-center gap-2 touch:min-h-11 touch:min-w-11 ${disabled ? 'text-fg-subtle' : ''} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
        data-testid={testId}
        className="size-4 flex-none accent-primary"
      />
      {children}
    </label>
  );
}

export function Card({
  children,
  variant = 'default',
  className = '',
  testId,
  role,
}: {
  children: ReactNode;
  variant?: 'default' | 'dashed' | 'strong';
  className?: string;
  testId?: string;
  role?: 'alert';
}) {
  const border =
    variant === 'dashed'
      ? 'border border-dashed border-border-strong'
      : variant === 'strong'
        ? 'border-2 border-fg'
        : 'border border-border shadow-sm';
  return (
    <section data-testid={testId} role={role} className={`rounded-md bg-surface ${border} ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-subheading text-fg">{children}</h2>
      {right ? <span className="text-caption text-fg-subtle">{right}</span> : null}
    </div>
  );
}

export function Notice({
  children,
  icon,
  strong = false,
}: {
  children: ReactNode;
  icon?: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-caption ${
        strong ? 'border-border-strong bg-surface-muted text-fg' : 'border-border bg-surface text-fg-muted'
      }`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}

/**
 * A short confirmation at the bottom of the screen, clear of the home indicator. There is no bottom
 * navigation to sit above (it once sat at 68px for one).
 */
export function Toast({ children, tone = 'done' }: { children: ReactNode; tone?: 'done' | 'alert' }) {
  const alert = tone === 'alert';
  return (
    <div
      role="status"
      data-testid="toast"
      data-tone={tone}
      style={{ bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      className={`fixed left-4 right-4 z-30 flex items-center gap-2 rounded-md px-4 py-3 text-label shadow-md lg:left-1/2 lg:right-auto lg:-translate-x-1/2 ${
        alert ? 'border-2 border-fg bg-surface text-fg' : 'bg-primary text-primary-fg'
      }`}
    >
      {alert ? <TriangleAlert size={14} aria-hidden /> : <Check size={14} aria-hidden />}
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden className={`block rounded-sm bg-surface-sunken ${className}`} />;
}

/**
 * A native select styled as a filter chip, so keyboard and screen readers get the real control.
 * The select is transparent over the chip, which would hide its focus outline with it — the chip
 * draws the ring instead (`has-[:focus-visible]`). HasValue is the `primary` fill.
 */
/**
 * A form choice: the same frame as `TextField` (36px, `sm` radius, `border-control`, 44px under touch)
 * with the native list underneath, so the platform's own picker opens. `FilterSelect` is the other
 * select — a filter chip with an 「전체」 entry — and is not this.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  testId,
}: {
  /** The accessible name; a visible label next to it should say the same. */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={`relative inline-flex h-9 min-w-0 items-center rounded-sm border transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus touch:min-h-11 ${
        disabled
          ? 'border-border-control bg-surface-muted text-fg-subtle'
          : 'border-border-control bg-surface text-fg hover:border-fg-subtle'
      } ${className}`}
    >
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-full min-w-0 flex-1 appearance-none bg-transparent pr-8 pl-3 outline-none"
        data-testid={testId}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-3 text-fg-subtle" />
    </span>
  );
}

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
      className={`relative inline-flex h-7 flex-none items-center gap-1 rounded-full border px-3 text-caption-strong transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus touch:min-h-11 ${
        on
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-border-control bg-surface text-fg-muted hover:bg-surface-muted'
      }`}
    >
      <span>{on ? `${label} · ${current}` : label}</span>
      <ChevronDown size={12} aria-hidden />
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T | 'all')}
        className="absolute inset-0 opacity-0"
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
