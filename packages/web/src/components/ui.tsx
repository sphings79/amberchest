import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useEffect } from 'react';

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium ' +
  'transition-all duration-150 outline-none disabled:opacity-45 disabled:pointer-events-none ' +
  'focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98]';

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): ReactNode {
  const styles: Record<ButtonVariant, string> = {
    primary: 'text-[var(--accent-text)] shadow-sm hover:brightness-110',
    secondary: 'hover:brightness-105',
    ghost: 'hover:bg-[var(--surface-2)]',
    danger: 'text-[var(--danger)] hover:bg-[var(--danger-soft)]',
  };

  const inline: Record<ButtonVariant, Record<string, string>> = {
    primary: { background: 'var(--accent)' },
    secondary: { background: 'var(--surface-2)', border: '1px solid var(--border)' },
    ghost: {},
    danger: { border: '1px solid var(--border)' },
  };

  return (
    <button
      type="button"
      {...props}
      className={cx(BUTTON_BASE, styles[variant], className)}
      style={{
        ...inline[variant],
        // @ts-expect-error - CSS custom property
        '--tw-ring-color': 'var(--accent-ring)',
        ...props.style,
      }}
    />
  );
}

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>): ReactNode {
  return (
    <div
      {...rest}
      className={cx('rounded-2xl border p-5', className)}
      style={{ background: 'var(--surface-1)', boxShadow: 'var(--shadow)', ...rest.style }}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
      {hint && !error && (
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {hint}
        </span>
      )}
      {error && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </label>
  );
}

const CONTROL =
  'w-full rounded-xl border px-3 py-2 text-sm outline-none transition ' +
  'focus:ring-2 placeholder:text-[var(--text-faint)]';

export function Input(props: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return (
    <input
      {...props}
      className={cx(CONTROL, props.className)}
      style={{
        background: 'var(--surface-2)',
        color: 'var(--text)',
        // @ts-expect-error - CSS custom property
        '--tw-ring-color': 'var(--accent-ring)',
        ...props.style,
      }}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <select
      {...props}
      className={cx(CONTROL, 'appearance-none', props.className)}
      style={{
        background: 'var(--surface-2)',
        color: 'var(--text)',
        // @ts-expect-error - CSS custom property
        '--tw-ring-color': 'var(--accent-ring)',
        ...props.style,
      }}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-xl px-1 py-1.5 text-left transition hover:bg-[var(--surface-2)]"
    >
      <span
        className="mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition"
        style={{ background: checked ? 'var(--accent)' : 'var(--border-strong)' }}
      >
        <span
          className="h-4 w-4 rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(16px)' : 'none' }}
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {hint && (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
}): ReactNode {
  const tones: Record<string, { background: string; color: string }> = {
    neutral: { background: 'var(--surface-3)', color: 'var(--text-muted)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent)' },
    ok: { background: 'var(--ok-soft)', color: 'var(--ok)' },
    warn: { background: 'var(--warn-soft)', color: 'var(--warn)' },
    danger: { background: 'var(--danger-soft)', color: 'var(--danger)' },
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={tones[tone]}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ value, indeterminate }: { value: number; indeterminate?: boolean }): ReactNode {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
      <div
        className={cx('h-full rounded-full transition-all duration-300', indeterminate && 'progress-stripes')}
        style={{
          width: indeterminate ? '100%' : `${Math.min(100, Math.max(0, value * 100))}%`,
          background: 'var(--accent)',
        }}
      />
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}): ReactNode {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgb(0 0 0 / 45%)' }}>
      <div
        className={cx('animate-fade-up flex max-h-[88vh] w-full flex-col rounded-2xl border', wide ? 'max-w-3xl' : 'max-w-lg')}
        style={{ background: 'var(--surface-1)', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="close" className="h-8 w-8 !px-0">
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-2xl"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
      >
        {icon}
      </div>
      <div className="text-sm font-medium">{title}</div>
      <div className="max-w-sm text-xs" style={{ color: 'var(--text-muted)' }}>
        {description}
      </div>
      {action}
    </div>
  );
}
