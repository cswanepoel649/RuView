import Link from 'next/link';
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatDateTime } from '@/lib/format';
import { createInstallationAction } from './actions';

export const metadata = { title: 'Installations' };

export default async function InstallationsPage() {
  await requireStaff();
  const db = await createClient();
  const [{ data }, { data: props }] = await Promise.all([
    db.from('installations').select('*, properties(name, clients(display_name)), profiles!installations_technician_id_fkey(full_name, email)').order('created_at', { ascending: false }).limit(200),
    db.from('properties').select('id, name, clients(display_name)').in('status', ['planned', 'installing', 'active']).order('name'),
  ]);
  type Row = { id: string; status: string; scheduled_for: string | null; created_at: string; completed_at: string | null; properties: { name: string; clients: { display_name: string } | null } | null; profiles: { full_name: string | null; email: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  return (
    <>
      <PageHeader title="Installations" subtitle="Guided setup from bare ESP32 boards to a live, verified property." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No installations yet." /> : (
            <Table>
              <thead><tr><Th>Property</Th><Th>Technician</Th><Th>Scheduled</Th><Th>Status</Th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <Td><Link href={`/admin/installations/${r.id}`} className="font-medium hover:underline">{r.properties?.name}</Link><p className="text-xs text-muted">{r.properties?.clients?.display_name}</p></Td>
                  <Td className="text-sm">{r.profiles?.full_name ?? r.profiles?.email ?? '—'}</Td>
                  <Td className="text-sm">{formatDateTime(r.scheduled_for)}</Td>
                  <Td><Badge tone={r.status === 'completed' ? 'ok' : r.status === 'cancelled' ? 'neutral' : 'info'}>{r.status.replace('_', ' ')}</Badge></Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="New installation" />
          <CardBody>
            <ActionForm action={createInstallationAction} className="space-y-3">
              <Field label="Property"><Select name="property_id" required>{((props ?? []) as unknown as { id: string; name: string; clients: { display_name: string } | null }[]).map((p) => <option key={p.id} value={p.id}>{p.clients?.display_name} — {p.name}</option>)}</Select></Field>
              <Field label="Scheduled for"><Input name="scheduled_for" type="datetime-local" /></Field>
              <div className="flex justify-end"><SubmitButton>Create</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
