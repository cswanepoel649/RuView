'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Bell, Building2, Cpu, HardDriveDownload, History, House, LayoutDashboard, LifeBuoy, Menu, ScrollText, Settings,
  ShieldCheck, UserPlus, Users, Wrench, X,
} from 'lucide-react';

const Icons = { LayoutDashboard, Users, Building2, Cpu, HardDriveDownload, Wrench, Bell, LifeBuoy, ScrollText, UserPlus, House, Settings, ShieldCheck, History };
import { BrandMark } from '../brand';
import { cn } from '../ui';

export type IconName = keyof typeof Icons;
export interface NavItem { href: string; label: string; icon: IconName; badge?: number; exact?: boolean }

export function Shell({ nav, product, user, children, footer }: { nav: NavItem[]; product: string; user: { name: string; email: string; role: string }; children: ReactNode; footer?: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + '/'));
  const navList = (
    <nav className="flex-1 space-y-0.5 px-3 py-4" aria-label="Main">
      {nav.map((i) => {
        const Icon = Icons[i.icon];
        const active = isActive(i);
        return (
          <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={active ? 'page' : undefined}
            className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              active ? 'bg-nav-active text-white' : 'text-nav-fg hover:bg-nav-active/60 hover:text-white')}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{i.label}</span>
            {!!i.badge && <span className="rounded-full bg-bad px-1.5 text-[11px] font-semibold text-white tabular">{i.badge > 99 ? '99+' : i.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
  const sidebar = (
    <div className="flex h-full flex-col bg-nav">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <BrandMark className="h-7 w-7" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">RuView</p>
          <p className="text-[11px] uppercase tracking-wider text-nav-fg">{product}</p>
        </div>
      </div>
      {navList}
      {footer}
      <div className="border-t border-white/5 px-4 py-4">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-nav-fg">{user.email} · {user.role}</p>
        <div className="mt-3 flex gap-2">
          <Link href="/account" className="text-xs text-nav-fg hover:text-white">Account</Link>
          <form action="/auth/signout" method="post"><button className="text-xs text-nav-fg hover:text-white">Sign out</button></form>
        </div>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2"><BrandMark className="h-6 w-6" /><span className="text-sm font-semibold">RuView {product}</span></div>
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-lg p-2 hover:bg-surface-2"><Menu className="h-5 w-5" /></button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 z-10 rounded p-1 text-nav-fg hover:text-white"><X className="h-5 w-5" /></button>
            {sidebar}
          </div>
        </div>
      )}
      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
