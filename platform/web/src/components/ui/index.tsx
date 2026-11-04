import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const btn: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:opacity-90 shadow-sm',
  secondary: 'bg-surface text-fg border border-border hover:bg-surface-2',
  ghost: 'text-fg hover:bg-surface-2',
  danger: 'bg-bad text-white hover:opacity-90',
};
const btnBase = 'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

export function Button({ variant = 'primary', className, ...p }: ComponentProps<'button'> & { variant?: Variant }) {
  return <button className={cn(btnBase, btn[variant], className)} {...p} />;
}
export function LinkButton({ variant = 'secondary', className, ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(btnBase, btn[variant], className)} {...p} />;
}

export function Card({ className, ...p }: ComponentProps<'section'>) {
  return <section className={cn('rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,23,42,.04)]', className)} {...p} />;
}
export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export const CardBody = ({ className, ...p }: ComponentProps<'div'>) => <div className={cn('px-5 py-4', className)} {...p} />;

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'occupied';
const tone: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info', brand: 'bg-brand-soft text-brand', occupied: 'bg-occupied-soft text-occupied',
};
export function Badge({ tone: t = 'neutral', className, ...p }: ComponentProps<'span'> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone[t], className)} {...p} />;
}
const dot: Record<Tone, string> = { neutral: 'text-muted', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-info', brand: 'text-brand', occupied: 'text-occupied' };
export function StatusDot({ tone: t = 'neutral', live = false, label }: { tone?: Tone; live?: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={label}>
      <span className={cn('inline-block h-2 w-2 rounded-full bg-current', dot[t], live && 'live-dot')} />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: { href: string; label: string }[] }) {
  return (
    <header className="mb-6">
      {breadcrumbs && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-sm text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={b.href} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>/</span>}
              <Link href={b.href} className="hover:text-fg">{b.label}</Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Stat({ label, value, hint, tone: t }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cn('mt-1.5 text-2xl font-semibold tabular', t && dot[t])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Notice({ tone: t = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={t === 'bad' ? 'alert' : 'status'} className={cn('rounded-lg px-4 py-3 text-sm', tone[t])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5', 'text-fg/80')}>{children}</div>}
    </div>
  );
}

// ---------- forms ----------
const field = 'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus:border-ring focus:outline-none';
export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
    </label>
  );
}
export const Input = ({ className, ...p }: ComponentProps<'input'>) => <input className={cn(field, className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<'textarea'>) => <textarea className={cn(field, 'min-h-24', className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<'select'>) => <select className={cn(field, 'pr-8', className)} {...p} />;
export function Checkbox({ label, ...p }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--brand)]" {...p} />
      <span>{label}</span>
    </label>
  );
}

// ---------- tables ----------
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ className, ...p }: ComponentProps<'th'>) => <th className={cn('border-b border-border px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-muted', className)} {...p} />;
export const Td = ({ className, ...p }: ComponentProps<'td'>) => <td className={cn('border-b border-border px-5 py-3 align-middle', className)} {...p} />;

// ---------- tabs (route based) ----------
export function Tabs({ items, active }: { items: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border" aria-label="Sections">
      {items.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === active ? 'page' : undefined}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            t.key === active ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg')}>
          {t.label}{t.count != null && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
