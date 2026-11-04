import { ActionForm, ConfirmSubmit, SubmitButton } from '../ui/forms';
import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Input } from '../ui';
import { saveZoneAction, deleteZoneAction } from '@/app/actions/zones';
import type { Room, Zone } from '@/lib/types';

export function ZoneEditor({ propertyId, zones, rooms, zoneRooms, canEdit }: { propertyId: string; zones: Zone[]; rooms: Room[]; zoneRooms: { zone_id: string; room_id: string }[]; canEdit: boolean }) {
  const form = (z?: Zone) => {
    const sel = new Set(zoneRooms.filter((zr) => zr.zone_id === z?.id).map((zr) => zr.room_id));
    return (
      <ActionForm action={saveZoneAction} className="space-y-4" resetOnSuccess={!z}>
        <input type="hidden" name="property_id" value={propertyId} />
        {z && <input type="hidden" name="id" value={z.id} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Zone name"><Input name="name" required defaultValue={z?.name} placeholder="e.g. Downstairs" disabled={!canEdit} /></Field>
          <Field label="Entry delay (s)" hint="0 = alarm immediately. Use for entrance zones."><Input name="entry_delay_s" type="number" min={0} max={300} defaultValue={z?.entry_delay_s ?? 0} disabled={!canEdit} /></Field>
        </div>
        <Field label="Description"><Input name="description" defaultValue={z?.description ?? ''} disabled={!canEdit} /></Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Armed in</legend>
          <div className="flex flex-wrap gap-4">
            <Checkbox name="active_modes[]" value="armed_away" label="Away" defaultChecked={z ? z.active_modes.includes('armed_away') : true} disabled={!canEdit} />
            <Checkbox name="active_modes[]" value="armed_home" label="Home (night)" defaultChecked={z?.active_modes.includes('armed_home')} disabled={!canEdit} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Rooms in this zone</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((r) => <Checkbox key={r.id} name="rooms[]" value={r.id} label={r.name} defaultChecked={sel.has(r.id)} disabled={!canEdit} />)}
          </div>
        </fieldset>
        <Checkbox name="enabled" label="Zone enabled" defaultChecked={z ? z.enabled : true} disabled={!canEdit} />
        {canEdit && <div className="flex justify-end"><SubmitButton>{z ? 'Save zone' : 'Create zone'}</SubmitButton></div>}
      </ActionForm>
    );
  };
  return (
    <div className="space-y-6">
      {zones.map((z) => (
        <Card key={z.id}>
          <CardHeader title={z.name} subtitle={<span className="flex gap-2">{z.active_modes.map((m) => <Badge key={m} tone="brand">{m === 'armed_away' ? 'Away' : 'Home'}</Badge>)}{!z.enabled && <Badge tone="warn">Disabled</Badge>}{z.entry_delay_s > 0 && <Badge>{z.entry_delay_s}s entry delay</Badge>}</span>}
            actions={canEdit && (
              <form action={deleteZoneAction}>
                <input type="hidden" name="id" value={z.id} /><input type="hidden" name="property_id" value={propertyId} />
                <ConfirmSubmit message={`Delete zone "${z.name}"?`} variant="secondary">Delete</ConfirmSubmit>
              </form>
            )} />
          <CardBody>{form(z)}</CardBody>
        </Card>
      ))}
      {canEdit && <Card><CardHeader title="New zone" subtitle="Presence in any of these rooms while armed raises an intrusion alarm." /><CardBody>{form()}</CardBody></Card>}
    </div>
  );
}
