import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Field, Input, LinkButton, Notice, PageHeader, Select, Table, Td, Th, cn } from '@/components/ui';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/ui/forms';
import { EnrollmentCode } from '@/components/admin/EnrollmentCode';
import { SensorProvisioner } from '@/components/install/SensorProvisioner';
import { AutoRefresh, RoomVerify, StepToggle } from '@/components/install/WizardControls';
import { LiveFloorPlan } from '@/components/monitoring/LiveFloorPlan';
import { DeviceStatusBadge, SignalBars } from '@/components/monitoring/badges';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadProperty } from '@/lib/property-data';
import { serverEnv } from '@/lib/env';
import { timeAgo } from '@/lib/format';
import type { FirmwareRelease, Installation } from '@/lib/types';
import {
  cancelInstallationAction, completeInstallationAction, completeProvisioningAction, createGatewayAction, markRoomVerifiedAction,
  markStepAction, prepareProvisioningAction,
} from '../actions';
import { createEnrollmentCodeAction } from '../../devices/actions';

const STEPS = [
  { key: 'survey', title: 'Site survey', desc: 'Floors, rooms and floor plans' },
  { key: 'gateway', title: 'Home gateway', desc: 'Raspberry Pi / Linux box running RuView + agent' },
  { key: 'sensors', title: 'Sensor nodes', desc: 'Flash, configure and place ESP32-S3 boards' },
  { key: 'verify', title: 'Walk test', desc: 'Confirm presence is detected in every room' },
  { key: 'handover', title: 'Client handover', desc: 'Users, alerts and go-live' },
] as const;

export default async function InstallationWizard({ params, searchParams }: { params: Promise<{ installationId: string }>; searchParams: Promise<{ step?: string }> }) {
  await requireStaff();
  const { installationId } = await params;
  const db = await createClient();
  const { data: inst } = await db.from('installations').select('*').eq('id', installationId).maybeSingle();
  if (!inst) notFound();
  const i = inst as Installation;
  const data = await loadProperty(i.property_id);
  if (!data) notFound();
  const { property: p, floors, rooms, states, zones, devices } = data;
  const [{ data: client }, { data: releases }, { data: members }, { data: rules }, { data: creds }] = await Promise.all([
    db.from('clients').select('id, display_name').eq('id', p.client_id).single(),
    db.from('firmware_releases').select('id, version, flash_size_mb, model_ids, files, app_size, status, is_mock_build').eq('status', 'published').eq('is_mock_build', false).order('created_at', { ascending: false }),
    db.from('client_members').select('user_id', { count: 'exact' }).eq('client_id', p.client_id),
    db.from('alert_rules').select('id').eq('property_id', p.id).eq('enabled', true),
    db.from('device_credentials').select('device_id, revoked_at').in('device_id', devices.filter((d) => d.kind === 'gateway').map((d) => d.id).concat(['00000000-0000-0000-0000-000000000000'])),
  ]);

  const gateways = devices.filter((d) => d.kind === 'gateway');
  const sensors = devices.filter((d) => d.kind === 'sensor_node');
  const gwHealth = (g: (typeof gateways)[number]) => g.health as { sensing?: { reachable?: boolean; source?: string }; lan_ips?: string[]; reported_at?: string };
  const gatewayReady = gateways.some((g) => g.status === 'online' && gwHealth(g).sensing?.reachable);
  const monitoredRooms = rooms.filter((r) => r.monitoring_enabled);
  const roomsWithSensor = new Set(sensors.filter((s) => s.room_id && s.status !== 'retired').map((s) => s.room_id!));
  const uncovered = monitoredRooms.filter((r) => !roomsWithSensor.has(r.id));
  const onlineSensors = sensors.filter((s) => s.status === 'online');
  const verified = ((i.steps.verify as { rooms?: Record<string, string | null> } | undefined)?.rooms) ?? {};
  const verifiable = monitoredRooms.filter((r) => roomsWithSensor.has(r.id));
  const auto: Record<string, boolean> = {
    survey: rooms.length > 0,
    gateway: gatewayReady,
    sensors: onlineSensors.length > 0 && uncovered.length === 0,
    verify: verifiable.length > 0 && verifiable.every((r) => verified[r.id]),
    handover: i.status === 'completed',
  };
  const done = (k: string) => auto[k] || !!i.steps[k]?.done;
  const current = (await searchParams).step ?? STEPS.find((s) => !done(s.key))?.key ?? 'handover';
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return (
    <>
      {i.status !== 'completed' && i.status !== 'cancelled' && <AutoRefresh seconds={10} />}
      <PageHeader title={`Installation · ${p.name}`} breadcrumbs={[{ href: '/admin/installations', label: 'Installations' }, { href: `/admin/clients/${p.client_id}`, label: client?.display_name ?? 'Client' }]}
        subtitle={<span className="flex items-center gap-2"><Badge tone={i.status === 'completed' ? 'ok' : 'info'}>{i.status.replace('_', ' ')}</Badge>{i.started_at && <span>started {timeAgo(i.started_at)}</span>}</span>}
        actions={i.status !== 'completed' && <form action={cancelInstallationAction}><input type="hidden" name="id" value={i.id} /><ConfirmSubmit variant="ghost" message="Cancel this installation? Devices stay assigned.">Cancel installation</ConfirmSubmit></form>} />

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Installation steps" className="space-y-1">
          {STEPS.map((s, idx) => (
            <Link key={s.key} href={`?step=${s.key}`} aria-current={current === s.key ? 'step' : undefined}
              className={cn('flex gap-3 rounded-xl border px-3 py-3', current === s.key ? 'border-brand bg-brand-soft' : 'border-transparent hover:bg-surface-2')}>
              {done(s.key) ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted" />}
              <span><span className="block text-sm font-medium">{idx + 1}. {s.title}</span><span className="block text-xs text-muted">{s.desc}</span></span>
            </Link>
          ))}
        </nav>

        <div className="min-w-0 space-y-6">
          {current === 'survey' && (
            <Card>
              <CardHeader title="Site survey" subtitle="Model the home before installing hardware." actions={<StepToggle done={!!i.steps.survey?.done} onToggle={markStepAction.bind(null, i.id, 'survey')} />} />
              <CardBody className="space-y-4">
                <p className="text-sm">{floors.length} floor(s), {rooms.length} room(s), {zones.length} zone(s) configured.</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  <li>Plan one sensor per room you want monitored; large or L-shaped rooms benefit from two. Coverage is best with clear line of sight and nodes ~1–1.5 m high, away from metal enclosures.</li>
                  <li>RuView senses WiFi channel disturbances, so the home router (2.4 GHz) must be on and nodes must associate to it.</li>
                  <li>The gateway needs mains power and preferably wired Ethernet on the same subnet as the WiFi.</li>
                </ul>
                <div className="flex flex-wrap gap-2"><LinkButton href={`/admin/properties/${p.id}?tab=layout`}>Edit floors & rooms</LinkButton><LinkButton href={`/admin/properties/${p.id}?tab=zones`} variant="ghost">Security zones</LinkButton></div>
                {rooms.length === 0 && <Notice tone="warn">Add at least one room to continue.</Notice>}
              </CardBody>
            </Card>
          )}

          {current === 'gateway' && (
            <Card>
              <CardHeader title="Home gateway" subtitle="Runs the RuView sensing server and the ruview-agent bridge; connects outbound only (no port forwarding)." />
              <CardBody className="space-y-5">
                {gateways.map((g) => {
                  const h = gwHealth(g);
                  const enrolled = ((creds ?? []) as { device_id: string; revoked_at: string | null }[]).some((c) => c.device_id === g.id && !c.revoked_at);
                  return (
                    <div key={g.id} className="rounded-xl border border-border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link href={`/admin/devices/${g.id}`} className="font-medium hover:underline">{g.name}</Link>
                        <DeviceStatusBadge status={g.status} lastSeen={g.last_seen_at} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge tone={enrolled ? 'ok' : 'warn'}>{enrolled ? 'Enrolled' : 'Not enrolled'}</Badge>
                        {h.sensing && <Badge tone={h.sensing.reachable && h.sensing.source === 'esp32' ? 'ok' : 'warn'}>sensing: {h.sensing.reachable ? h.sensing.source : 'unreachable'}</Badge>}
                        {h.lan_ips?.length ? <Badge>LAN {h.lan_ips.join(', ')}</Badge> : null}
                      </div>
                      {!enrolled && <div className="mt-4"><EnrollmentCode gatewayId={g.id} appUrl={serverEnv().APP_URL} create={createEnrollmentCodeAction} /></div>}
                    </div>
                  );
                })}
                {gateways.length === 0 && (
                  <ActionForm action={createGatewayAction} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="installation_id" value={i.id} />
                    <Field label="Gateway name"><Input name="name" required defaultValue={`${p.name} gateway`} /></Field>
                    <Field label="Hardware"><Select name="model_id"><option value="gateway-rpi">Raspberry Pi 4/5</option><option value="gateway-linux">Linux mini-PC</option></Select></Field>
                    <SubmitButton>Add gateway</SubmitButton>
                  </ActionForm>
                )}
                <Notice tone="info" title="Gateway requirements">64-bit Raspberry Pi OS / Debian / Ubuntu with Docker, 2 GB RAM+, wired Ethernet recommended. The installer pulls the RuView sensing server and ruview-agent and starts them as services. Reserve the gateway&apos;s LAN IP in the router — sensors are configured to stream to it.</Notice>
              </CardBody>
            </Card>
          )}

          {current === 'sensors' && (
            <>
              <SensorProvisioner installationId={i.id}
                gateways={gateways.map((g) => ({ id: g.id, name: g.name, lanIps: gwHealth(g).lan_ips ?? [], online: g.status === 'online' }))}
                rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
                releases={((releases ?? []) as FirmwareRelease[]).map((r) => ({ id: r.id, version: r.version, flash_size_mb: r.flash_size_mb, model_ids: r.model_ids, files: r.files as Record<string, { sha256: string; size: number }> }))}
                prepare={prepareProvisioningAction} complete={completeProvisioningAction} />
              <Card>
                <CardHeader title="Sensors at this property" subtitle={uncovered.length ? `${uncovered.length} monitored room(s) without a sensor: ${uncovered.map((r) => r.name).join(', ')}` : 'Every monitored room has a sensor.'} />
                <Table>
                  <thead><tr><Th>Sensor</Th><Th>Room</Th><Th>Node</Th><Th>Signal</Th><Th>Status</Th></tr></thead>
                  <tbody>{sensors.map((s) => (
                    <tr key={s.id}>
                      <Td><Link href={`/admin/devices/${s.id}`} className="font-medium hover:underline">{s.name}</Link><p className="font-mono text-xs text-muted">{s.hw_id}</p></Td>
                      <Td>{roomName.get(s.room_id ?? '') ?? '—'}</Td><Td className="tabular">{s.node_id}</Td>
                      <Td><SignalBars rssi={s.last_rssi} /></Td><Td><DeviceStatusBadge status={s.status} lastSeen={s.last_seen_at} /></Td>
                    </tr>
                  ))}</tbody>
                </Table>
              </Card>
            </>
          )}

          {current === 'verify' && (
            <>
              <Notice tone="info" title="Walk test">Wait ~60 s after the last node boots (ambient calibration, room empty). Then walk into each room, stand still for a few seconds, and confirm the room lights up below before marking it verified.</Notice>
              <LiveFloorPlan propertyId={p.id} floors={floors} rooms={rooms} initialStates={states} title="Live presence" />
              <Card>
                <CardHeader title="Room checklist" />
                <ul className="divide-y divide-border">
                  {monitoredRooms.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="text-sm">{r.name}{!roomsWithSensor.has(r.id) && <span className="ml-2 text-xs text-warn">no sensor</span>}</span>
                      {roomsWithSensor.has(r.id) && <RoomVerify verified={!!verified[r.id]} onToggle={markRoomVerifiedAction.bind(null, i.id, r.id)} />}
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}

          {current === 'handover' && (
            <Card>
              <CardHeader title="Client handover" />
              <CardBody className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {[
                    [`${members?.length ?? 0} client portal user(s)`, (members?.length ?? 0) > 0, `/admin/clients/${p.client_id}`],
                    [`${rules?.length ?? 0} active alert rules`, (rules?.length ?? 0) > 0, null],
                    [`${zones.length} security zone(s)`, zones.length > 0, `/admin/properties/${p.id}?tab=zones`],
                    [`${onlineSensors.length}/${sensors.length} sensors online`, sensors.length > 0 && onlineSensors.length === sensors.length, null],
                    ['Walk test complete', auto.verify, '?step=verify'],
                  ].map(([label, ok, href]) => (
                    <li key={label as string} className="flex items-center gap-2">
                      {ok ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <Circle className="h-4 w-4 text-warn" />}
                      {href ? <Link href={href as string} className="hover:underline">{label as string}</Link> : <span>{label as string}</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted">Explain to the client: presence is inferred from WiFi signals (no cameras); occupancy can be uncertain with pets or fans; the gateway and router must stay powered for monitoring and alarms.</p>
                {i.status !== 'completed' ? (
                  <form action={completeInstallationAction}><input type="hidden" name="id" value={i.id} /><ConfirmSubmit variant="primary" message="Mark installation complete and set the property live?">Complete installation & go live</ConfirmSubmit></form>
                ) : <Notice tone="ok">Installation completed {i.completed_at ? timeAgo(i.completed_at) : ''}.</Notice>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
