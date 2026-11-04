import Link from 'next/link';
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, Button } from '@/components/ui';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { likeEscape } from '@/lib/queries';
import type { Client } from '@/lib/types';

export const metadata = { title: 'Clients' };
const PAGE = 50;

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const s = await requireStaff();
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const db = await createClient();
  let q = db.from('clients').select('*, properties(count), client_members(count)', { count: 'exact' }).order('display_name').range(page * PAGE, page * PAGE + PAGE - 1);
  if (sp.status) q = q.eq('status', sp.status);
  else q = q.neq('status', 'archived');
  if (sp.q) {
    const t = likeEscape(sp.q);
    q = q.or(`display_name.ilike.%${t}%,legal_name.ilike.%${t}%,primary_email.ilike.%${t}%,account_ref.ilike.%${t}%`);
  }
  const { data, count } = await q;
  const rows = (data ?? []) as (Client & { properties: { count: number }[]; client_members: { count: number }[] })[];
  return (
    <>
      <PageHeader title="Clients" subtitle={`${count ?? 0} client accounts`} actions={s.isAdmin && <LinkButton href="/admin/clients/new" variant="primary">New client</LinkButton>} />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          <Input name="q" defaultValue={sp.q} placeholder="Search name, email, reference…" className="max-w-xs" />
          <Select name="status" defaultValue={sp.status ?? ''} className="max-w-[180px]">
            <option value="">Active & suspended</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option>
          </Select>
          <Button variant="secondary" type="submit">Filter</Button>
        </form>
        {rows.length === 0 ? <EmptyState title="No clients found." action={s.isAdmin && <LinkButton href="/admin/clients/new">Create the first client</LinkButton>} /> : (
          <Table>
            <thead><tr><Th>Client</Th><Th>Contact</Th><Th>Properties</Th><Th>Users</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <Td><Link href={`/admin/clients/${c.id}`} className="font-medium hover:underline">{c.display_name}</Link>{c.account_ref && <p className="text-xs text-muted">{c.account_ref}</p>}</Td>
                  <Td className="text-sm">{c.primary_email ?? '—'}<p className="text-xs text-muted">{c.primary_phone}</p></Td>
                  <Td className="tabular">{c.properties[0]?.count ?? 0}</Td>
                  <Td className="tabular">{c.client_members[0]?.count ?? 0}</Td>
                  <Td><Badge tone={c.status === 'active' ? 'ok' : c.status === 'suspended' ? 'warn' : 'neutral'}>{c.status}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {(count ?? 0) > PAGE && (
          <div className="flex justify-between px-5 py-3 text-sm">
            {page > 0 ? <Link href={`?${new URLSearchParams({ ...sp, page: String(page - 1) })}`}>← Previous</Link> : <span />}
            {(page + 1) * PAGE < (count ?? 0) && <Link href={`?${new URLSearchParams({ ...sp, page: String(page + 1) })}`}>Next →</Link>}
          </div>
        )}
      </Card>
    </>
  );
}
