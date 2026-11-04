import { Button, Card, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Audit log' };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; client?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
  if (sp.entity) q = q.eq('entity_type', sp.entity);
  if (sp.client && /^[0-9a-f-]{36}$/.test(sp.client)) q = q.eq('client_id', sp.client);
  const { data } = await q;
  const rows = (data ?? []) as { id: number; actor_id: string | null; actor_type: string; client_id: string | null; entity_type: string; entity_id: string | null; action: string; changes: Record<string, unknown>; created_at: string }[];
  const actors = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: profs } = actors.length ? await db.from('profiles').select('id, email').in('id', actors) : { data: [] };
  const who = new Map(((profs ?? []) as { id: string; email: string }[]).map((p) => [p.id, p.email]));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Append-only record of configuration changes (secrets are never recorded)." />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          <Select name="entity" defaultValue={sp.entity ?? ''} className="max-w-[200px]"><option value="">All entities</option>{['clients', 'client_members', 'properties', 'rooms', 'security_zones', 'devices', 'device_commands', 'firmware_releases', 'alert_rules', 'installations', 'profiles'].map((e) => <option key={e} value={e}>{e}</option>)}</Select>
          <Input name="client" defaultValue={sp.client} placeholder="Client id" className="max-w-xs" />
          <Button variant="secondary" type="submit">Filter</Button>
        </form>
        <Table>
          <thead><tr><Th>When</Th><Th>Actor</Th><Th>Change</Th><Th>Details</Th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.created_at)}</Td>
              <Td className="text-sm">{r.actor_id ? who.get(r.actor_id) ?? r.actor_id.slice(0, 8) : r.actor_type}</Td>
              <Td className="text-sm"><span className="font-medium">{r.action}</span> {r.entity_type}<p className="font-mono text-[11px] text-muted">{r.entity_id}</p></Td>
              <Td><pre className="max-h-28 max-w-md overflow-auto text-[11px] text-muted">{JSON.stringify(r.changes, null, 1)}</pre></Td>
            </tr>
          ))}</tbody>
        </Table>
      </Card>
    </>
  );
}
