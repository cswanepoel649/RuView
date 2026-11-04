import Link from 'next/link';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { timeAgo } from '@/lib/format';
import type { Ticket } from '@/lib/types';

export const metadata = { title: 'Support' };

export default async function SupportList() {
  await requireClientUser();
  const db = await createClient();
  const { data } = await db.from('support_tickets').select('*').order('updated_at', { ascending: false }).limit(100);
  const rows = (data ?? []) as Ticket[];
  return (
    <>
      <PageHeader title="Support" subtitle="Report a problem with a device, an alert or your account." actions={<LinkButton href="/app/support/new" variant="primary">Report a problem</LinkButton>} />
      <Card>{rows.length === 0 ? <EmptyState title="No requests yet." /> : (
        <ul className="divide-y divide-border">{rows.map((t) => (
          <li key={t.id}><Link href={`/app/support/${t.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
            <span><span className="font-medium">#{t.reference} {t.subject}</span><span className="block text-xs text-muted">{t.category} · updated {timeAgo(t.updated_at)}</span></span>
            <Badge tone={t.status === 'resolved' || t.status === 'closed' ? 'ok' : 'info'}>{t.status.replace('_', ' ')}</Badge>
          </Link></li>
        ))}</ul>
      )}</Card>
    </>
  );
}
