import Link from 'next/link';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { DeviceStatusBadge, SignalBars } from '@/components/monitoring/badges';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { likeEscape } from '@/lib/queries';
import type { Device, DeviceModel } from '@/lib/types';
import { registerDeviceAction } from './actions';

export const metadata = { title: 'Devices' };

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; kind?: string; property?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from('devices').select('*, properties(name), clients(display_name)').order('updated_at', { ascending: false }).limit(300);
  if (sp.status) q = q.eq('status', sp.status);
  if (sp.kind) q = q.eq('kind', sp.kind);
  if (sp.property) q = q.eq('property_id', sp.property);
  if (sp.q) { const t = likeEscape(sp.q); q = q.or(`name.ilike.%${t}%,hw_id.ilike.%${t}%,serial_number.ilike.%${t}%`); }
  const [{ data }, { data: models }, counts] = await Promise.all([
    q, db.from('device_models').select('*').eq('supported', true).order('kind').order('name'),
    db.from('devices').select('status'),
  ]);
  const tally = ((counts.data ?? []) as { status: string }[]).reduce<Record<string, number>>((a, d) => ({ ...a, [d.status]: (a[d.status] ?? 0) + 1 }), {});
  const rows = (data ?? []) as (Device & { properties: { name: string } | null; clients: { display_name: string } | null })[];
  return (
    <>
      <PageHeader title="Devices" subtitle={`${Object.values(tally).reduce((a, b) => a + b, 0)} devices · ${tally.online ?? 0} online · ${tally.offline ?? 0} offline · ${tally.inventory ?? 0} in stock`} />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <form className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
            <Input name="q" defaultValue={sp.q} placeholder="Name, MAC, serial…" className="max-w-xs" />
            <Select name="kind" defaultValue={sp.kind ?? ''} className="max-w-[160px]"><option value="">All kinds</option><option value="sensor_node">Sensors</option><option value="gateway">Gateways</option></Select>
            <Select name="status" defaultValue={sp.status ?? ''} className="max-w-[160px]"><option value="">Any status</option>{['inventory', 'assigned', 'provisioned', 'online', 'offline', 'fault', 'retired'].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
            <Button variant="secondary" type="submit">Filter</Button>
          </form>
          {rows.length === 0 ? <EmptyState title="No devices match." /> : (
            <Table>
              <thead><tr><Th>Device</Th><Th>Location</Th><Th>Firmware</Th><Th>Signal</Th><Th>Status</Th></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-2">
                    <Td><Link href={`/admin/devices/${d.id}`} className="font-medium hover:underline">{d.name}</Link>
                      <p className="text-xs text-muted">{d.kind === 'gateway' ? 'Gateway' : `Sensor${d.node_id ? ` · node ${d.node_id}` : ''}`} · {d.model_id}{d.hw_id ? ` · ${d.hw_id}` : ''}</p></Td>
                    <Td className="text-sm">{d.clients?.display_name ?? <Badge>Stock</Badge>}<p className="text-xs text-muted">{d.properties?.name}</p></Td>
                    <Td className="text-sm">{d.firmware_version ?? '—'}</Td>
                    <Td>{d.kind === 'sensor_node' ? <SignalBars rssi={d.last_rssi} /> : '—'}</Td>
                    <Td><DeviceStatusBadge status={d.status} lastSeen={d.last_seen_at} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Register hardware" subtitle="Add stock to inventory. Boards flashed in the wizard are registered automatically from their MAC." />
          <CardBody>
            <ActionForm action={registerDeviceAction} className="space-y-3">
              <Field label="Kind"><Select name="kind" defaultValue="sensor_node"><option value="sensor_node">Sensor node</option><option value="gateway">Gateway</option></Select></Field>
              <Field label="Model"><Select name="model_id" required>{((models ?? []) as DeviceModel[]).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></Field>
              <Field label="Name"><Input name="name" required placeholder="e.g. Node S3-0142" /></Field>
              <Field label="Serial / label"><Input name="serial_number" /></Field>
              <Field label="MAC (sensors)" hint="Printed on the module or read in the wizard."><Input name="hw_id" placeholder="aa:bb:cc:dd:ee:ff" /></Field>
              <Field label="Notes"><Textarea name="notes" /></Field>
              <div className="flex justify-end"><SubmitButton>Register</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
