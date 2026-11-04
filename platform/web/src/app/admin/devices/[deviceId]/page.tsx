import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Notice, PageHeader, Select, Table, Td, Th, Textarea } from '@/components/ui';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/ui/forms';
import { DeviceStatusBadge, SignalBars } from '@/components/monitoring/badges';
import { EnrollmentCode } from '@/components/admin/EnrollmentCode';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { bytes, formatDateTime, isoNow, MOTION_LABEL, STATUS_LABEL, timeAgo } from '@/lib/format';
import { FIRMWARE_OTA_MAX_BYTES, CAPABILITY_LABEL } from '@ruview/shared/catalog';
import type { Device, DeviceModel, DeviceStatus, FirmwareRelease, NodeState, Room } from '@/lib/types';
import {
  cancelCommandAction, createEnrollmentCodeAction, queueOtaAction, queueProbeAction, revokeGatewayTokensAction, unassignDeviceAction, updateDeviceAction,
} from '../actions';

type H = Record<string, unknown>;
const KV = ({ k, v }: { k: string; v: React.ReactNode }) => (<div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v ?? '—'}</dd></div>);

export default async function DeviceDetail({ params }: { params: Promise<{ deviceId: string }> }) {
  await requireStaff();
  const { deviceId } = await params;
  const db = await createClient();
  const { data: dev } = await db.from('devices').select('*, properties(id, name, client_id), clients(display_name)').eq('id', deviceId).maybeSingle();
  if (!dev) notFound();
  const d = dev as Device & { properties: { id: string; name: string } | null; clients: { display_name: string } | null };
  const [model, rooms, log, cmds, nodeState, releases, creds, enrollments, children, gateway] = await Promise.all([
    db.from('device_models').select('*').eq('id', d.model_id).single(),
    d.property_id ? db.from('rooms').select('id, name').eq('property_id', d.property_id).order('name') : Promise.resolve({ data: [] }),
    db.from('device_status_log').select('*').eq('device_id', deviceId).order('created_at', { ascending: false }).limit(20),
    db.from('device_commands').select('*').eq('device_id', deviceId).order('created_at', { ascending: false }).limit(15),
    db.from('node_state').select('*').eq('device_id', deviceId).maybeSingle(),
    d.kind === 'sensor_node' ? db.from('firmware_releases').select('*').eq('status', 'published').contains('model_ids', [d.model_id]).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    d.kind === 'gateway' ? db.from('device_credentials').select('id, token_prefix, created_at, last_used_at, revoked_at').eq('device_id', deviceId).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    d.kind === 'gateway' ? db.from('gateway_enrollments').select('id, expires_at, used_at, created_at').eq('device_id', deviceId).is('used_at', null).gt('expires_at', isoNow()).limit(5) : Promise.resolve({ data: [] }),
    d.kind === 'gateway' ? db.from('devices').select('id, name, node_id, status, last_seen_at, last_rssi, room_id').eq('gateway_id', deviceId).order('node_id') : Promise.resolve({ data: [] }),
    d.gateway_id ? db.from('devices').select('id, name, status').eq('id', d.gateway_id).single() : Promise.resolve({ data: null }),
  ]);
  const m = model.data as DeviceModel | null;
  const h = d.health as H;
  const ns = nodeState.data as NodeState | null;
  const roomName = new Map(((rooms.data ?? []) as Room[]).map((r) => [r.id, r.name]));
  const appUrl = serverEnv().APP_URL;

  return (
    <>
      <PageHeader title={d.name} breadcrumbs={[{ href: '/admin/devices', label: 'Devices' }, ...(d.properties ? [{ href: `/admin/properties/${d.properties.id}`, label: d.properties.name }] : [])]}
        subtitle={<span className="flex flex-wrap items-center gap-3"><DeviceStatusBadge status={d.status} lastSeen={d.last_seen_at} /><span>{m?.name}</span>{d.hw_id && <span className="font-mono text-xs">{d.hw_id}</span>}</span>}
        actions={d.property_id && (
          <form action={unassignDeviceAction}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit variant="secondary" message="Return this device to stock? It will stop being associated with the property.">Unassign</ConfirmSubmit></form>
        )} />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {d.kind === 'sensor_node' && (
            <Card>
              <CardHeader title="Live state" subtitle={ns ? `Reported ${timeAgo(ns.received_at)} via ${ns.source}` : 'No telemetry received yet'} actions={<form action={queueProbeAction}><input type="hidden" name="id" value={d.id} /><Button variant="secondary" type="submit" disabled={!d.gateway_id}>Probe node</Button></form>} />
              <CardBody className="grid gap-x-8 sm:grid-cols-2">
                <dl>
                  <KV k="Presence" v={ns ? (ns.presence ? <Badge tone="occupied">Present</Badge> : <Badge tone="ok">Clear</Badge>) : null} />
                  <KV k="Motion" v={ns ? MOTION_LABEL[ns.motion_level] : null} />
                  <KV k="Person estimate" v={ns?.person_count} />
                  <KV k="Confidence" v={ns?.confidence != null ? `${Math.round(ns.confidence * 100)}%` : null} />
                </dl>
                <dl>
                  <KV k="Signal" v={<SignalBars rssi={d.last_rssi} />} />
                  <KV k="CSI frame rate" v={ns?.frame_rate != null ? `${ns.frame_rate} Hz` : null} />
                  <KV k="Packets / s" v={h.packets_per_s as number} />
                  <KV k="Edge tier observed" v={h.edge_tier_observed != null ? `Tier ${h.edge_tier_observed}` : null} />
                </dl>
              </CardBody>
            </Card>
          )}

          {d.kind === 'gateway' && (
            <Card>
              <CardHeader title="Gateway health" subtitle={h.reported_at ? `Heartbeat ${timeAgo(h.reported_at as string)}` : 'Never checked in'} />
              <CardBody className="grid gap-x-8 sm:grid-cols-2">
                <dl>
                  <KV k="Agent version" v={h.agent_version as string} />
                  <KV k="Sensing service" v={(h.sensing as H | undefined)?.reachable ? <Badge tone={(h.sensing as H).source === 'esp32' ? 'ok' : 'warn'}>{String((h.sensing as H).source)}</Badge> : <Badge tone="bad">unreachable</Badge>} />
                  <KV k="LAN IPs" v={((h.lan_ips as string[]) ?? []).join(', ')} />
                  <KV k="Public IP" v={d.last_ip} />
                </dl>
                <dl>
                  <KV k="Host" v={(h.system as H | undefined)?.hostname as string} />
                  <KV k="Load / memory" v={h.system ? `${(h.system as H).load1} · ${(h.system as H).mem_free_mb}/${(h.system as H).mem_total_mb} MB free` : null} />
                  <KV k="CPU temp" v={(h.system as H | undefined)?.cpu_temp_c != null ? `${(h.system as H).cpu_temp_c} °C` : null} />
                  <KV k="Buffered (offline)" v={h.buffer ? `${(h.buffer as H).pending_minutes} min · ${(h.buffer as H).pending_events} events` : null} />
                </dl>
              </CardBody>
              <div className="border-t border-border">
                <p className="px-5 pt-3 text-sm font-medium">Sensors on this gateway</p>
                {((children.data ?? []) as Device[]).length === 0 ? <EmptyState title="No sensors attached." /> : (
                  <Table><thead><tr><Th>Node</Th><Th>Sensor</Th><Th>Signal</Th><Th>Status</Th></tr></thead><tbody>
                    {((children.data ?? []) as Device[]).map((c) => (
                      <tr key={c.id}><Td className="tabular">{c.node_id}</Td><Td><Link href={`/admin/devices/${c.id}`} className="hover:underline">{c.name}</Link></Td><Td><SignalBars rssi={c.last_rssi} /></Td><Td><DeviceStatusBadge status={c.status} lastSeen={c.last_seen_at} /></Td></tr>
                    ))}
                  </tbody></Table>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Commands" subtitle="Executed by the home gateway on its next heartbeat" />
            {((cmds.data ?? []) as H[]).length === 0 ? <EmptyState title="No commands sent." /> : (
              <Table><thead><tr><Th>Command</Th><Th>Status</Th><Th>Requested</Th><Th>Result</Th><Th /></tr></thead><tbody>
                {((cmds.data ?? []) as H[]).map((c) => (
                  <tr key={c.id as string}>
                    <Td className="text-sm">{c.command_type as string}{(c.payload as H)?.version ? ` → ${(c.payload as H).version}` : ''}</Td>
                    <Td><Badge tone={c.status === 'succeeded' ? 'ok' : c.status === 'failed' || c.status === 'expired' ? 'bad' : 'info'}>{c.status as string}</Badge></Td>
                    <Td className="text-xs text-muted">{formatDateTime(c.created_at as string)}</Td>
                    <Td className="max-w-xs text-xs text-muted">{(c.error as string) ?? ((c.result as H)?.version ? `running ${(c.result as H).version}` : '')}</Td>
                    <Td>{c.status === 'queued' && <form action={cancelCommandAction}><input type="hidden" name="id" value={c.id as string} /><input type="hidden" name="device_id" value={d.id} /><Button variant="ghost" type="submit">Cancel</Button></form>}</Td>
                  </tr>
                ))}
              </tbody></Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Status history" />
            <ul className="divide-y divide-border">
              {((log.data ?? []) as H[]).map((l) => (
                <li key={l.id as number} className="flex justify-between gap-3 px-5 py-2 text-sm">
                  <span>{l.from_status ? `${STATUS_LABEL[l.from_status as DeviceStatus]} → ` : ''}<span className="font-medium">{STATUS_LABEL[l.to_status as DeviceStatus]}</span>{l.reason ? <span className="text-muted"> · {String(l.reason)}</span> : null}</span>
                  <span className="text-xs text-muted">{formatDateTime(l.created_at as string)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {d.kind === 'gateway' && (
            <Card>
              <CardHeader title="Enrollment & credentials" subtitle="Gateways authenticate with a token issued at enrollment. Re-enrolling revokes the previous token." />
              <CardBody className="space-y-4">
                {!d.property_id ? <Notice tone="warn">Assign this gateway to a property first.</Notice> : <EnrollmentCode gatewayId={d.id} appUrl={appUrl} create={createEnrollmentCodeAction} />}
                <div>
                  <p className="mb-1 text-sm font-medium">Tokens</p>
                  {((creds.data ?? []) as H[]).map((c) => (
                    <p key={c.id as string} className="flex justify-between text-xs"><span className="font-mono">{c.token_prefix as string}…</span>
                      <span className="text-muted">{c.revoked_at ? `revoked ${timeAgo(c.revoked_at as string)}` : `active · used ${timeAgo(c.last_used_at as string | null)}`}</span></p>
                  ))}
                  {((creds.data ?? []) as H[]).length === 0 && <p className="text-xs text-muted">Not enrolled yet.</p>}
                  {((enrollments.data ?? []) as H[]).length > 0 && <p className="mt-1 text-xs text-info">An unused enrollment code is pending.</p>}
                </div>
                {((creds.data ?? []) as H[]).some((c) => !c.revoked_at) && (
                  <form action={revokeGatewayTokensAction}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit message="Revoke this gateway's token? It will stop reporting until re-enrolled.">Revoke token</ConfirmSubmit></form>
                )}
              </CardBody>
            </Card>
          )}

          {d.kind === 'sensor_node' && (
            <Card>
              <CardHeader title="Firmware" subtitle={`Running ${d.firmware_version ?? 'unknown'}${(h.ota as H | undefined)?.running_partition ? ` · ${(h.ota as H).running_partition}` : ''}`} />
              <CardBody className="space-y-3">
                {!d.gateway_id && <Notice tone="warn">Attach the sensor to a gateway to enable over-the-air updates.</Notice>}
                <ActionForm action={queueOtaAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="device_id" value={d.id} />
                  <Field label="Release" className="min-w-[220px] flex-1">
                    <Select name="release_id" required>{((releases.data ?? []) as FirmwareRelease[]).map((r) => (
                      <option key={r.id} value={r.id} disabled={(r.app_size ?? 0) > FIRMWARE_OTA_MAX_BYTES}>{r.version} · {r.flash_size_mb} MB · {bytes(r.app_size)}{(r.app_size ?? 0) > FIRMWARE_OTA_MAX_BYTES ? ' (USB only)' : ''}</option>
                    ))}</Select>
                  </Field>
                  <SubmitButton>Queue OTA update</SubmitButton>
                </ActionForm>
                <p className="text-xs text-muted">The node firmware accepts OTA images up to {bytes(FIRMWARE_OTA_MAX_BYTES)}; larger builds must be flashed over USB in the installation wizard.</p>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="mb-4">
                <KV k="Client" v={d.clients?.display_name} />
                <KV k="Gateway" v={gateway.data ? <Link className="hover:underline" href={`/admin/devices/${(gateway.data as H).id}`}>{(gateway.data as H).name as string}</Link> : null} />
                <KV k="Node id" v={d.node_id} />
                <KV k="Last IP" v={d.last_ip} />
                <KV k="Observed MAC" v={h.mac_observed as string} />
                <KV k="Provisioned" v={d.provisioned_at ? formatDateTime(d.provisioned_at) : null} />
              </dl>
              {m && <div className="mb-4 flex flex-wrap gap-1">{m.capabilities.map((c) => <Badge key={c}>{CAPABILITY_LABEL[c] ?? c}</Badge>)}</div>}
              <ActionForm action={updateDeviceAction} className="space-y-3">
                <input type="hidden" name="id" value={d.id} />
                <Field label="Name"><Input name="name" defaultValue={d.name} required /></Field>
                {d.kind === 'sensor_node' && <Field label="Room"><Select name="room_id" defaultValue={d.room_id ?? ''}><option value="">—</option>{((rooms.data ?? []) as Room[]).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>}
                {d.kind === 'gateway' && <input type="hidden" name="room_id" value="" />}
                <Field label="Status"><Select name="status" defaultValue={d.status}>{(['inventory', 'assigned', 'provisioned', 'online', 'offline', 'fault', 'retired'] as DeviceStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select></Field>
                <Field label="Serial / label"><Input name="serial_number" defaultValue={d.serial_number ?? ''} /></Field>
                <Field label="Mounting notes" hint="Height, orientation, line of sight."><Textarea name="mount_notes" defaultValue={d.mount_notes ?? ''} /></Field>
                <Field label="Notes"><Textarea name="notes" defaultValue={d.notes ?? ''} /></Field>
                <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
              </ActionForm>
              {roomName.size === 0 && d.kind === 'sensor_node' && <p className="mt-2 text-xs text-muted">Assign the device to a property to choose a room.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
