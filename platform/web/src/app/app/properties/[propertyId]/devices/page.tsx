import { notFound } from 'next/navigation';
import { Card, CardHeader, LinkButton, Table, Td, Th } from '@/components/ui';
import { DeviceStatusBadge, SignalBars } from '@/components/monitoring/badges';
import { requireClientUser } from '@/lib/auth';
import { loadProperty } from '@/lib/property-data';
import { timeAgo } from '@/lib/format';

export const metadata = { title: 'Devices' };

export default async function ClientDevices({ params }: { params: Promise<{ propertyId: string }> }) {
  await requireClientUser();
  const { propertyId } = await params;
  const data = await loadProperty(propertyId);
  if (!data) notFound();
  const roomName = new Map(data.rooms.map((r) => [r.id, r.name]));
  return (
    <Card>
      <CardHeader title="Devices" subtitle="Your home gateway and WiFi sensing nodes." actions={<LinkButton href={`/app/support/new?property=${propertyId}`}>Report a problem</LinkButton>} />
      <Table>
        <thead><tr><Th>Device</Th><Th>Location</Th><Th>Signal</Th><Th>Last seen</Th><Th>Status</Th><Th /></tr></thead>
        <tbody>{data.devices.map((d) => (
          <tr key={d.id}>
            <Td><p className="font-medium">{d.name}</p><p className="text-xs text-muted">{d.kind === 'gateway' ? 'Home gateway' : 'Sensing node'}{d.firmware_version ? ` · v${d.firmware_version}` : ''}</p></Td>
            <Td className="text-sm">{d.kind === 'gateway' ? '—' : roomName.get(d.room_id ?? '') ?? '—'}</Td>
            <Td>{d.kind === 'sensor_node' ? <SignalBars rssi={d.last_rssi} /> : '—'}</Td>
            <Td className="text-sm text-muted">{timeAgo(d.last_seen_at)}</Td>
            <Td><DeviceStatusBadge status={d.status} /></Td>
            <Td><LinkButton variant="ghost" href={`/app/support/new?property=${propertyId}&device=${d.id}`}>Report</LinkButton></Td>
          </tr>
        ))}</tbody>
      </Table>
    </Card>
  );
}
