import 'server-only';
import { createClient } from './supabase/server';
import { toPublicSupabaseUrl } from './public-env';
import type { Device, Floor, Property, Room, RoomState, Zone } from './types';
import type { FloorWithPlan } from '@/components/monitoring/LiveFloorPlan';

/** Loads everything the property views need (RLS scoped to the caller). */
export async function loadProperty(propertyId: string) {
  const db = await createClient();
  const { data: property } = await db.from('properties').select('*').eq('id', propertyId).maybeSingle();
  if (!property) return null;
  const [floors, rooms, states, zones, zoneRooms, devices] = await Promise.all([
    db.from('floors').select('*').eq('property_id', propertyId).order('sort_order'),
    db.from('rooms').select('*').eq('property_id', propertyId).order('sort_order').order('name'),
    db.from('room_state').select('*').eq('property_id', propertyId),
    db.from('security_zones').select('*').eq('property_id', propertyId).order('name'),
    db.from('zone_rooms').select('zone_id, room_id').eq('client_id', (property as Property).client_id),
    db.from('devices').select('*').eq('property_id', propertyId).order('kind').order('name'),
  ]);
  const floorRows = (floors.data ?? []) as Floor[];
  const paths = floorRows.map((f) => f.plan_path).filter(Boolean) as string[];
  const signed = paths.length ? (await db.storage.from('floor-plans').createSignedUrls(paths, 3600)).data ?? [] : [];
  const urlFor = new Map(signed.map((s) => [s.path, s.signedUrl ? toPublicSupabaseUrl(s.signedUrl) : s.signedUrl]));
  const floorsWithPlan: FloorWithPlan[] = floorRows.map((f) => ({ ...f, plan_url: f.plan_path ? urlFor.get(f.plan_path) ?? null : null }));
  return {
    property: property as Property,
    floors: floorsWithPlan,
    rooms: (rooms.data ?? []) as Room[],
    states: (states.data ?? []) as RoomState[],
    zones: (zones.data ?? []) as Zone[],
    zoneRooms: (zoneRooms.data ?? []) as { zone_id: string; room_id: string }[],
    devices: (devices.data ?? []) as Device[],
  };
}
