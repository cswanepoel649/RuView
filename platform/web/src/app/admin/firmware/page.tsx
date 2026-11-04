import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Notice, PageHeader, Table, Td, Th } from '@/components/ui';
import { FirmwareUpload } from '@/components/admin/FirmwareUpload';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { bytes, formatDateTime } from '@/lib/format';
import { LEGACY_OTA_MAX_BYTES } from '@ruview/shared/catalog';
import type { DeviceModel, FirmwareRelease } from '@/lib/types';
import { createReleaseAction, setReleaseStatusAction } from './actions';

export const metadata = { title: 'Firmware' };

export default async function FirmwarePage() {
  const s = await requireStaff();
  const db = await createClient();
  const [{ data }, { data: models }, { data: usage }] = await Promise.all([
    db.from('firmware_releases').select('*').order('created_at', { ascending: false }),
    db.from('device_models').select('id, name, firmware_family').eq('firmware_family', 'esp32-csi-node'),
    db.from('devices').select('firmware_release_id').not('firmware_release_id', 'is', null),
  ]);
  const used = ((usage ?? []) as { firmware_release_id: string }[]).reduce<Record<string, number>>((a, u) => ({ ...a, [u.firmware_release_id]: (a[u.firmware_release_id] ?? 0) + 1 }), {});
  const rows = (data ?? []) as FirmwareRelease[];
  return (
    <>
      <PageHeader title="Firmware" subtitle="RuView esp32-csi-node release images used by the browser flasher and OTA." />
      <div className="mb-6"><Notice tone="info" title="Release rules">Build from <code>sdkconfig.defaults.template</code> (8 MB) and <code>sdkconfig.defaults.4mb</code> (4 MB) with mock CSI disabled, and verify on real hardware before publishing. Current firmware accepts OTA images up to its partition size; nodes still running firmware with the old {bytes(LEGACY_OTA_MAX_BYTES)} gate must be updated over USB first.</Notice></div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Releases" />
          {rows.length === 0 ? <EmptyState title="No releases uploaded.">Upload the six binaries from a firmware build (or <code>firmware/esp32-csi-node/release_bins</code>).</EmptyState> : (
            <Table>
              <thead><tr><Th>Version</Th><Th>Flash</Th><Th>App size</Th><Th>Status</Th><Th>Devices</Th><Th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <Td><p className="font-medium">{r.version} <Badge>{r.channel}</Badge></p><p className="text-xs text-muted">{r.model_ids.join(', ')} · {formatDateTime(r.created_at)}</p>{r.notes && <p className="mt-1 max-w-md text-xs text-muted">{r.notes}</p>}</Td>
                  <Td>{r.flash_size_mb} MB</Td>
                  <Td className="text-sm">{bytes(r.app_size)}{(r.app_size ?? 0) > LEGACY_OTA_MAX_BYTES && <p className="text-xs text-warn">USB only for legacy-firmware nodes</p>}</Td>
                  <Td>{r.is_mock_build ? <Badge tone="bad">Mock build</Badge> : <Badge tone={r.status === 'published' ? 'ok' : r.status === 'deprecated' ? 'neutral' : 'info'}>{r.status}</Badge>}</Td>
                  <Td className="tabular">{used[r.id] ?? 0}</Td>
                  <Td>{s.isAdmin && !r.is_mock_build && (
                    <form action={setReleaseStatusAction} className="flex gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      {r.status !== 'published' && <Button type="submit" name="status" value="published" variant="secondary">Publish</Button>}
                      {r.status === 'published' && <Button type="submit" name="status" value="deprecated" variant="ghost">Deprecate</Button>}
                    </form>
                  )}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        {s.isAdmin && (
          <Card className="h-fit"><CardHeader title="Upload release" subtitle="Files are verified server-side: ESP32-S3 chip id, image magic, slot size, SHA-256, mock-code scan." />
            <CardBody><FirmwareUpload models={((models ?? []) as DeviceModel[]).map((m) => ({ id: m.id, name: m.name }))} create={createReleaseAction} /></CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
