import Link from 'next/link';
import { Badge, Button, Card, EmptyState, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { timeAgo } from '@/lib/format';
import type { Ticket } from '@/lib/types';

export const metadata = { title: 'Support' };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from('support_tickets').select('*, clients(display_name), properties(name)').order('updated_at', { ascending: false }).limit(200);
  q = sp.status ? q.eq('status', sp.status) : q.not('status', 'in', '(resolved,closed)');
  const { data } = await q;
  const rows = (data ?? []) as (Ticket & { clients: { display_name: string } | null; properties: { name: string } | null })[];
  return (
    <>
      <PageHeader title="Support" subtitle="Problems reported by clients and internal tickets." />
      <Card>
        <form className="flex gap-2 border-b border-border px-5 py-3">
          <Select name="status" defaultValue={sp.status ?? ''} className="max-w-[200px]"><option value="">Open tickets</option>{['open', 'in_progress', 'waiting_client', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
          <Button variant="secondary" type="submit">Filter</Button>
        </form>
        {rows.length === 0 ? <EmptyState title="No tickets." /> : (
          <Table>
            <thead><tr><Th>Ticket</Th><Th>Client</Th><Th>Priority</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.id} className="hover:bg-surface-2">
                <Td><Link href={`/admin/tickets/${t.id}`} className="font-medium hover:underline">#{t.reference} {t.subject}</Link><p className="text-xs text-muted">{t.category}</p></Td>
                <Td className="text-sm">{t.clients?.display_name}<p className="text-xs text-muted">{t.properties?.name}</p></Td>
                <Td><Badge tone={t.priority === 'urgent' || t.priority === 'high' ? 'warn' : 'neutral'}>{t.priority}</Badge></Td>
                <Td><Badge tone="info">{t.status.replace('_', ' ')}</Badge></Td>
                <Td className="text-xs text-muted">{timeAgo(t.updated_at)}</Td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
