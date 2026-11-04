import Link from 'next/link';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Table, Td, Th } from '@/components/ui';
import { ModeBadge } from '@/components/monitoring/badges';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { likeEscape } from '@/lib/queries';
import { formatAddress } from '@/lib/format';
import type { Property } from '@/lib/types';

export const metadata = { title: 'Properties' };

export default async function PropertiesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from('properties').select('*, clients(display_name), devices(status, kind)').neq('status', 'archived').order('name').limit(300);
  if (sp.q) { const t = likeEscape(sp.q); q = q.or(`name.ilike.%${t}%,city.ilike.%${t}%,address_line1.ilike.%${t}%,postal_code.ilike.%${t}%`); }
  const { data } = await q;
  const rows = (data ?? []) as (Property & { clients: { display_name: string } | null; devices: { status: string; kind: string }[] })[];
  return (
    <>
      <PageHeader title="Properties" subtitle="All monitored sites. Create new properties from a client's page." />
      <Card>
        <form className="flex gap-2 border-b border-border px-5 py-3"><Input name="q" defaultValue={sp.q} placeholder="Name, address, city…" className="max-w-xs" /><Button variant="secondary" type="submit">Search</Button></form>
        {rows.length === 0 ? <EmptyState title="No properties." /> : (
          <Table>
            <thead><tr><Th>Property</Th><Th>Client</Th><Th>Mode</Th><Th>Devices</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.map((p) => {
              const off = p.devices.filter((d) => d.status === 'offline').length;
              return (
                <tr key={p.id} className="hover:bg-surface-2">
                  <Td><Link href={`/admin/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link><p className="text-xs text-muted">{formatAddress(p)}</p></Td>
                  <Td className="text-sm"><Link href={`/admin/clients/${p.client_id}`} className="hover:underline">{p.clients?.display_name}</Link></Td>
                  <Td><ModeBadge mode={p.security_mode} /></Td>
                  <Td className="text-sm tabular">{p.devices.length}{off > 0 && <span className="text-bad"> · {off} offline</span>}</Td>
                  <Td><Badge>{p.status}</Badge></Td>
                </tr>
              );
            })}</tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
