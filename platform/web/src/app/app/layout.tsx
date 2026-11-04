import { Shell, type NavItem } from '@/components/shell/Shell';
import { EmptyState, Card } from '@/components/ui';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: { default: 'My home', template: '%s · RuView' } };

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const s = await requireClientUser();
  const db = await createClient();
  const { count } = await db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', s.userId).eq('channel', 'in_app').is('read_at', null);
  const nav: NavItem[] = [
    { href: '/app', label: 'My properties', icon: 'House', exact: true },
    { href: '/app/alerts', label: 'Alerts', icon: 'Bell', badge: count ?? 0 },
    { href: '/app/settings', label: 'Notifications', icon: 'Settings' },
    { href: '/app/support', label: 'Support', icon: 'LifeBuoy' },
    ...(s.isStaff ? ([{ href: '/admin', label: 'Operations console', icon: 'ShieldCheck' }] satisfies NavItem[]) : []),
  ];
  const role = s.memberships.length === 1 ? s.memberships[0]!.role : 'member';
  return (
    <Shell nav={nav} product="Home" user={{ name: s.profile.full_name ?? s.email, email: s.email, role: s.memberships.map((m) => m.client_name).join(', ') || role }}>
      {s.memberships.length === 0 ? (
        <Card><EmptyState title="Your account is not linked to a property yet.">Your installer will grant access once your home is set up. If you believe this is a mistake, contact your installer.</EmptyState></Card>
      ) : s.memberships.every((m) => m.client_status === 'suspended') ? (
        <Card><EmptyState title="This account is suspended.">Please contact your service provider.</EmptyState></Card>
      ) : children}
    </Shell>
  );
}
