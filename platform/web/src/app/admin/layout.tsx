import { Shell, type NavItem } from '@/components/shell/Shell';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: { default: 'Operations', template: '%s · Operations' } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const supabase = await createClient();
  const [{ count: critical }, { count: tickets }] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('severity', 'critical').is('acknowledged_at', null),
    supabase.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
  ]);
  const nav: NavItem[] = [
    { href: '/admin', label: 'Overview', icon: 'LayoutDashboard', exact: true },
    { href: '/admin/clients', label: 'Clients', icon: 'Users' },
    { href: '/admin/properties', label: 'Properties', icon: 'Building2' },
    { href: '/admin/installations', label: 'Installations', icon: 'Wrench' },
    { href: '/admin/devices', label: 'Devices', icon: 'Cpu' },
    { href: '/admin/firmware', label: 'Firmware', icon: 'HardDriveDownload' },
    { href: '/admin/alerts', label: 'Alerts', icon: 'Bell', badge: critical ?? 0 },
    { href: '/admin/tickets', label: 'Support', icon: 'LifeBuoy', badge: tickets ?? 0 },
    ...(s.isAdmin ? ([
      { href: '/admin/team', label: 'Team', icon: 'UserPlus' },
      { href: '/admin/audit', label: 'Audit log', icon: 'ScrollText' },
    ] satisfies NavItem[]) : []),
  ];
  return (
    <Shell nav={nav} product="Operations" user={{ name: s.profile.full_name ?? s.email, email: s.email, role: s.isAdmin ? 'Administrator' : 'Installer' }}>
      {children}
    </Shell>
  );
}
