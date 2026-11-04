import { notFound } from 'next/navigation';
import { Notice } from '@/components/ui';
import { ZoneEditor } from '@/components/monitoring/ZoneEditor';
import { canOperate, requireClientUser } from '@/lib/auth';
import { loadProperty } from '@/lib/property-data';

export const metadata = { title: 'Security zones' };

export default async function Zones({ params }: { params: Promise<{ propertyId: string }> }) {
  const s = await requireClientUser();
  const { propertyId } = await params;
  const data = await loadProperty(propertyId);
  if (!data) notFound();
  const editable = canOperate(s, data.property.client_id);
  return (
    <div className="space-y-6">
      <Notice tone="info">A zone is a group of rooms. When the property is armed in one of the zone&apos;s modes, any detected presence in those rooms raises an intrusion alarm. Pets and moving objects (fans, curtains) can trigger WiFi sensing — leave such rooms out of night zones.</Notice>
      <ZoneEditor propertyId={propertyId} zones={data.zones} rooms={data.rooms.filter((r) => r.monitoring_enabled)} zoneRooms={data.zoneRooms} canEdit={editable} />
    </div>
  );
}
