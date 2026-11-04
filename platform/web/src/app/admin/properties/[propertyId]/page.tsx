import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, LinkButton, Notice, PageHeader, Select, Table, Tabs, Td, Th, Textarea } from '@/components/ui';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/ui/forms';
import { LiveFloorPlan } from '@/components/monitoring/LiveFloorPlan';
import { SecurityModeControl } from '@/components/monitoring/SecurityModeControl';
import { ZoneEditor } from '@/components/monitoring/ZoneEditor';
import { DeviceStatusBadge, SignalBars } from '@/components/monitoring/badges';
import { EventList } from '@/components/monitoring/EventList';
import { FloorPlanUpload } from '@/components/admin/FloorPlanUpload';
import { RoomShapeEditor } from '@/components/admin/RoomShapeEditor';
import { TimezoneSelect } from '@/components/admin/ClientFields';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property-data';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';
import { formatAddress } from '@/lib/format';
import type { Device } from '@/lib/types';
import {
  createFloorAction, createRoomAction, deleteFloorAction, deleteRoomAction, saveRoomShapeAction, setFloorPlanAction,
  startInstallationAction, updatePropertyAction, updateRoomAction,
} from '../actions';
import { assignDeviceAction } from '../../devices/actions';

const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'hallway', 'entrance', 'office', 'garage', 'dining', 'laundry', 'storage', 'outdoor', 'other'];
const TABS = ['overview', 'layout', 'zones', 'devices', 'settings'] as const;

export default async function AdminProperty({ params, searchParams }: { params: Promise<{ propertyId: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireStaff();
  const { propertyId } = await params;
  const tab = (TABS as readonly string[]).includes((await searchParams).tab ?? '') ? (await searchParams).tab! : 'overview';
  const data = await loadProperty(propertyId);
  if (!data) notFound();
  const { property: p, floors, rooms, states, zones, zoneRooms, devices } = data;
  const db = await createClient();
  const [{ data: client }, { data: events }, { data: inventory }, { data: install }] = await Promise.all([
    db.from('clients').select('id, display_name').eq('id', p.client_id).single(),
    db.from('events').select(EVENT_SELECT).eq('property_id', propertyId).order('occurred_at', { ascending: false }).limit(15),
    tab === 'devices' ? db.from('devices').select('id, name, kind, model_id, hw_id').is('property_id', null).neq('status', 'retired').order('kind').limit(200) : Promise.resolve({ data: [] }),
    db.from('installations').select('id, status').eq('property_id', propertyId).in('status', ['draft', 'in_progress']).maybeSingle(),
  ]);
  const gateways = devices.filter((d) => d.kind === 'gateway');
  const sensors = devices.filter((d) => d.kind === 'sensor_node');
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const href = (t: string) => `/admin/properties/${propertyId}?tab=${t}`;

  return (
    <>
      <PageHeader title={p.name} subtitle={formatAddress(p)}
        breadcrumbs={[{ href: '/admin/clients', label: 'Clients' }, { href: `/admin/clients/${p.client_id}`, label: client?.display_name ?? 'Client' }]}
        actions={install ? <LinkButton href={`/admin/installations/${install.id}`} variant="primary">Continue installation</LinkButton> : (
          <form action={startInstallationAction}><input type="hidden" name="property_id" value={p.id} /><Button type="submit">Start installation wizard</Button></form>
        )} />
      <Tabs active={tab} items={[
        { key: 'overview', label: 'Live overview', href: href('overview') },
        { key: 'layout', label: 'Floors & rooms', href: href('layout'), count: rooms.length },
        { key: 'zones', label: 'Security zones', href: href('zones'), count: zones.length },
        { key: 'devices', label: 'Devices', href: href('devices'), count: devices.length },
        { key: 'settings', label: 'Settings', href: href('settings') },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <LiveFloorPlan propertyId={p.id} floors={floors} rooms={rooms} initialStates={states} />
          <div className="space-y-6">
            <Card><CardHeader title="Security mode" /><CardBody>
              <SecurityModeControl propertyId={p.id} mode={p.security_mode} changedAt={p.security_mode_changed_at} exitDelayS={p.exit_delay_s} canOperate />
            </CardBody></Card>
            <Card>
              <CardHeader title="Hardware" subtitle={`${gateways.length} gateway · ${sensors.length} sensors`} />
              <ul className="divide-y divide-border">
                {devices.map((d) => (
                  <li key={d.id}><Link href={`/admin/devices/${d.id}`} className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-surface-2">
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{d.name}</span><span className="text-xs text-muted">{d.kind === 'gateway' ? 'Gateway' : `Node ${d.node_id ?? '—'} · ${roomName.get(d.room_id ?? '') ?? 'no room'}`}</span></span>
                    <DeviceStatusBadge status={d.status} lastSeen={d.last_seen_at} />
                  </Link></li>
                ))}
                {devices.length === 0 && <li><EmptyState title="No hardware assigned yet." /></li>}
              </ul>
            </Card>
            <Card><CardHeader title="Recent events" /><EventList events={flattenEvents(events)} tz={p.timezone} hrefFor={(e) => `/admin/alerts?event=${e.id}`} /></Card>
          </div>
        </div>
      )}

      {tab === 'layout' && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Floors" subtitle="Upload a plan per floor, then outline each room on it." />
            <ul className="divide-y divide-border">
              {floors.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div><p className="font-medium">{f.name}</p><p className="text-xs text-muted">Level {f.level} · {f.plan_path ? 'plan uploaded' : 'no plan'}</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <FloorPlanUpload clientId={p.client_id} propertyId={p.id} floorId={f.id} onSaved={setFloorPlanAction.bind(null, f.id)} />
                    <form action={deleteFloorAction}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="property_id" value={p.id} /><ConfirmSubmit message={`Delete floor ${f.name}? Rooms stay but lose their floor.`} variant="secondary">Delete</ConfirmSubmit></form>
                  </div>
                </li>
              ))}
            </ul>
            <CardBody className="border-t border-border">
              <ActionForm action={createFloorAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="property_id" value={p.id} />
                <Field label="Floor name"><Input name="name" required placeholder="Ground floor" /></Field>
                <Field label="Level"><Input name="level" type="number" defaultValue={floors.length} className="w-24" /></Field>
                <SubmitButton>Add floor</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Rooms" subtitle="Each sensor is assigned to one room. Rooms can be grouped into security zones." />
            <Table>
              <thead><tr><Th>Room</Th><Th>Type</Th><Th>Floor</Th><Th>Monitored</Th><Th /></tr></thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <Td colSpan={4} className="p-0">
                      <form action={updateRoomAction} className="grid grid-cols-[1.4fr_1fr_1fr_auto_auto] items-center gap-3 px-5 py-2">
                        <input type="hidden" name="id" value={r.id} /><input type="hidden" name="property_id" value={p.id} />
                        <Input name="name" defaultValue={r.name} required />
                        <Select name="room_type" defaultValue={r.room_type}>{ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
                        <Select name="floor_id" defaultValue={r.floor_id ?? ''}><option value="">—</option>{floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select>
                        <Checkbox name="monitoring_enabled" label="" defaultChecked={r.monitoring_enabled} aria-label="Monitoring enabled" />
                        <Button variant="secondary" type="submit" className="py-1.5">Save</Button>
                      </form>
                    </Td>
                    <Td><form action={deleteRoomAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="property_id" value={p.id} /><ConfirmSubmit message={`Delete room ${r.name}? Its history will no longer be attributed to a room.`} variant="ghost">Delete</ConfirmSubmit></form></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <CardBody className="border-t border-border">
              <ActionForm action={createRoomAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="property_id" value={p.id} />
                <Field label="Room name"><Input name="name" required placeholder="Living room" /></Field>
                <Field label="Type"><Select name="room_type" defaultValue="living">{ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                <Field label="Floor"><Select name="floor_id" defaultValue={floors[0]?.id ?? ''}><option value="">—</option>{floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
                <SubmitButton>Add room</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>

          {floors.map((f) => (
            <Card key={f.id}>
              <CardHeader title={`Room outlines · ${f.name}`} subtitle="Used for the live floor-plan view." />
              <CardBody>
                <RoomShapeEditor rooms={rooms.filter((r) => r.floor_id === f.id)} planUrl={f.plan_url} aspect={f.plan_width && f.plan_height ? f.plan_height / f.plan_width : 0.62} onSave={saveRoomShapeAction} />
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {tab === 'zones' && <ZoneEditor propertyId={p.id} zones={zones} rooms={rooms} zoneRooms={zoneRooms} canEdit />}

      {tab === 'devices' && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Installed hardware" actions={<LinkButton href={`/admin/devices?property=${p.id}`} variant="ghost">Open in inventory</LinkButton>} />
            {devices.length === 0 ? <EmptyState title="No devices at this property." /> : (
              <Table>
                <thead><tr><Th>Device</Th><Th>Room</Th><Th>Node</Th><Th>Firmware</Th><Th>Signal</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {devices.map((d: Device) => (
                    <tr key={d.id}>
                      <Td><Link href={`/admin/devices/${d.id}`} className="font-medium hover:underline">{d.name}</Link><p className="text-xs text-muted">{d.model_id}{d.hw_id ? ` · ${d.hw_id}` : ''}</p></Td>
                      <Td>{d.kind === 'gateway' ? <Badge>Gateway</Badge> : roomName.get(d.room_id ?? '') ?? <span className="text-warn">Unassigned</span>}</Td>
                      <Td className="tabular">{d.node_id ?? '—'}</Td>
                      <Td className="text-sm">{d.firmware_version ?? '—'}</Td>
                      <Td>{d.kind === 'sensor_node' ? <SignalBars rssi={d.last_rssi} /> : '—'}</Td>
                      <Td><DeviceStatusBadge status={d.status} lastSeen={d.last_seen_at} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Assign from inventory" subtitle="Sensors get a node id on the property gateway. For new boards, use the installation wizard instead — it flashes and registers them automatically." />
            <CardBody>
              {gateways.length === 0 && <div className="mb-4"><Notice tone="warn">Assign a gateway first — sensors stream to the gateway on the home network.</Notice></div>}
              <ActionForm action={assignDeviceAction} className="grid gap-3 md:grid-cols-4">
                <input type="hidden" name="property_id" value={p.id} />
                <Field label="Device"><Select name="device_id" required>{((inventory ?? []) as Device[]).map((d) => <option key={d.id} value={d.id}>{d.kind === 'gateway' ? '[Gateway] ' : ''}{d.name}{d.hw_id ? ` (${d.hw_id})` : ''}</option>)}</Select></Field>
                <Field label="Room (sensors)"><Select name="room_id"><option value="">—</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
                <Field label="Gateway (sensors)"><Select name="gateway_id"><option value="">—</option>{gateways.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
                <div className="flex items-end"><SubmitButton>Assign</SubmitButton></div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'settings' && (
        <Card><CardHeader title="Property settings" /><CardBody>
          <ActionForm action={updatePropertyAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="id" value={p.id} />
            <Field label="Name"><Input name="name" defaultValue={p.name} required /></Field>
            <Field label="Status"><Select name="status" defaultValue={p.status}>{['planned', 'installing', 'active', 'suspended', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Address line 1"><Input name="address_line1" defaultValue={p.address_line1 ?? ''} /></Field>
            <Field label="Address line 2"><Input name="address_line2" defaultValue={p.address_line2 ?? ''} /></Field>
            <Field label="City"><Input name="city" defaultValue={p.city ?? ''} /></Field>
            <Field label="Region"><Input name="region" defaultValue={p.region ?? ''} /></Field>
            <Field label="Postal code"><Input name="postal_code" defaultValue={p.postal_code ?? ''} /></Field>
            <Field label="Country"><Input name="country" defaultValue={p.country ?? ''} /></Field>
            <Field label="Latitude"><Input name="latitude" type="number" step="any" defaultValue={p.latitude ?? ''} /></Field>
            <Field label="Longitude"><Input name="longitude" type="number" step="any" defaultValue={p.longitude ?? ''} /></Field>
            <Field label="Timezone"><TimezoneSelect value={p.timezone} /></Field>
            <Field label="Exit delay (s)"><Input name="exit_delay_s" type="number" min={0} max={600} defaultValue={p.exit_delay_s} /></Field>
            <div className="md:col-span-2">
              <Checkbox name="wellness_vitals" defaultChecked={p.features.wellness_vitals === true}
                label={<span><span className="font-medium">Wellness vitals (experimental)</span><span className="block text-xs text-muted">Store and show breathing / heart-rate estimates from tier-2 nodes. Not a medical device; requires the client&apos;s explicit consent (health data).</span></span>} />
            </div>
            <Field label="Access notes (staff only)" className="md:col-span-2"><Textarea name="access_notes" defaultValue={p.access_notes ?? ''} /></Field>
            <Field label="Internal notes" className="md:col-span-2"><Textarea name="notes" defaultValue={p.notes ?? ''} /></Field>
            <div className="md:col-span-2 flex justify-end"><SubmitButton>Save property</SubmitButton></div>
          </ActionForm>
        </CardBody></Card>
      )}
    </>
  );
}
